import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';
import type { DiscoveryRepo } from '../agents/discovery';
import type { Agent, AgentKind } from '../agents/types';
import { isExternalSessionKind } from '../agents/types';
import type { Orchestrator } from '../tasks/orchestrator';
import type { Planner } from '../tasks/planner';
import type { TaskStore } from '../tasks/store';
import type { SessionStore } from '../sessions/eventLog';
import type { SessionEvent } from '../agents/types';
import type { CodexAppServer } from '../agents/codexAppServer';
import { listAgentModels } from '../agents/modelCatalog';
import { listDir } from '../fs/listDir';

const desktopOnly = '该来源由原应用续接，工作台仅浏览历史。';

export interface RealSessionSource {
  list(kind: AgentKind): Array<{
    id: string;
    title: string;
    project: string;
    updated: string | null;
    startedAt?: string | null;
    msgs: number | null;
    model?: string | null;
    tools?: number | null;
    tokenIn?: number | null;
    tokenOut?: number | null;
    contextTokens?: number | null;
    contextWindow?: number | null;
    antigravityOrigins?: Array<'desktop' | 'cli'>;
    opencodeStorage?: 'v1' | 'v2';
    openTitle?: string;
    path?: string;
  }>;
  read(kind: AgentKind, id: string): SessionEvent[];
}

/** User-pickable task roots: the workbench workspace plus common project locations. */
export function workspaceCandidates(config: Config): string[] {
  return [config.workspaceRoot, path.join(config.homeDir, 'WorkBuddy'), config.homeDir];
}

