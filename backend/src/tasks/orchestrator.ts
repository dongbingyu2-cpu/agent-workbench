import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Agent, AgentAdapter, AgentKind, Part, PartStatus } from '../agents/types';
import { isExternalSessionKind } from '../agents/types';
import type { PtyProcess, Supervisor } from '../pty/supervisor';
import type { WsMessage } from '../api/events';
import type { SessionStore } from '../sessions/eventLog';
import type { TaskStore } from './store';
import type { Workspace } from './workspace';

export interface PartProgress {
  partId: string;
  status: PartStatus;
  tail: string;
  resultPath: string;
  result?: string;
}

export interface OrchestratorDeps {
  supervisor: Supervisor;
  store: TaskStore;
  workspace: Workspace;
  sessions: SessionStore;
  adapters: (kind: AgentKind) => AgentAdapter;
  /** Prefer non-interactive one-shot CLI execution for parts/summary when an adapter supports it. */
  useOneShot?: boolean;
  /** When the whole task is done, called once so the workbench can record/close it. */
  onTaskDone?: (taskId: string) => void;
}

const MAX_TAIL = 2000;

export function buildPartPrompt(part: Part, background: string, workspacePath?: string): string {
  const phase = part.phase ?? 'coding';
  const phaseRule =
    phase === 'coding'
      ? 'Phase: coding. ONLY write or edit the required code files directly — do NOT run tests, builds, linters, browser checks, screenshots, or write separate design/spec/plan documents.'
      : phase === 'review'
        ? 'Phase: review. Focus strictly on reviewing the existing code and reporting concrete issues/improvements; do not start unrelated tasks.'
        : 'Phase: test. Focus strictly on testing and verifying the deliverables.';
  return [
    `You own the "${part.title}" part of a larger task.`,
    ...(workspacePath ? [`Workspace directory: ${workspacePath} (do all your work and write deliverables inside this directory).`] : []),
    'Read SHARED.md in this task workspace for the shared background:',
    background,
    `Your part: ${part.description}`,
    phaseRule,
    'Execute directly in non-interactive mode: do not ask follow-up questions.',
    `When finished, write your result to ${part.resultPath} (RESULT.md), then create the completion marker file ${part.doneMarker} (DONE).`,
  ].join('\n');
}

export function buildLeaderSummaryPrompt(
  task: { title: string; description: string; workspacePath?: string },
  parts: Array<{ title: string; resultPath: string; status?: PartStatus }>,
): string {
  const list = parts
    .map((part) => `- ${part.title}${part.status ? ` [${part.status}]` : ''}（结果：${part.resultPath}）`)
    .join('\n');
  return [
    `You are the leader agent for the task "${task.title}".`,
    ...(task.workspacePath ? [`Workspace directory: ${task.workspacePath}`] : []),
    `All assigned sub-agents have finished. Inspect their results and deliverables in the workspace:`,
    list || '（无分片）',
    `Write a concise final review and summary of the whole task and deliverable location.`,
    `Reply with only your summary; do not start new work.`,
  ].join('\n');
}

export class Orchestrator {
  private readonly busy = new Set<string>();
  private readonly tails = new Map<string, string>();
  private readonly generations = new Map<string, object>();
  private readonly partAgents = new Map<string, Agent>(); // partId -> agent (for later dependency waves)
  private readonly activeParts = new Map<string, { taskId: string; agentId: string; kill: () => void; unwatch: () => void }>();
  private readonly pausedTasks = new Set<string>();
  private readonly cancelledTasks = new Set<string>();
  private readonly taskLeader = new Map<string, Agent | undefined>(); // taskId -> leader agent or undefined
  private readonly doneTasks = new Set<string>();
  private sink?: (msg: WsMessage) => void;

  constructor(private readonly deps: OrchestratorDeps) {}

  setEventSink(sink: (msg: WsMessage) => void): void {
    this.sink = sink;
  }

