import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server';
import { openDatabase } from '../src/db/database';
import { FsWorkspace } from '../src/tasks/workspace';
import { SqliteTaskStore } from '../src/tasks/store';
import { Orchestrator } from '../src/tasks/orchestrator';
import { JsonlSessionStore } from '../src/sessions/eventLog';
import { loadConfig } from '../src/config';
import type { AgentAdapter, Task } from '../src/agents/types';

const agentFixture = {
  id: 'a1',
  name: 'x',
  kind: 'claude',
  command: 'claude',
  cwd: 'C:/',
  sessionId: 's1',
  status: 'discovered',
  managed: false,
} as any;

const adapter: AgentAdapter = {
  kind: 'claude',
  displayName: 'Claude Code',
  binaries: ['claude'],
  supportsResume: true,
  launch: () => ({ file: 'claude', args: [] }),
};

function testDeps(watch: ConstructorParameters<typeof FsWorkspace>[1] = () => () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'api-'));
  const fakeProc = () => ({ pid: 1, write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} });
  const supervisor = {
    start: () => fakeProc(),
    write: () => {},
    onOutput: () => () => {},
    isRunning: () => true,
    stop: () => {},
  } as any;
  const workspace = new FsWorkspace(root, watch);
  const store = new SqliteTaskStore(openDatabase(':memory:'), workspace);
  const sessions = new JsonlSessionStore(root);
  const orchestrator = new Orchestrator({ supervisor, store, workspace, sessions, adapters: () => adapter });
  const planner = { requestSplitPlan: async () => [{ title: 'A', description: 'a', suggestedAgentId: 'a1' }], completeRequirement: async () => 'full requirement' } as any;
  const discovery = { scanAgents: async () => [], scanSessions: async () => [] };
  const realSessions = {
    list: (kind: string) => (kind === 'claude' ? [{ id: 'c1', title: 'T', project: '', updated: null, msgs: 1, kind: 'claude' }] : []),
    read: (kind: string, id: string) => (kind === 'claude' ? [{ ts: 1, type: 'output' as const, data: 'user: hi' }] : []),
  };
  return { config: loadConfig(), discovery, orchestrator, planner, store, sessions, realSessions };
}

