import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { buildServer } from '../src/server';
import { EventHub } from '../src/api/events';
import { openDatabase } from '../src/db/database';
import { FsWorkspace } from '../src/tasks/workspace';
import { SqliteTaskStore } from '../src/tasks/store';
import { Orchestrator } from '../src/tasks/orchestrator';
import { JsonlSessionStore } from '../src/sessions/eventLog';
import { loadConfig } from '../src/config';

const adapter = {
  kind: 'claude' as const,
  displayName: 'Claude Code',
  binaries: ['claude'],
  supportsResume: true,
  launch: () => ({ file: 'claude', args: [] }),
};

function deps() {
  const root = mkdtempSync(join(tmpdir(), 'wsr-'));
  const proc = () => ({ pid: 1, write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} });
  const supervisor = { start: () => proc(), write: () => {}, onOutput: () => () => {}, isRunning: () => true, stop: () => {} } as any;
  const workspace = new FsWorkspace(root);
  const store = new SqliteTaskStore(openDatabase(':memory:'), workspace);
  const sessions = new JsonlSessionStore(root);
  const orchestrator = new Orchestrator({ supervisor, store, workspace, sessions, adapters: () => adapter });
  const planner = { requestSplitPlan: async () => [], completeRequirement: async () => 'req' } as any;
  const discovery = { scanAgents: async () => [], scanSessions: async () => [] };
  return { config: loadConfig(), discovery, orchestrator, planner, store, sessions, realSessions: { list: () => [], read: () => [] } };
}

describe('WS route', () => {
  it('delivers hub messages to a connected client', async () => {
    const hub = new EventHub();
    const app = buildServer({ ...deps(), hub });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const received = new Promise<any>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(String(data))));
    });
    await new Promise((r) => setTimeout(r, 50));
    hub.publish({ type: 'agent-output', agentId: 'a1', chunk: 'hi' });
    await expect(received).resolves.toEqual({ type: 'agent-output', agentId: 'a1', chunk: 'hi' });
    const closed = new Promise<void>((r) => ws.once('close', () => r()));
    ws.close();
    await closed;
    await app.close();
  }, 15000);
});