  private startAgent(agent: Agent, resumeSessionId?: string, options: { model?: string; effort?: string; cwd?: string } = {}): PtyProcess {
    const cwd = options.cwd || agent.cwd || process.cwd();
    const adapter = this.deps.adapters(agent.kind);
    const cmd = adapter.launch({ resumeSessionId, cwd, model: options.model, effort: options.effort });
    const proc = this.deps.supervisor.start(agent.id, cmd.file, cmd.args, cwd);
    const generation = {};
    this.generations.set(agent.id, generation);
    this.deps.supervisor.onOutput(agent.id, (chunk) => {
      this.deps.sessions.append(agent.id, { ts: Date.now(), type: 'output', data: chunk });
      this.sink?.({ type: 'agent-output', agentId: agent.id, chunk });
    });
    proc.onExit(() => {
      if (this.generations.get(agent.id) !== generation) return;
      this.generations.delete(agent.id);
      this.busy.delete(agent.id);
      this.sink?.({ type: 'agent-exit', agentId: agent.id });
    });
    return proc;
  }

  adopt(agent: Agent, options: { model?: string; effort?: string } = {}): void {
    if (!agent.sessionId) throw new Error('cannot adopt agent without a session id');
    if (this.deps.supervisor.isRunning(agent.id)) return;
    this.startAgent(agent, agent.sessionId, options);
    this.busy.add(agent.id);
  }

  release(agentId: string): void {
    this.busy.delete(agentId);
  }

  stop(agentId: string): void {
    this.generations.delete(agentId);
    this.deps.supervisor.stop(agentId);
    this.busy.delete(agentId);
  }

  dispatchToAgent(agent: Agent, instruction: string): void {
    if (this.busy.has(agent.id)) throw new Error(`agent busy: ${agent.id}`);
    if (!this.deps.supervisor.isRunning(agent.id)) {
      this.startAgent(agent, agent.sessionId);
    }
    this.deps.supervisor.write(agent.id, instruction.endsWith('\n') ? instruction : `${instruction}\n`);
    this.busy.add(agent.id);
  }

  input(agentId: string, data: string): void {
    this.deps.supervisor.write(agentId, data);
    this.deps.sessions.append(agentId, { ts: Date.now(), type: 'input', data });
  }

  /**
   * Activate a task. Parts start in dependency order: a part whose dependsOn lists
   * other part titles waits until those are done (or failed). When every part is
   * done, the leader agent (if any) is asked to write the final summary, then the
   * task is marked done.
   */
  activateTask(taskId: string, assignments: Array<{ part: Part; agent: Agent }>, leaderAgent?: Agent): void {
    if (this.doneTasks.has(taskId)) return;
    const task = this.deps.store.getTask(taskId);
    const background = task?.description ?? '';
    this.deps.workspace.writeShared(taskId, background);
    this.deps.store.updateTaskStatus(taskId, 'active');
    this.taskLeader.set(taskId, leaderAgent);
    this.doneTasks.delete(taskId);
    this.pausedTasks.delete(taskId);
    this.cancelledTasks.delete(taskId);

    for (const { part, agent } of assignments) {
      this.partAgents.set(part.id, agent);
      this.deps.store.updatePart(part.id, { status: 'pending' });
    }
    // Dispatch whatever is ready now.
    for (const { part } of assignments) this.maybeStartPart(taskId, task?.title ?? '', part);
  }

  pauseTask(taskId: string): void {
    const task = this.deps.store.getTask(taskId);
    if (!task || task.status !== 'active') return;
    this.pausedTasks.add(taskId);
    this.deps.store.updateTaskStatus(taskId, 'paused');
    for (const part of this.deps.store.listParts(taskId)) {
      const handle = this.activeParts.get(part.id);
      if (handle) {
        this.activeParts.delete(part.id);
        handle.unwatch();
        try { handle.kill(); } catch {}
        this.busy.delete(handle.agentId);
      }
      if (this.deps.store.getPart(part.id)?.status === 'running') {
        this.deps.store.updatePart(part.id, { status: 'pending' });
        const prev = this.tails.get(part.id) ?? '';
        this.tails.set(part.id, prev ? `${prev}\n[已暂停]` : '[已暂停]');
      }
    }
    this.emitProgress(taskId);
  }