describe('REST API', () => {
  it('routes Codex desktop resume, prompt and interrupt through app-server', async () => {
    const calls: Array<[string, string]> = [];
    const app = buildServer({ ...testDeps(), codex: {
      resume: async (id: string) => { calls.push(['resume', id]); },
      send: async (id: string, text: string, options: { model?: string; effort?: string }) => { calls.push(['send', `${id}:${text}:${options.model}:${options.effort}`]); },
      listModels: async () => [{ model: 'example' }],
      interrupt: async (id: string) => { calls.push(['interrupt', id]); },
    } as any });
    expect((await app.inject({ method: 'POST', url: '/api/codex/sessions/thread-1/resume' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/codex/models' })).json()).toEqual([{ model: 'example' }]);
    expect((await app.inject({ method: 'POST', url: '/api/codex/sessions/thread-1/input', payload: { text: 'hello', model: 'example', effort: 'high' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/codex/sessions/thread-1/interrupt' })).statusCode).toBe(200);
    expect(calls).toEqual([['resume', 'thread-1'], ['send', 'thread-1:hello:example:high'], ['interrupt', 'thread-1']]);
    await app.close();
  });
  it('rejects desktop adoption but allows desktop agents in task assignment', async () => {
    const deps = testDeps();
    const app = buildServer(deps);
    const task = deps.store.createTask({ title: 'Desktop', description: '' });
    const agent = { ...agentFixture, kind: 'workbuddy' };
    // A desktop session still cannot be adopted as a live terminal.
    expect((await app.inject({ method: 'POST', url: '/api/agents/a1/adopt', payload: { agent } })).statusCode).toBe(409);
    // But it can be assigned a task part (handled via the shared workspace prompt).
    const confirm = await app.inject({
      method: 'POST', url: `/api/tasks/${task.id}/confirm`, payload: { parts: [{ title: 'Part', description: 'Test', agent }] },
    });
    expect(confirm.statusCode).toBe(200);
    expect(deps.store.listParts(task.id)).toHaveLength(1);
    await app.close();
  });
  it('forwards interactive input to a managed agent', async () => {
    const deps = testDeps();
    let received = '';
    deps.orchestrator.input = (id, data) => { received = `${id}:${data}`; };
    const app = buildServer(deps);
    const response = await app.inject({ method: 'POST', url: '/api/agents/a1/input', payload: { data: 'hello\r' } });
    expect(response.statusCode).toBe(200);
    expect(received).toBe('a1:hello\r');
  });
  it('creates a task and lists it', async () => {
    const app = buildServer(testDeps());
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Login', description: 'bg' } });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(list.json()).toHaveLength(1);
  });
  it('returns drafts from /plan and rejects confirmation without parts', async () => {
    const app = buildServer(testDeps());
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    const plan = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/plan`, payload: { agent: agentFixture } });
    expect(Array.isArray(plan.json())).toBe(true);
    const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/confirm`, payload: { parts: [] } });
    expect(confirm.statusCode).toBe(400);
  });
  it('allows confirm when two parts share the same agent', async () => {
    const app = buildServer(testDeps());
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${t.id}/confirm`,
      payload: { parts: [{ title: 'A', description: 'a', agent: agentFixture }, { title: 'B', description: 'b', agent: agentFixture }] },
    });
    expect(res.statusCode).toBe(200);
  });

  it('opens a new round in the same task and runs only its new parts', async () => {
    const callbacks = new Map<string, (name: string) => void>();
    const deps = testDeps((dir, onMarker) => {
      callbacks.set(dir, onMarker);
      return () => { callbacks.delete(dir); };
    });
    const app = buildServer(deps);
    try {
      const task = deps.store.createTask({ title: 'Example', description: 'First requirement' });
      const url = `/api/tasks/${task.id}`;
      const post = (operation: string, payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: `${url}/${operation}`, payload });
      const finishPart = (partId: string, output: string) => {
        const part = deps.store.getPart(partId)!;
        writeFileSync(part.resultPath, output);
        callbacks.get(join(task.workspacePath, 'parts', partId))?.('DONE');
      };

      const primary = { title: 'Implementation', description: 'Implement', agent: agentFixture };
      expect((await post('follow-up', { description: 'Too early', round: 1 })).statusCode).toBe(409);
      expect((await post('confirm', { round: 1, parts: [primary] })).statusCode).toBe(200);
      const first = deps.store.listParts(task.id)[0]!;
      finishPart(first.id, 'First result');
      expect(deps.store.getTask(task.id)?.status).toBe('done');
      writeFileSync(join(task.workspacePath, 'SUMMARY.md'), 'First summary');

      expect((await post('follow-up', { description: ' ', round: 1 })).statusCode).toBe(400);
      const submissions = await Promise.all([
        post('follow-up', { description: 'Second requirement', round: 1 }),
        post('follow-up', { description: 'Second requirement', round: 1 }),
      ]);
      expect(submissions.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      const reopened = submissions.find((response) => response.statusCode === 200)!.json<Task>();
      expect(reopened).toMatchObject({
        id: task.id, workspacePath: task.workspacePath, round: 2, status: 'planned',
        description: 'Second requirement', previousRequirements: ['First requirement'],
      });
      expect(reopened.parts).toMatchObject([{ id: first.id, round: 1, status: 'done' }]);
      expect((await app.inject({ url: `${url}/workspace` })).json().summary).toBe('');
      expect((await post('confirm', { round: 1, parts: [primary] })).statusCode).toBe(409);
      expect((await post('confirm', {
        round: 2,
        parts: [primary, { title: 'Review', description: 'Review new work', agent: agentFixture, dependsOn: primary.title }],
      })).statusCode).toBe(200);
      const [, implementation, review] = deps.store.listParts(task.id);
      expect(implementation).toMatchObject({ round: 2, status: 'running' });
      expect(review).toMatchObject({ round: 2, status: 'pending' });
      const shared = readFileSync(join(task.workspacePath, 'SHARED.md'), 'utf8');
      expect(shared).toContain('Current requirement (round 2):\nSecond requirement');
      expect(shared).toContain(first.resultPath);
      finishPart(implementation!.id, 'Second result');
      expect(deps.store.getPart(review!.id)?.status).toBe('running');
      finishPart(review!.id, 'Review result');
      expect(deps.store.getTask(task.id)?.status).toBe('done');
      expect(readFileSync(first.resultPath, 'utf8')).toBe('First result');
      expect((await post('follow-up', { description: 'Third requirement', round: 1 })).statusCode).toBe(409);
      expect((await post('follow-up', { description: 'Third requirement', round: 2 })).json()).toMatchObject({
        round: 3, previousRequirements: ['First requirement', 'Second requirement'],
      });
    } finally {
      await app.close();
    }
  });

  it('lists a directory for an agent workspace', async () => {
    const app = buildServer(testDeps());
    const dir = mkdtempSync(join(tmpdir(), 'wsdir-'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    const res = await app.inject({ method: 'GET', url: `/api/agents/a1/workspace?path=${encodeURIComponent(dir)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe(dir);
    expect(body.entries.some((e: any) => e.name === 'a.txt')).toBe(true);
  });

  it('returns the task workspace with SHARED.md', async () => {
    const app = buildServer(testDeps());
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    writeFileSync(join(t.workspacePath, 'SHARED.md'), 'hello');
    const res = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/workspace` });
    expect(res.statusCode).toBe(200);
    expect(res.json().shared).toBe('hello');
    expect(res.json().entries.some((e: any) => e.name === 'parts')).toBe(true);
  });

  it('imports a disk session by path', async () => {
    const app = buildServer(testDeps());
    const dir = mkdtempSync(join(tmpdir(), 'sess-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, '{"type":"output","data":"hi","ts":1}\n');
    const res = await app.inject({ method: 'GET', url: `/api/sessions/s1?path=${encodeURIComponent(file)}` });
    expect(res.json().map((e: any) => e.data)).toEqual(['hi']);
  });

  it('surfaces every agent kind that has real sessions, even when not running', async () => {
    const app = buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/agents' });
    const agents = res.json();
    expect(agents.some((a: any) => a.kind === 'claude')).toBe(true);
  });

  it('prefers the kind-based real session reader when a path is also given', async () => {
    const app = buildServer(testDeps());
    const res = await app.inject({ method: 'GET', url: '/api/sessions/c1?kind=claude&path=C%3A%2Fignored' });
    expect(res.json().map((e: any) => e.data)).toEqual(['user: hi']);
  });
  it('pauses, resumes, and cancels an active task', async () => {
    const deps = testDeps();
    const app = buildServer(deps);
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'PauseTest', description: 'bg' } })).json();
    await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/confirm`, payload: { parts: [{ title: 'A', description: 'a', agent: agentFixture }] } });
    expect(deps.store.getTask(t.id)?.status).toBe('active');

    expect((await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/pause` })).statusCode).toBe(200);
    expect(deps.store.getTask(t.id)?.status).toBe('paused');
    expect(deps.store.listParts(t.id)[0].status).toBe('pending');

    expect((await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/resume` })).statusCode).toBe(200);
    expect(deps.store.getTask(t.id)?.status).toBe('active');
    expect(deps.store.listParts(t.id)[0].status).toBe('running');

    expect((await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/cancel` })).statusCode).toBe(200);
    expect(deps.store.getTask(t.id)?.status).toBe('cancelled');
    expect(deps.store.listParts(t.id)[0].status).toBe('failed');
    await app.close();
  });
});

describe('desktop agents in tasks', () => {
  it('accepts WorkBuddy and DeepSeek Harness parts in confirm', async () => {
    const app = buildServer(testDeps());
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    const workbuddy = { id: 'w1', name: 'w', kind: 'workbuddy', command: 'workbuddy', cwd: 'C:/', status: 'discovered', managed: false };
    const dsh = { id: 'd1', name: 'd', kind: 'dsh', command: 'dsh', cwd: 'C:/', status: 'discovered', managed: false };
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${t.id}/confirm`,
      payload: { parts: [{ title: 'A', description: 'a', agent: workbuddy }, { title: 'B', description: 'b', agent: dsh }] },
    });
    expect(res.statusCode).toBe(200);
    const progress = (await app.inject({ method: 'GET', url: `/api/tasks/${t.id}/progress` })).json();
    expect(progress.map((p: any) => p.status)).toEqual(['running', 'running']);
  });
});
