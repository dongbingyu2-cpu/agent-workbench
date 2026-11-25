import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server';
import { openDatabase } from '../src/db/database';
import { FsWorkspace } from '../src/tasks/workspace';
import { SqliteTaskStore } from '../src/tasks/store';
import { Orchestrator } from '../src/tasks/orchestrator';
import { JsonlSessionStore } from '../src/sessions/eventLog';
import { loadConfig } from '../src/config';

const agent = { id: 'a1', name: 'x', kind: 'claude' as const, command: 'claude', cwd: 'C:/', status: 'discovered' as const, managed: false };

function deps() {
  const root = mkdtempSync(join(tmpdir(), 'smoke-'));
  const proc = () => ({ pid: 1, write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} });
  const supervisor = { start: () => proc(), write: () => {}, onOutput: () => () => {}, isRunning: () => true, stop: () => {} } as any;
  const workspace = new FsWorkspace(root);
  const store = new SqliteTaskStore(openDatabase(':memory:'), workspace);
  const sessions = new JsonlSessionStore(root);
  const orchestrator = new Orchestrator({
    supervisor,
    store,
    workspace,
    sessions,
    adapters: () => ({ kind: 'claude', displayName: 'Claude Code', binaries: ['claude'], supportsResume: true, launch: () => ({ file: 'claude', args: [] }) }),
  });
  const planner = { requestSplitPlan: async () => [{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }], completeRequirement: async () => 'req' } as any;
  const discovery = { scanAgents: async () => [agent], scanSessions: async () => [] };
  return { config: loadConfig(), discovery, orchestrator, planner, store, sessions, realSessions: { list: () => [], read: () => [] } };
}

describe('workbench smoke', () => {
  it('discovers agents and drives create→plan→confirm→progress', async () => {
    const app = buildServer(deps());

    const agents = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(agents.statusCode).toBe(200);
    expect(agents.json()).toHaveLength(1);

    const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    const drafts = (await app.inject({ method: 'POST', url: `/api/tasks/${task.id}/plan`, payload: { agent } })).json();
    expect(drafts).toHaveLength(1);

    const confirm = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/confirm`,
      payload: { parts: drafts.map((d: any) => ({ title: d.title, description: d.description, agent })) },
    });
    expect(confirm.statusCode).toBe(200);

    const progress = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}/progress` })).json();
    expect(progress[0].status).toBe('running');
  });
});