  resumeTask(taskId: string): void {
    const task = this.deps.store.getTask(taskId);
    if (!task || task.status !== 'paused') return;
    this.pausedTasks.delete(taskId);
    this.cancelledTasks.delete(taskId);
    this.doneTasks.delete(taskId);
    this.deps.store.updateTaskStatus(taskId, 'active');
    for (const part of this.deps.store.listParts(taskId)) {
      if (!this.partAgents.has(part.id)) {
        const inferredKind = part.agentKind ?? (part.assignedAgentId?.startsWith('kind:') ? (part.assignedAgentId.slice('kind:'.length) as AgentKind) : null);
        if (inferredKind) {
          this.partAgents.set(part.id, {
            id: part.assignedAgentId || `kind:${inferredKind}`,
            name: inferredKind,
            kind: inferredKind,
            command: inferredKind,
            cwd: task.workspacePath,
            status: 'discovered',
            managed: false,
          });
        }
      }
      if (this.deps.store.getPart(part.id)?.status === 'pending' && this.dependencySatisfied(taskId, part)) {
        this.maybeStartPart(taskId, task.title, part);
      }
    }
    this.emitProgress(taskId);
  }

  cancelTask(taskId: string): void {
    const task = this.deps.store.getTask(taskId);
    if (!task) return;
    this.pausedTasks.delete(taskId);
    this.cancelledTasks.add(taskId);
    this.doneTasks.add(taskId);
    for (const part of this.deps.store.listParts(taskId)) {
      const handle = this.activeParts.get(part.id);
      if (handle) {
        this.activeParts.delete(part.id);
        handle.unwatch();
        try { handle.kill(); } catch {}
        this.busy.delete(handle.agentId);
      }
      const status = this.deps.store.getPart(part.id)?.status;
      if (status === 'running' || status === 'pending') {
        this.deps.store.updatePart(part.id, { status: 'failed' });
        if (!this.tails.get(part.id)) this.tails.set(part.id, '[任务已取消]');
      }
    }
    this.deps.store.updateTaskStatus(taskId, 'cancelled');
    this.emitProgress(taskId);
  }

  private dependenciesOf(part: Part): string[] {
    return (part.dependsOn ?? '').split(/[,，]/).map((title) => title.trim()).filter(Boolean);
  }

  private dependencySatisfied(taskId: string, part: Part): boolean {
    const parts = this.deps.store.listParts(taskId);
    for (const dependencyTitle of this.dependenciesOf(part)) {
      const dependency = parts.find((item) => item.title === dependencyTitle);
      if (!dependency) continue; // unknown dependency is treated as satisfied
      const status = this.deps.store.getPart(dependency.id)?.status;
      if (status !== 'done' && status !== 'failed') return false;
    }
    return true;
  }

