import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { loadConfig } from './config';
import { openDatabase } from './db/database';
import { registerAdapters } from './agents/adapters/index';
import { getAdapter } from './agents/registry';
import { Discovery } from './agents/discovery';
import { RealSessionStore } from './agents/realSessions';
import { NodePtyFactory, NodePtySupervisor } from './pty/supervisor';
import { JsonlSessionStore } from './sessions/eventLog';
import { FsWorkspace } from './tasks/workspace';
import { SqliteTaskStore } from './tasks/store';
import { Orchestrator } from './tasks/orchestrator';
import { AgentPlanner } from './tasks/planner';
import { buildServer } from './server';
import { EventHub } from './api/events';
import { CodexAppServer } from './agents/codexAppServer';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const config = loadConfig();
  registerAdapters();

  const db = openDatabase(config.dbPath);
  const workspace = new FsWorkspace(config.workspaceRoot);
  const store = new SqliteTaskStore(db, workspace);
  const sessions = new JsonlSessionStore(config.eventRoot);
  const supervisor = new NodePtySupervisor(new NodePtyFactory());
  const orchestrator = new Orchestrator({
    supervisor,
    store,
    workspace,
    sessions,
    adapters: (kind) => getAdapter(kind),
    useOneShot: true,
  });
  const planner = new AgentPlanner({ supervisor, adapters: (kind) => getAdapter(kind) });
  const discovery = new Discovery({
    runner: {
      run: async (file, args) => {
        const { stdout } = await execFileAsync(file, args, { maxBuffer: 10 * 1024 * 1024, windowsHide: true });
        return stdout;
      },
    },
    homeDir: config.homeDir,
    readdir: (p) => readdir(p),
  });
  const realSessions = new RealSessionStore();
  const hub = new EventHub();
  const codex = new CodexAppServer();
  codex.subscribe((event) => {
    if (event.type === 'output') hub.publish({ type: 'codex-output', sessionId: event.sessionId, chunk: event.chunk });
    else if (event.type === 'completed') hub.publish({ type: 'codex-completed', sessionId: event.sessionId });
    else hub.publish({ type: 'codex-error', sessionId: event.sessionId, message: event.message });
  });

  const app = buildServer({ config, discovery, orchestrator, planner, store, sessions, realSessions, codex, hub });
  await app.listen({ host: '127.0.0.1', port: config.port });
  // eslint-disable-next-line no-console
  console.log(`agent workbench listening on http://127.0.0.1:${config.port}`);
}

void main();