export interface RouteDeps {
  config: Config;
  discovery: DiscoveryRepo;
  orchestrator: Orchestrator;
  planner: Planner;
  store: TaskStore;
  sessions: SessionStore;
  realSessions: RealSessionSource;
  codex?: CodexAppServer;
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Cheap readiness probe for the desktop shell: no scans, no blocking work.
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/agents', async () => {
    const running = await deps.discovery.scanAgents();
    const kinds = new Set(running.map((a) => a.kind));
    for (const kind of ['claude', 'codex', 'opencode', 'pi', 'workbuddy', 'dsh', 'antigravity'] as AgentKind[]) {
      try {
        if (deps.realSessions.list(kind).length > 0) kinds.add(kind);
      } catch (error) {
        app.log.warn({ error, kind }, 'session source unavailable');
      }
    }
    for (const kind of kinds) {
      if (!running.some((a) => a.kind === kind)) {
        running.push({
          id: `kind:${kind}`,
          name: kind.charAt(0).toUpperCase() + kind.slice(1),
          kind,
          command: kind,
          cwd: '',
          status: 'discovered',
          managed: false,
        } as Agent);
      }
    }
    return running;
  });

  app.post('/api/agents/:id/adopt', async (req, reply) => {
    const { agent, model, effort } = req.body as { agent: Agent; model?: unknown; effort?: unknown };
    if (isExternalSessionKind(agent.kind)) return reply.code(409).send({ error: desktopOnly });
    if ((model !== undefined && (typeof model !== 'string' || !model.trim())) || (effort !== undefined && (typeof effort !== 'string' || !effort.trim()))) return reply.code(400).send({ error: '模型或思考强度无效' });
    if (effort && !['claude', 'pi'].includes(agent.kind)) return reply.code(400).send({ error: '此智能体不支持通过启动参数设置思考强度' });
    deps.orchestrator.adopt(agent, { model: model as string | undefined, effort: effort as string | undefined });
    return { ok: true };
  });

  app.post('/api/agents/:id/dispatch', async (req, reply) => {
    const { agent, instruction } = req.body as { agent: Agent; instruction: string };
    if (isExternalSessionKind(agent.kind)) return reply.code(409).send({ error: desktopOnly });
    deps.orchestrator.dispatchToAgent(agent, instruction);
    return { ok: true };
  });

  app.post('/api/agents/:id/release', async (req) => {
    const { id } = req.params as { id: string };
    deps.orchestrator.release(id);
    return { ok: true };
  });

  app.post('/api/agents/:id/stop', async (req) => {
    const { id } = req.params as { id: string };
    deps.orchestrator.stop(id);
    return { ok: true };
  });

  app.post('/api/agents/:id/input', async (req) => {
    const { id } = req.params as { id: string };
    const { data } = req.body as { data: string };
    if (typeof data !== 'string') throw new Error('invalid input');
    deps.orchestrator.input(id, data);
    return { ok: true };
  });

  app.get('/api/codex/models', async (_req, reply) => {
    if (!deps.codex) return reply.code(503).send({ error: 'Codex app-server 未配置' });
    return deps.codex.listModels();
  });

  // Model catalogue for the CLI agents, read from their local config (or `opencode models` / `agy models`).
  app.get('/api/models', async (req, reply) => {
    const { kind, refresh } = req.query as { kind?: string; refresh?: string };
    if (kind !== 'claude' && kind !== 'pi' && kind !== 'opencode' && kind !== 'antigravity') {
      return reply.code(400).send({ error: '不支持的智能体类型' });
    }
    return { kind, models: await listAgentModels(kind, { refresh: refresh === '1' }) };
  });

  app.post('/api/codex/sessions/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.codex) return reply.code(503).send({ error: 'Codex app-server 未配置' });
    await deps.codex.resume(id);
    return { ok: true };
  });

  app.post('/api/codex/sessions/:id/input', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text, model, effort } = req.body as { text?: string; model?: unknown; effort?: unknown };
    if (!deps.codex) return reply.code(503).send({ error: 'Codex app-server 未配置' });
    if (typeof text !== 'string' || !text.trim()) return reply.code(400).send({ error: '消息不能为空' });
    if ((model !== undefined && (typeof model !== 'string' || !model.trim())) || (effort !== undefined && (typeof effort !== 'string' || !effort.trim()))) return reply.code(400).send({ error: '模型或思考强度无效' });
    await deps.codex.send(id, text, { model: model as string | undefined, effort: effort as string | undefined });
    return { ok: true };
  });

  app.post('/api/codex/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.codex) return reply.code(503).send({ error: 'Codex app-server 未配置' });
    await deps.codex.interrupt(id);
    return { ok: true };
  });

  // A: the agent's run directory (fallback: the workbench workspace root).
  app.get('/api/agents/:id/workspace', async (req) => {
    const { path: dir } = req.query as { path?: string };
    const target = dir && dir.trim() ? dir : deps.config.workspaceRoot;
    return { path: target, entries: listDir(target) };
  });

  // All conversations for an agent, read from the agent's real session store.
  app.get('/api/agents/:id/sessions', async (req) => {
    const { kind } = req.query as { kind?: string };
    const sessionKind = (kind as AgentKind) || 'generic';
    return deps.realSessions.list(sessionKind).map((s) => ({
      id: s.id,
      kind: sessionKind,
      title: s.title,
      project: s.project,
      updated: s.updated,
      startedAt: s.startedAt ?? null,
      msgs: s.msgs,
      model: s.model ?? null,
      tools: s.tools ?? null,
      tokenIn: s.tokenIn ?? null,
      tokenOut: s.tokenOut ?? null,
      contextTokens: s.contextTokens ?? null,
      contextWindow: s.contextWindow ?? null,
      ...(s.antigravityOrigins ? { antigravityOrigins: s.antigravityOrigins } : {}),
      ...(s.opencodeStorage ? { opencodeStorage: s.opencodeStorage } : {}),
      ...(s.openTitle ? { openTitle: s.openTitle } : {}),
      path: s.path ?? null,
    }));
  });

  app.get('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { path: diskPath, kind } = req.query as { path?: string; kind?: string };
    if (kind) {
      return deps.realSessions.read(kind as AgentKind, id);
    }
    if (diskPath) {
      return deps.sessions.importDisk(diskPath, id).events;
    }
    return deps.sessions.read(id);
  });

  app.get('/api/tasks', async () => deps.store.listTasks());

  app.get('/api/tasks/dirs', async (req, reply) => {
    const { dir } = req.query as { dir?: string };
    const candidates = workspaceCandidates(deps.config);
    const targets = dir && dir.trim() ? [dir.trim()] : candidates;
    const result = [];
    for (const target of targets) {
      result.push({ path: target, entries: listDir(target) });
    }
    return reply.send(result);
  });

  app.post('/api/tasks', async (req, reply) => {
    const { title, description, workspacePath } = req.body as { title: string; description: string; workspacePath?: string };
    if (typeof title !== 'string' || !title.trim()) return reply.code(400).send({ error: '任务标题不能为空' });
    try {
      return deps.store.createTask({ title, description: String(description ?? ''), workspacePath });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : '创建任务失败' });
    }
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    deps.orchestrator.cancelTask(id);
    deps.store.deleteTask(id);
    return reply.send({ ok: true });
  });

  app.post('/api/tasks/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    if (task.status !== 'active') return reply.code(409).send({ error: '仅进行中的任务可暂停' });
    deps.orchestrator.pauseTask(id);
    return reply.send({ ok: true });
  });

  app.post('/api/tasks/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    if (task.status !== 'paused') return reply.code(409).send({ error: '仅已暂停的任务可继续' });
    deps.orchestrator.resumeTask(id);
    return reply.send({ ok: true });
  });

  app.post('/api/tasks/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    if (task.status === 'done' || task.status === 'cancelled') return reply.code(409).send({ error: '任务已结束' });
    deps.orchestrator.cancelTask(id);
    return reply.send({ ok: true });
  });

  app.get('/api/tasks/:id/live-sessions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const parts = deps.store.listParts(id);
    const agentIds = [...new Set(parts.map((part) => part.assignedAgentId).filter((agentId): agentId is string => Boolean(agentId)))];
    const sessions = agentIds.map((agentId) => ({ agentId, events: deps.sessions.read(agentId).filter((event) => event.type === 'output') }));
    return reply.send(sessions);
  });

  app.post('/api/tasks/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { agent } = req.body as { agent: Agent };
    if (isExternalSessionKind(agent.kind)) return reply.code(409).send({ error: desktopOnly });
    const drafts = await deps.planner.requestSplitPlan(task, agent);
    deps.store.updateTaskLeader(id, agent.id);
    return reply.send(drafts);
  });

  app.post('/api/tasks/:id/complete-requirement', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const { agent } = req.body as { agent: Agent };
    if (!agent) return reply.code(400).send({ error: '请先选择 leader 智能体' });
    if (isExternalSessionKind(agent.kind)) return reply.code(409).send({ error: desktopOnly });
    if (!deps.planner.completeRequirement) return reply.code(501).send({ error: '当前 planner 不支持补全需求' });
    const requirement = await deps.planner.completeRequirement(task, agent);
    deps.store.updateTaskLeader(id, agent.id);
    deps.store.updateTaskDescription?.(id, requirement);
    return reply.send({ requirement });
  });

  app.post('/api/tasks/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    if (task.status !== 'planned' || task.parts.length > 0) return reply.code(409).send({ error: '任务已派发，不能重复派发' });
    const { parts, leaderAgent } = req.body as {
      parts: Array<{ title: string; description: string; agent: Agent; model?: string; dependsOn?: string; phase?: 'coding' | 'review' | 'test' }>;
      leaderAgent?: Agent;
    };
    if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) => !part.agent || !part.title?.trim() || !part.description?.trim())) return reply.code(400).send({ error: '请填写完整分工并选择智能体' });
    if (leaderAgent && isExternalSessionKind(leaderAgent.kind)) return reply.code(409).send({ error: desktopOnly });
    const created = parts.map((p) => {
      const part = deps.store.addPart(id, {
        title: p.title,
        description: p.description,
        assignedAgentId: p.agent.id,
        agentKind: p.agent.kind,
        phase: p.phase ?? 'coding',
        status: 'pending',
        model: p.model && p.model.trim() ? p.model.trim() : null,
        dependsOn: p.dependsOn && p.dependsOn.trim() ? p.dependsOn.trim() : null,
      });
      return { part, agent: p.agent };
    });
    if (leaderAgent) deps.store.updateTaskLeader(id, leaderAgent.id);
    deps.orchestrator.activateTask(id, created, leaderAgent);
    return { ok: true };
  });

  app.get('/api/tasks/:id/progress', async (req) => {
    const { id } = req.params as { id: string };
    return deps.orchestrator.progress(id);
  });

  // B: the task's shared workspace (SHARED.md + SUMMARY.md + part artifacts).
  app.get('/api/tasks/:id/workspace', async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = deps.store.getTask(id);
    if (!task) return reply.code(404).send({ error: 'task not found' });
    const sharedFile = path.join(task.workspacePath, 'SHARED.md');
    const summaryFile = path.join(task.workspacePath, 'SUMMARY.md');
    const shared = existsSync(sharedFile) ? readFileSync(sharedFile, 'utf8') : '';
    const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';
    return { path: task.workspacePath, entries: listDir(task.workspacePath), shared, summary };
  });
}