  private maybeStartPart(taskId: string, _title: string, part: Part): void {
    if (this.pausedTasks.has(taskId) || this.cancelledTasks.has(taskId)) return;
    if (this.deps.store.getPart(part.id)?.status !== 'pending') return;
    if (!this.dependencySatisfied(taskId, part)) return;

    const agent = this.partAgents.get(part.id);
    if (!agent) {
      this.deps.store.updatePart(part.id, { status: 'failed' });
      this.emitProgress(taskId);
      return;
    }

    this.deps.store.updatePart(part.id, { status: 'running' });
    this.tails.set(part.id, '');
    const task = this.deps.store.getTask(taskId);
    const background = task?.description ?? '';
    const cwd = task?.workspacePath || agent.cwd || process.cwd();
    const prompt = buildPartPrompt(part, background, task?.workspacePath);

    if (isExternalSessionKind(agent.kind)) {
      const promptPath = this.deps.workspace.writePrompt(taskId, part.id, prompt);
      this.tails.set(part.id, `桌面智能体：请在对应客户端执行 ${promptPath}\n完成后写入 ${part.resultPath} 并创建 ${part.doneMarker}`);
      const unwatch = this.deps.workspace.watchPartCompletion(taskId, part.id, () => {
        unwatch();
        if (this.deps.store.getPart(part.id)?.status !== 'running') return;
        this.deps.store.updatePart(part.id, { status: 'done' });
        this.afterPartDone(taskId);
      });
      this.emitProgress(taskId);
      return;
    }

    const adapter = this.deps.adapters(agent.kind);
    if (this.deps.useOneShot && adapter.oneShot && !this.deps.supervisor.isRunning(agent.id)) {
      this.runOneShotPart(taskId, part, agent, adapter, prompt, cwd);
      return;
    }

    try {
      const proc = this.startAgent(agent, agent.sessionId, { model: part.model || undefined, cwd });
      this.busy.add(agent.id);
      this.deps.supervisor.onOutput(agent.id, (chunk) => {
        const next = ((this.tails.get(part.id) ?? '') + chunk).slice(-MAX_TAIL);
        this.tails.set(part.id, next);
      });
      let unwatch: () => void = () => {};
      unwatch = this.deps.workspace.watchPartCompletion(taskId, part.id, () => {
        this.activeParts.delete(part.id);
        unwatch();
        if (this.deps.store.getPart(part.id)?.status !== 'running') return;
        this.deps.store.updatePart(part.id, { status: 'done' });
        this.busy.delete(agent.id);
        this.afterPartDone(taskId);
      });
      this.activeParts.set(part.id, {
        taskId,
        agentId: agent.id,
        kill: () => proc.kill(),
        unwatch,
      });
      proc.onExit(() => {
        this.activeParts.delete(part.id);
        unwatch();
        if (this.pausedTasks.has(taskId) || this.cancelledTasks.has(taskId)) return;
        if (this.deps.store.getPart(part.id)?.status === 'running') {
          this.deps.store.updatePart(part.id, { status: 'failed' });
          this.afterPartDone(taskId);
        }
      });
      this.deps.supervisor.write(agent.id, `${prompt}\n`);
    } catch (error) {
      this.deps.store.updatePart(part.id, { status: 'failed' });
      this.tails.set(part.id, error instanceof Error ? error.message : String(error));
      this.busy.delete(agent.id);
      this.afterPartDone(taskId);
    }
  }

  private runOneShotPart(taskId: string, part: Part, agent: Agent, adapter: AgentAdapter, prompt: string, cwd: string): void {
    this.deps.workspace.writePrompt(taskId, part.id, prompt);
    const cmd = adapter.oneShot!({ prompt, cwd, model: part.model || undefined, allowWrites: true });
    const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd.file);
    this.busy.add(agent.id);

    let unwatch: () => void = () => {};
    const finish = (status: 'done' | 'failed') => {
      this.activeParts.delete(part.id);
      unwatch();
      if (this.pausedTasks.has(taskId) || this.cancelledTasks.has(taskId)) return;
      if (this.deps.store.getPart(part.id)?.status !== 'running') return;
      this.deps.store.updatePart(part.id, { status });
      this.busy.delete(agent.id);
      this.afterPartDone(taskId);
    };

    unwatch = this.deps.workspace.watchPartCompletion(taskId, part.id, () => finish('done'));

