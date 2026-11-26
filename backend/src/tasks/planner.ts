import { spawn } from 'node:child_process';
import type { Agent, AgentAdapter, AgentKind, OneShotCommand, Task } from '../agents/types';
import { isExternalSessionKind } from '../agents/types';
import type { PtyProcess, Supervisor } from '../pty/supervisor';
import { taskBackground } from './context';

export interface PartDraft {
  title: string;
  description: string;
  suggestedAgentId: string | null;
  model?: string | null;
  phase?: 'coding' | 'review' | 'test';
  dependsOn?: string[] | null;
}

export interface PlannerCompleteResult {
  requirement: string;
  parts: PartDraft[];
}

export interface Planner {
  /** Leader agent expands the sketch into a concrete requirement. */
  completeRequirement(task: Task, leader: Agent): Promise<string>;
  /** Leader agent proposes a split (with phases, deps and suggested models). */
  requestSplitPlan(task: Task, plannerAgent: Agent): Promise<PartDraft[]>;
}

const REQUIREMENT_PLACEHOLDER = '...write the full requirement here...';

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

/** Extract every balanced JSON array/object candidate from noisy CLI output. */
function findJsonBlocks(text: string, openChar: '[' | '{', closeChar: ']' | '}'): unknown[] {
  const results: unknown[] = [];
  let inString = false;
  let escape = false;
  for (let start = text.indexOf(openChar); start !== -1; start = text.indexOf(openChar, start + 1)) {
    let depth = 0;
    inString = false;
    escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          try {
            results.push(JSON.parse(text.slice(start, i + 1)));
          } catch {
            // not valid JSON; keep scanning later candidates
          }
          break;
        }
      }
    }
  }
  return results;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item)).filter(Boolean);
}

function partsFrom(value: unknown): PartDraft[] | null {
  if (!Array.isArray(value)) return null;
  const out: PartDraft[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const title = String(record.title ?? '');
    const description = String(record.description ?? '');
    if (!title.trim() || !description.trim()) return null;
    const phaseRaw = String(record.phase ?? '');
    const phase = phaseRaw === 'coding' || phaseRaw === 'review' || phaseRaw === 'test' ? phaseRaw : undefined;
    const dependsOn = stringList(record.dependsOn);
    const suggestedAgentId =
      typeof record.agentId === 'string' ? record.agentId :
      typeof record.suggestedAgentId === 'string' ? record.suggestedAgentId : null;
    const model = typeof record.model === 'string' && record.model.trim() ? record.model : null;
    out.push({
      title,
      description,
      suggestedAgentId:
        typeof record.agentKind === 'string' ? record.agentKind : suggestedAgentId,
      model,
      phase,
      dependsOn,
    });
  }
  return out.length ? out : null;
}

function requirementFrom(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() && value.trim() !== REQUIREMENT_PLACEHOLDER) return value.trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.requirement === 'string') {
      const text = record.requirement.trim();
      if (text && text !== REQUIREMENT_PLACEHOLDER) return text;
    }
  }
  return null;
}

function promptFor(task: Task): string {
  return [
    `You are the planning assistant. Break the following task into 2-4 concrete parts.`,
    ...(task.workspacePath ? [`Workspace directory: ${task.workspacePath}`] : []),
    `Task: ${task.title}`,
    `Background: ${taskBackground(task)}`,
    `Reply with ONLY a JSON array of objects {"title","description","phase","suggestedAgentId","dependsOn","model"}.`,
    `- phase is one of coding|review|test.`,
    `- coding parts should ONLY write/modify code (no running tests, builds, browser checks, or screenshots; put verification in a separate test/review part if needed).`,
    `- dependsOn lists earlier part titles that must finish first (empty array if independent).`,
    `- model may be left as "" and assigned by the user.`,
    `No prose, no code fences.`,
  ].join('\n');
}

function requirementPromptFor(task: Task): string {
  return [
    `You are the leader agent. Below is a rough requirement sketch.`,
    ...(task.workspacePath ? [`Workspace directory: ${task.workspacePath}`] : []),
    `Sketch: ${task.title}\n${taskBackground(task)}`,
    ...((task.round ?? 1) > 1 ? ['Refine only the current requirement. Earlier requests and results are context.'] : []),
    `Write a concise, clear requirement spec in Chinese: goal, deliverables, and acceptance criteria.`,
    `Reply with ONLY a JSON object {"requirement":"${REQUIREMENT_PLACEHOLDER}"}.`,
    `No prose outside the JSON.`,
  ].join('\n');
}

function runOneShot(cmd: OneShotCommand, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const isBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd.file);
    const child = spawn(cmd.file, cmd.args, {
      cwd,
      windowsHide: true,
      shell: isBatch,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('leader timeout')));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || stdout.trim() || `Leader 进程异常退出（退出码 ${code ?? 'unknown'}）`));
      });
    });

    if (cmd.stdin !== undefined) child.stdin.write(cmd.stdin);
    child.stdin.end();
  });
}

export class AgentPlanner implements Planner {
  constructor(
    private readonly deps: {
      supervisor: Supervisor;
      adapters?: (kind: AgentKind) => AgentAdapter;
      timeoutMs?: number;
    },
  ) {}

  private ensureRunning(agent: Agent, task: Task): PtyProcess | undefined {
    if (this.deps.supervisor.isRunning(agent.id)) return undefined;
    const adapter = this.deps.adapters?.(agent.kind);
    if (!adapter) throw new Error(`agent not running: ${agent.id}`);
    const cwd = agent.cwd || task.workspacePath || process.cwd();
    const cmd = adapter.launch({ resumeSessionId: agent.sessionId, cwd });
    return this.deps.supervisor.start(agent.id, cmd.file, cmd.args, cwd);
  }

  async requestSplitPlan(task: Task, plannerAgent: Agent): Promise<PartDraft[]> {
    const adapter = this.deps.adapters?.(plannerAgent.kind);
    const timeoutMs = this.deps.timeoutMs ?? 120000;
    if (!this.deps.supervisor.isRunning(plannerAgent.id) && adapter?.oneShot) {
      const cwd = task.workspacePath || plannerAgent.cwd || process.cwd();
      const output = await runOneShot(adapter.oneShot({ prompt: promptFor(task), cwd, allowWrites: false }), cwd, timeoutMs);
      const clean = stripAnsi(output);
      for (const candidate of findJsonBlocks(clean, '[', ']')) {
        const drafts = partsFrom(candidate);
        if (drafts) return drafts;
      }
      throw new Error('Leader 未返回有效的 JSON 分片方案');
    }

    return new Promise<PartDraft[]>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        fn();
      };

      const timer = setTimeout(() => {
        done(() => reject(new Error('planner timeout')));
      }, timeoutMs);

      let acc = '';
      const off = this.deps.supervisor.onOutput(plannerAgent.id, (chunk) => {
        acc += chunk;
        const clean = stripAnsi(acc);
        for (const candidate of findJsonBlocks(clean, '[', ']')) {
          const drafts = partsFrom(candidate);
          if (drafts) {
            done(() => resolve(drafts));
            return;
          }
        }
      });

      try {
        const proc = this.ensureRunning(plannerAgent, task);
        proc?.onExit((code) => {
          done(() => reject(new Error(`Leader 智能体已退出（退出码 ${code}），未返回有效的拆分 JSON`)));
        });
        this.deps.supervisor.write(plannerAgent.id, `${promptFor(task)}\n`);
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
  }

  async completeRequirement(task: Task, leader: Agent): Promise<string> {
    const adapter = this.deps.adapters?.(leader.kind);
    const timeoutMs = this.deps.timeoutMs ?? 120000;
    if (!this.deps.supervisor.isRunning(leader.id) && adapter?.oneShot) {
      const cwd = task.workspacePath || leader.cwd || process.cwd();
      const output = await runOneShot(adapter.oneShot({ prompt: requirementPromptFor(task), cwd, allowWrites: false }), cwd, timeoutMs);
      const clean = stripAnsi(output).trim();
      for (const candidate of findJsonBlocks(clean, '{', '}')) {
        const requirement = requirementFrom(candidate);
        if (requirement) return requirement;
      }
      if (clean) return clean;
      throw new Error('Leader 未返回补全后的需求');
    }

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        fn();
      };

      const timer = setTimeout(() => {
        done(() => reject(new Error('requirement timeout')));
      }, timeoutMs);

      let acc = '';
      const off = this.deps.supervisor.onOutput(leader.id, (chunk) => {
        acc += chunk;
        const clean = stripAnsi(acc);
        for (const candidate of findJsonBlocks(clean, '{', '}')) {
          const requirement = requirementFrom(candidate);
          if (requirement) {
            done(() => resolve(requirement));
            return;
          }
        }
      });

      try {
        const proc = this.ensureRunning(leader, task);
        proc?.onExit((code) => {
          done(() => reject(new Error(`Leader 智能体已退出（退出码 ${code}），未返回补全后的需求`)));
        });
        this.deps.supervisor.write(leader.id, `${requirementPromptFor(task)}\n`);
      } catch (err) {
        done(() => reject(err instanceof Error ? err : new Error(String(err))));
      }
    });
  }
}

/** Return the (kind-derived) name variants users would pick for a leader. */
export function leaderFilter(kinds: AgentKind[]): AgentKind[] {
  // Only allow runnable CLI agents to act as leader/planner.
  return kinds.filter((kind) => !isExternalSessionKind(kind));
}