    try {
      const child = spawn(cmd.file, cmd.args, {
        cwd,
        windowsHide: true,
        shell: isBatch,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.activeParts.set(part.id, {
        taskId,
        agentId: agent.id,
        kill: () => child.kill(),
        unwatch,
      });
      const onChunk = (raw: Buffer | string) => {
        const chunk = String(raw);
        const next = ((this.tails.get(part.id) ?? '') + chunk).slice(-MAX_TAIL);
        this.tails.set(part.id, next);
        this.deps.sessions.append(agent.id, { ts: Date.now(), type: 'output', data: chunk });
        this.sink?.({ type: 'agent-output', agentId: agent.id, chunk });
        this.emitProgress(taskId);
      };
      child.stdout.on('data', onChunk);
      child.stderr.on('data', onChunk);
      child.on('error', (error) => {
        this.tails.set(part.id, error.message);
        finish('failed');
      });
      child.on('close', (code) => {
        if (this.deps.store.getPart(part.id)?.status !== 'running') return;
        const hasDone = existsSync(part.doneMarker);
        const hasResult = existsSync(part.resultPath);
        if (code === 0 && (hasDone || hasResult)) {
          if (!hasDone) {
            try { writeFileSync(part.doneMarker, 'done\n', 'utf8'); } catch {}
          }
          finish('done');
        } else {
          finish('failed');
        }
      });
      if (cmd.stdin !== undefined) child.stdin.write(cmd.stdin);
      child.stdin.end();
      this.emitProgress(taskId);
    } catch (error) {
      this.tails.set(part.id, error instanceof Error ? error.message : String(error));
      finish('failed');
    }
  }

  private afterPartDone(taskId: string): void {
    this.emitProgress(taskId);
    if (this.pausedTasks.has(taskId) || this.cancelledTasks.has(taskId)) return;

    // Start any pending parts whose dependencies are now satisfied.
    const parts = this.deps.store.listParts(taskId);
    const task = this.deps.store.getTask(taskId);
    for (const part of parts) {
      if (this.deps.store.getPart(part.id)?.status !== 'pending') continue;
      if (this.dependencySatisfied(taskId, part)) this.maybeStartPart(taskId, task?.title ?? '', part);
    }

    // If every part has finished, drive the leader summary + close-out.
    const allFinished = parts.length > 0 && parts.every((part) => {
      const status = this.deps.store.getPart(part.id)?.status;
      return status === 'done' || status === 'failed';
    });
    if (!allFinished || this.doneTasks.has(taskId)) return;
    this.doneTasks.add(taskId);

    const leader = this.taskLeader.get(taskId);
    const completedParts = parts.map((part) => ({
      title: part.title,
      resultPath: part.resultPath,
      status: this.deps.store.getPart(part.id)?.status ?? part.status,
    }));
    const hasSucceeded = completedParts.some((part) => part.status === 'done');
    if (leader && hasSucceeded && !isExternalSessionKind(leader.kind)) {
      const summaryPrompt = buildLeaderSummaryPrompt(
        { title: task?.title ?? '', description: task?.description ?? '', workspacePath: task?.workspacePath },
        completedParts,
      );
      const leaderAdapter = this.deps.adapters(leader.kind);
      if (this.deps.useOneShot && leaderAdapter.oneShot && !this.deps.supervisor.isRunning(leader.id)) {
        try {
          const cwd = task?.workspacePath || leader.cwd || process.cwd();
          const cmd = leaderAdapter.oneShot({ prompt: summaryPrompt, cwd, allowWrites: false });
          const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd.file);
          const child = spawn(cmd.file, cmd.args, { cwd, windowsHide: true, shell: isBatch, stdio: ['pipe', 'pipe', 'pipe'] });
          let summaryOut = '';
          child.stdout.on('data', (chunk) => {
            const text = String(chunk);
            summaryOut += text;
            this.deps.sessions.append(leader.id, { ts: Date.now(), type: 'output', data: text });
          });
          child.on('close', () => {
            if (summaryOut.trim() && task?.workspacePath) {
              try { writeFileSync(path.join(task.workspacePath, 'SUMMARY.md'), summaryOut.trim(), 'utf8'); } catch {}
              this.emitProgress(taskId);
            }
          });
          if (cmd.stdin !== undefined) child.stdin.write(cmd.stdin);
          child.stdin.end();
        } catch {
          // leader CLI unavailable — fall through to close-out
        }
      } else {
        try {
          const leaderWithWorkspace = task?.workspacePath ? { ...leader, cwd: task.workspacePath } : leader;
          this.dispatchToAgent(leaderWithWorkspace, summaryPrompt);
        } catch {
          // leader CLI unavailable — fall through to close-out
        }
      }
    }
    this.deps.store.updateTaskStatus(taskId, 'done');
    this.emitProgress(taskId);
    this.deps.onTaskDone?.(taskId);
  }

  private emitProgress(taskId: string): void {
    this.sink?.({ type: 'task-progress', taskId, parts: this.progress(taskId) });
  }

  progress(taskId: string): PartProgress[] {
    return this.deps.store.listParts(taskId).map((part) => {
      let result = '';
      if (part.resultPath && existsSync(part.resultPath)) {
        try {
          result = readFileSync(part.resultPath, 'utf8').trim();
        } catch {
          result = '';
        }
      }
      return {
        partId: part.id,
        status: part.status,
        tail: (this.tails.get(part.id) ?? '').slice(-MAX_TAIL),
        resultPath: part.resultPath,
        ...(result ? { result } : {}),
      };
    });
  }
}
