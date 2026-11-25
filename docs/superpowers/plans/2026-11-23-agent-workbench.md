# Agent Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user web workbench that discovers the user's own CLI agents (Claude Code, Codex, opencode, pi, workbuddy, generic), lets the user browse all sessions, dispatch tasks, split a task across agents (by hand or with an agent-proposed plan), watch progress, and coordinate via a shared workspace.

**Architecture:** A Node/TypeScript backend owns discovery, PTY supervision (node-pty/ConPTY), task orchestration, an append-only JSONL event log (source of truth), and a shared per-task workspace. A React/Vite frontend renders a multi-panel console over REST + WebSocket. Everything binds to `127.0.0.1` with no auth.

**Tech Stack:** TypeScript (strict), Node ≥ 20, Fastify, `ws`, `node-pty`, `better-sqlite3`, `chokidar`, React, Vite, Vitest, `@testing-library/react`, jsdom.

**Spec:** `docs/superpowers/specs/2026-11-23-agent-workbench-design.md`

## Global Constraints

- Platform: Windows; terminal control via `node-pty` (ConPTY). Code must not assume a Unix TTY.
- Backend binds to `127.0.0.1` only; no authentication.
- The append-only JSONL event log is the source of truth for sessions; disk agent logs are best-effort imports only.
- Completion uses the **self-report protocol**: a part's prompt instructs the agent to write `parts/<part-id>/RESULT.md` and then `parts/<part-id>/DONE`. The `DONE` marker is the completion signal.
- Supported agents: `claude`, `codex`, `opencode`, `pi`, `workbuddy`, `generic`. New agents are added as adapter configs, never by editing core modules.
- A task cannot be created with a non-empty description of fewer than 1 character; titles are trimmed and non-empty.
- TypeScript `strict: true`; no `any` in exported signatures.
- All IDs are `crypto.randomUUID()`.

## Review Focus

- **Agent exits mid-task (process death, crash).** A part must never stay `running` forever; it must flip to `failed` when the agent's PTY exits without a `DONE` marker. → test in Task 8.
- **`DONE` written before `RESULT.md` (or `RESULT.md` missing).** Status must still become `done`, `resultPath` stays empty, and the gap is logged; reading progress must not throw. → test in Task 8.
- **UTF-8 split across PTY chunk boundaries.** A multibyte character delivered in two chunks must not corrupt the output tail. → test in Task 4.
- **Two dispatches to the same agent before it finishes.** The second must be rejected (single-flight per agent), not interleaved into the PTY mid-run. → test in Task 7.
- **Malformed / unknown-format disk session import.** Import must skip bad lines and keep good ones; it must never throw out of `importDisk`. → test in Task 5.
- **Adoption with no `sessionId`.** Adopting an agent with no resumable session must throw a clear error, not spawn an unrelated fresh session. → test in Task 7.

## File Structure

```
package.json                      # npm workspaces: backend, frontend
tsconfig.base.json                # shared strict TS config
backend/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    config.ts                     # paths, port, workspace root, home dir
    db/
      database.ts                 # better-sqlite3 open + migrations
      schema.sql
    agents/
      types.ts                    # Agent, Session, Task, Part, Adapter, etc.
      registry.ts                 # adapter lookup + list
      adapters/
        claude.ts
        codex.ts
        opencode.ts
        pi.ts
        workbuddy.ts
        generic.ts
        index.ts                  # registerAdapters()
      processScanner.ts           # injectable CommandRunner + scanProcesses()
      discovery.ts                # process scan + session dir scan -> agents/sessions
    pty/
      supervisor.ts               # PtyFactory, PtyProcess, Supervisor
    sessions/
      eventLog.ts                 # SessionStore (JSONL append/read) + importDisk
    tasks/
      store.ts                    # TaskStore (SQLite CRUD for Task/Part)
      workspace.ts                # shared dir, SHARED.md, markers, chokidar watch
      orchestrator.ts             # dispatch, activate, adfort, progress, state machine
      planner.ts                  # agent-proposed split -> draft parts
    api/
      routes.ts                   # REST + WS wiring
    server.ts                     # buildServer(): Fastify + WebSocket
    index.ts                      # process entry: start server
  test/
    config.test.ts
    db.test.ts
    registry.test.ts
    discovery.test.ts
    supervisor.test.ts
    eventLog.test.ts
    taskStore.test.ts
    workspace.test.ts
    orchestrator.test.ts
    planner.test.ts
    api.test.ts
    ws.test.ts
frontend/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    api.ts                        # REST + WS client
    components/
      AgentList.tsx
      SessionViewer.tsx
      TaskBoard.tsx
      PartProgress.tsx
      SplitPlanDialog.tsx
  test/
    api.test.ts
    AgentList.test.tsx
    SessionViewer.test.tsx
    TaskBoard.test.tsx
    SplitPlanDialog.test.tsx
```

---

### Task 1: Project scaffold, config, and database

**Files:**
- Create: `package.json`, `tsconfig.base.json`
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`
- Create: `backend/src/config.ts`
- Create: `backend/src/db/schema.sql`
- Create: `backend/src/db/database.ts`
- Test: `backend/test/config.test.ts`, `backend/test/db.test.ts`

**Interfaces:**
- Produces:
  - `interface Config { port: number; homeDir: string; workspaceRoot: string; dbPath: string; eventRoot: string; }`
  - `loadConfig(overrides?: Partial<Config>): Config`
  - `openDatabase(path: string): Database` where `Database` is the `better-sqlite3` instance (imported type `Database from 'better-sqlite3'`).

- [ ] **Step 1: Create the workspace scaffold and dependencies**

`package.json`:
```json
{
  "name": "agent-workbench",
  "private": true,
  "workspaces": ["backend", "frontend"],
  "scripts": { "test": "npm -w backend test && npm -w frontend test" }
}
```
`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noImplicitOverride": true, "esModuleInterop": true,
    "skipLibCheck": true, "forceConsistentCasingInFileNames": true
  }
}
```
`backend/package.json` dependencies: `fastify`, `@fastify/websocket`, `ws`, `node-pty`, `better-sqlite3`, `chokidar`; dev: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/better-sqlite3`, `@types/ws`. `backend/tsconfig.json` extends `../tsconfig.base.json` and includes `src`, `test`.

- [ ] **Step 2: Write the failing test for config and database**

`backend/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('defaults port to 4177 and binds locally', () => {
    const c = loadConfig();
    expect(c.port).toBe(4177);
    expect(c.workspaceRoot).toMatch(/workspace$/);
    expect(c.dbPath).toMatch(/workbench\.db$/);
  });
  it('applies overrides', () => {
    const c = loadConfig({ port: 5000 });
    expect(c.port).toBe(5000);
  });
});
```
`backend/test/db.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db/database';

describe('openDatabase', () => {
  it('creates the tasks and parts tables', () => {
    const db = openDatabase(':memory:');
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    expect(names).toContain('tasks');
    expect(names).toContain('parts');
    db.close();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm -w backend test -- config db`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `config.ts`, `schema.sql`, `database.ts`**

`config.ts` exports `Config` and `loadConfig(overrides?)`; defaults `port: 4177`, `homeDir: os.homedir()`, `workspaceRoot: path.join(repoRoot, 'workspace')`, `dbPath: path.join(repoRoot, 'workbench.db')`, `eventRoot: path.join(repoRoot, 'events')`. `database.ts` opens the DB (creating parent dir), reads `schema.sql`, and runs `db.exec(schema)`; `schema.sql` creates `tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, workspace_path TEXT NOT NULL, status TEXT NOT NULL)` and `parts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, assigned_agent_id TEXT, status TEXT NOT NULL, result_path TEXT NOT NULL, done_marker TEXT NOT NULL)`.

- [ ] **Step 5: Run the tests to verify they pass, then commit**

Run: `npm -w backend test -- config db`
Expected: PASS (all).

```bash
git add package.json tsconfig.base.json backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/src/config.ts backend/src/db backend/test/config.test.ts backend/test/db.test.ts
git commit -m "feat: scaffold workbench backend with config and sqlite schema"
```

---

### Task 2: Domain types and adapter registry

**Files:**
- Create: `backend/src/agents/types.ts`
- Create: `backend/src/agents/registry.ts`
- Create: `backend/src/agents/adapters/{claude,codex,opencode,pi,workbuddy,generic,index}.ts`
- Test: `backend/test/registry.test.ts`

**Interfaces:**
- Produces (from `types.ts`):
  - `type AgentKind = 'claude'|'codex'|'opencode'|'pi'|'workbuddy'|'generic'`
  - `interface AgentAdapter { kind: AgentKind; displayName: string; binaries: string[]; supportsResume: boolean; launch(opts: { resumeSessionId?: string; cwd: string }): { file: string; args: string[] }; }`
  - `interface Agent`, `Session`, `SessionEvent`, `Task`, `Part`, `TaskStatus`, `PartStatus` (exactly as in the spec's data model).
- Produces (from `registry.ts`): `registerAdapter(a: AgentAdapter): void`, `getAdapter(kind: AgentKind): AgentAdapter` (returns the `generic` adapter for unknown kinds), `listAdapters(): AgentAdapter[]`.

- [ ] **Step 1: Write the failing test**

`backend/test/registry.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { registerAdapters } from '../src/agents/adapters/index';
import { getAdapter, listAdapters } from '../src/agents/registry';

describe('adapter registry', () => {
  registerAdapters();
  it('resolves claude with a resume launch command', () => {
    const a = getAdapter('claude');
    expect(a.binaries).toContain('claude');
    const cmd = a.launch({ resumeSessionId: 'abc', cwd: 'C:/x' });
    expect(cmd.file).toBe('claude');
    expect(cmd.args).toContain('--resume');
    expect(cmd.args).toContain('abc');
  });
  it('falls back to generic for unknown kinds', () => {
    const a = getAdapter('mystery' as any);
    expect(a.kind).toBe('generic');
  });
  it('lists every supported kind', () => {
    const kinds = listAdapters().map((a) => a.kind);
    for (const k of ['claude','codex','opencode','pi','workbuddy','generic']) expect(kinds).toContain(k);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- registry`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement types, adapters, and registry**

Implement `types.ts` with the interfaces verbatim from the spec data model. Each adapter file exports one `AgentAdapter` with `binaries` (`['claude']`, `['codex']`, `['opencode']`, `['pi']`, `['workbuddy']`, `[]`). `launch` returns `{ file: binaries[0] ?? 'bash', args: resumeSessionId ? ['--resume', resumeSessionId] : [] }` (use `--continue` only for the `codex` adapter on resume, per its CLI; the exact flag is verified during execution). `generic` has `supportsResume: false` and `launch` returning `{ file: 'sh', args: [] }`. `adapters/index.ts` `registerAdapters()` calls `registerAdapter` for all six. `registry.ts` holds a `Map<AgentKind, AgentAdapter>`; `getAdapter` returns `map.get(kind) ?? map.get('generic')!`.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- registry`
Expected: PASS.

```bash
git add backend/src/agents backend/test/registry.test.ts
git commit -m "feat: add domain types and pluggable agent adapter registry"
```

---

### Task 3: Process scanner and discovery

**Files:**
- Create: `backend/src/agents/processScanner.ts`
- Create: `backend/src/agents/discovery.ts`
- Test: `backend/test/discovery.test.ts`

**Interfaces:**
- Produces (processScanner): `interface CommandRunner { run(file: string, args: string[]): Promise<string>; }`, `scanProcesses(runner: CommandRunner, platform: NodeJS.Platform): Promise<RawProcess[]>` where `interface RawProcess { pid: number; name: string; cmdline: string; }`.
- Produces (discovery): `interface DiscoveryRepo { scanAgents(): Promise<Agent[]>; scanSessions(): Promise<Session[]>; }`, `class Discovery implements DiscoveryRepo` with `constructor(deps: { runner: CommandRunner; homeDir: string; readdir: (p: string) => Promise<string[]> })`.

- [ ] **Step 1: Write the failing test**

`backend/test/discovery.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scanProcesses } from '../src/agents/processScanner';
import { Discovery } from '../src/agents/discovery';

const runner = { run: async () => JSON.stringify([{ pid: 10, name: 'claude.exe', cmdline: 'claude --resume abc' }]) };

describe('scanProcesses', () => {
  it('parses powershell JSON output into raw processes', async () => {
    const ps = await scanProcesses(runner, 'win32');
    expect(ps).toEqual([{ pid: 10, name: 'claude.exe', cmdline: 'claude --resume abc' }]);
  });
});

describe('Discovery', () => {
  it('maps running claude to a discovered agent with the session id', async () => {
    const d = new Discovery({ runner, homeDir: 'C:/home', readdir: async () => [] });
    const agents = await d.scanAgents();
    expect(agents[0]).toMatchObject({ kind: 'claude', managed: false, status: 'discovered', sessionId: 'abc' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- discovery`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement scanner and discovery**

`scanProcesses` on `win32` runs `runner.run('powershell', ['-NoProfile','-Command', "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"])` and parses JSON into `RawProcess[]`; on other platforms run `ps -eo pid=,comm=,args=` and parse. `Discovery.scanAgents` matches each process `name`/`cmdline` against `listAdapters().binaries`, extracts a session id from the cmdline (`--resume <id>`), and returns `Agent` with `status: 'discovered'`, `managed: false`, `command` = binary. `scanSessions` walks `homeDir`-relative session dirs per adapter and returns `Session` records (source `'disk'`); no parsing of file bodies here.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- discovery`
Expected: PASS.

```bash
git add backend/src/agents/processScanner.ts backend/src/agents/discovery.ts backend/test/discovery.test.ts
git commit -m "feat: scan processes and disk sessions into discovered agents"
```

---

### Task 4: PTY supervisor

**Files:**
- Create: `backend/src/pty/supervisor.ts`
- Test: `backend/test/supervisor.test.ts`

**Interfaces:**
- Produces:
  - `interface PtyProcess { pid: number; write(data: string): void; onData(cb: (data: Buffer) => void): void; onExit(cb: (code: number) => void): void; kill(): void; }`
  - `interface PtyFactory { spawn(file: string, args: string[], opts: { cwd: string; env?: Record<string,string> }): PtyProcess; }`
  - `interface Supervisor { start(agentId: string, file: string, args: string[], cwd: string): PtyProcess; write(agentId: string, data: string): void; onOutput(agentId: string, cb: (chunk: string) => void): () => void; stop(agentId: string): void; isRunning(agentId: string): boolean; }`
  - `class NodePtySupervisor implements Supervisor` with `constructor(factory: PtyFactory)`.
  - `class NodePtyFactory implements PtyFactory` wrapping `node-pty`.

- [ ] **Step 1: Write the failing test (including the multibyte-chunk case)**

`backend/test/supervisor.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { NodePtySupervisor } from '../src/pty/supervisor';

function fakeFactory() {
  const listeners: Array<(b: Buffer) => void> = [];
  const exit: Array<(c: number) => void> = [];
  const proc = {
    pid: 99,
    write: vi.fn(),
    onData: (cb: (b: Buffer) => void) => listeners.push(cb),
    onExit: (cb: (c: number) => void) => exit.push(cb),
    kill: vi.fn(),
  };
  const factory = { spawn: vi.fn(() => proc) };
  return { factory, proc, emit: (b: Buffer) => listeners.forEach((l) => l(b)), exit: (c: number) => exit.forEach((e) => e(c)) };
}

describe('NodePtySupervisor', () => {
  it('writes to the running agent and forbids double start', () => {
    const { factory, proc } = fakeFactory();
    const s = new NodePtySupervisor(factory as any);
    s.start('a1', 'claude', ['--resume', 'abc'], 'C:/x');
    s.write('a1', 'hello\n');
    expect(proc.write).toHaveBeenCalledWith('hello\n');
    expect(() => s.start('a1', 'claude', [], 'C:/x')).toThrow(/already running/);
  });
  it('reassembles a multibyte character split across chunks', () => {
    const { factory, emit } = fakeFactory();
    const s = new NodePtySupervisor(factory as any);
    const seen: string[] = [];
    s.start('a1', 'claude', [], 'C:/x');
    s.onOutput('a1', (c) => seen.push(c));
    emit(Buffer.from('你').subarray(0, 2));
    emit(Buffer.from('你').subarray(2));
    expect(seen.join('')).toBe('你');
  });
  it('drops the agent when it exits', () => {
    const { factory, exit } = fakeFactory();
    const s = new NodePtySupervisor(factory as any);
    s.start('a1', 'claude', [], 'C:/x');
    exit(1);
    expect(s.isRunning('a1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- supervisor`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the supervisor**

`NodePtySupervisor` keeps a `Map<string, PtyProcess>`. `start` throws `Error('agent already running: <id>')` if present; otherwise stores it and subscribes `onExit` to delete the entry. `write` throws if not running. `onOutput` registers a callback and returns an unsubscribe. Decode PTY bytes with a `StringDecoder('utf8')` held per agent so multibyte characters split across chunks are reassembled before emitting. `stop` kills and deletes. `isRunning` checks the map. `NodePtyFactory.spawn` calls `pty.spawn(file, args, { cwd, env, name: 'xterm-color' })`.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- supervisor`
Expected: PASS.

```bash
git add backend/src/pty/supervisor.ts backend/test/supervisor.test.ts
git commit -m "feat: add node-pty supervisor with utf8 chunk reassembly"
```

---

### Task 5: Session event log and disk import

**Files:**
- Create: `backend/src/sessions/eventLog.ts`
- Test: `backend/test/eventLog.test.ts`

**Interfaces:**
- Produces: `interface SessionStore { append(sessionId: string, event: SessionEvent): void; read(sessionId: string, opts?: { limit?: number }): SessionEvent[]; importDisk(path: string, agentId: string): Session; }`
- `class JsonlSessionStore implements SessionStore` with `constructor(rootDir: string)`.

- [ ] **Step 1: Write the failing test (including the malformed-import case)**

`backend/test/eventLog.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlSessionStore } from '../src/sessions/eventLog';

describe('JsonlSessionStore', () => {
  it('appends and reads events in order', () => {
    const store = new JsonlSessionStore(mkdtempSync(join(tmpdir(), 'ev-')));
    store.append('s1', { ts: 1, type: 'output', data: 'a' });
    store.append('s1', { ts: 2, type: 'output', data: 'b' });
    expect(store.read('s1').map((e) => e.data)).toEqual(['a', 'b']);
    expect(store.read('s1', { limit: 1 })).toHaveLength(1);
  });
  it('skips malformed lines on import instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ev-'));
    const file = join(dir, 's.jsonl');
    writeFileSync(file, '{"type":"output","data":"ok","ts":1}\nnot-json\n{"type":"output","data":"tail","ts":2}\n');
    const store = new JsonlSessionStore(dir);
    const session = store.importDisk(file, 'a1');
    expect(session.events.map((e) => e.data)).toEqual(['ok', 'tail']);
    expect(session.source).toBe('disk');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- eventLog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `eventLog.ts`**

`JsonlSessionStore` writes `append` as `JSON.stringify(event) + '\n'` to `<rootDir>/<sessionId>.jsonl` (mkdir -p on root). `read` reads the file (returns `[]` if missing), parses non-empty lines, drops unparseable lines, and applies `limit` (last N). `importDisk(path, agentId)` reads a foreign JSONL, maps each line to a `SessionEvent` when it has a recognizable text payload (`data`/`text`/`content`), skips the rest, and returns a `Session` with `source: 'disk'`, `events` in file order. Never throws on I/O or parse errors.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- eventLog`
Expected: PASS.

```bash
git add backend/src/sessions/eventLog.ts backend/test/eventLog.test.ts
git commit -m "feat: add append-only jsonl session store with tolerant import"
```

---

### Task 6: Task store and shared workspace

**Files:**
- Create: `backend/src/tasks/store.ts`
- Create: `backend/src/tasks/workspace.ts`
- Test: `backend/test/taskStore.test.ts`, `backend/test/workspace.test.ts`

**Interfaces:**
- Produces (store): `interface TaskStore` with `createTask(input: { title: string; description: string }): Task`, `getTask(id: string): Task | undefined`, `listTasks(): Task[]`, `updateTaskStatus(id: string, status: TaskStatus): void`, `addPart(taskId: string, input: { title: string; description: string; assignedAgentId: string | null; status: PartStatus }): Part`, `getPart(id: string): Part | undefined`, `listParts(taskId: string): Part[]`, `updatePart(id: string, patch: Partial<Pick<Part,'status'|'assignedAgentId'>>): void`. `class SqliteTaskStore implements TaskStore` with `constructor(db: Database, workspace: Workspace)`.
- Produces (workspace): `interface Workspace { taskDir(taskId: string): string; ensureTaskDir(taskId: string): string; writeShared(taskId: string, background: string): void; partDir(taskId: string, partId: string): string; resultPath(taskId: string, partId: string): string; donePath(taskId: string, partId: string): string; readResult(taskId: string, partId: string): string; watchPartCompletion(taskId: string, partId: string, onDone: () => void): () => void; }`. `class FsWorkspace implements Workspace` with `constructor(root: string, watch?: (dir: string, cb: (name: string) => void) => () => void)`.

- [ ] **Step 1: Write the failing tests**

`backend/test/taskStore.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/database';
import { FsWorkspace } from '../src/tasks/workspace';
import { SqliteTaskStore } from '../src/tasks/store';

describe('SqliteTaskStore', () => {
  it('creates a task with a workspace and its parts', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const store = new SqliteTaskStore(openDatabase(':memory:'), new FsWorkspace(root));
    const task = store.createTask({ title: 'Login', description: 'build login' });
    expect(task.status).toBe('planned');
    const part = store.addPart(task.id, { title: 'A', description: 'ui', assignedAgentId: 'a1', status: 'pending' });
    expect(store.listParts(task.id)).toHaveLength(1);
    store.updatePart(part.id, { status: 'done' });
    expect(store.getPart(part.id)!.status).toBe('done');
  });
  it('rejects an empty title', () => {
    const store = new SqliteTaskStore(openDatabase(':memory:'), new FsWorkspace(mkdtempSync(join(tmpdir(), 'ws-'))));
    expect(() => store.createTask({ title: '  ', description: 'x' })).toThrow(/title/);
  });
});
```
`backend/test/workspace.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsWorkspace } from '../src/tasks/workspace';

describe('FsWorkspace', () => {
  it('creates the task dir and SHARED.md', () => {
    const ws = new FsWorkspace(mkdtempSync(join(tmpdir(), 'ws-')));
    ws.ensureTaskDir('t1');
    ws.writeShared('t1', 'background');
    expect(existsSync(join(ws.taskDir('t1'), 'SHARED.md'))).toBe(true);
  });
  it('fires onDone when the DONE marker appears', () => {
    const watched: string[] = [];
    const fakeWatch = (dir: string, cb: (n: string) => void) => { watched.push(dir); cb('DONE'); return () => {}; };
    const ws = new FsWorkspace(mkdtempSync(join(tmpdir(), 'ws-')), fakeWatch as any);
    let called = 0;
    ws.watchPartCompletion('t1', 'p1', () => { called++; });
    expect(called).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w backend test -- taskStore workspace`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `store.ts` and `workspace.ts`**

`SqliteTaskStore.createTask` trims title, throws `Error('task title is required')` on empty, inserts a row with `status: 'planned'`, then calls `workspace.ensureTaskDir(id)` and returns the `Task`. `addPart` inserts and returns the `Part` (status from input). `listParts` orders by insertion (rowid). `updatePart`/`updateTaskStatus` update the row. `FsWorkspace` builds `taskDir = <root>/<taskId>`, `partDir = taskDir/parts/<partId>`, `resultPath = partDir/RESULT.md`, `donePath = partDir/DONE`; `ensureTaskDir` mkdir-p's `partDir` parents and returns `taskDir`; `writeShared` writes `SHARED.md`; `readResult` returns file contents or `''`; `watchPartCompletion` uses the injected `watch` (default `chokidar.watch`) on `partDir`, calling `onDone` once when the basename equals `DONE`, and returns an unsubscribe.

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npm -w backend test -- taskStore workspace`
Expected: PASS.

```bash
git add backend/src/tasks/store.ts backend/src/tasks/workspace.ts backend/test/taskStore.test.ts backend/test/workspace.test.ts
git commit -m "feat: add sqlite task store and fs shared workspace"
```

---

### Task 7: Orchestrator — adopt, single dispatch, progress

**Files:**
- Create: `backend/src/tasks/orchestrator.ts`
- Test: `backend/test/orchestrator.test.ts`

**Interfaces:**
- Produces: `interface OrchestratorDeps { supervisor: Supervisor; store: TaskStore; workspace: Workspace; sessions: SessionStore; adapters: (kind: AgentKind) => AgentAdapter; }`, `class Orchestrator implements { adopt(agent: Agent): void; dispatchToAgent(agent: Agent, instruction: string): void; progress(taskId: string): PartProgress[]; }`, `interface PartProgress { partId: string; status: PartStatus; tail: string; resultPath: string; }`.

- [ ] **Step 1: Write the failing test (adopt-without-session + concurrent dispatch)**

`backend/test/orchestrator.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator } from '../src/tasks/orchestrator';
import { SqliteTaskStore } from '../src/tasks/store';
import { FsWorkspace } from '../src/tasks/workspace';
import { JsonlSessionStore } from '../src/sessions/eventLog';
import { openDatabase } from '../src/db/database';
import { NodePtySupervisor } from '../src/pty/supervisor';
import { getAdapter } from '../src/agents/registry';
import { registerAdapters } from '../src/agents/adapters/index';

function deps() {
  registerAdapters();
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  const supervisor = new NodePtySupervisor({ spawn: () => ({ pid: 1, write: vi.fn(), onData: () => {}, onExit: () => {}, kill: vi.fn() }) } as any);
  const store = new SqliteTaskStore(openDatabase(':memory:'), new FsWorkspace(root));
  return { supervisor, store, workspace: new FsWorkspace(root), sessions: new JsonlSessionStore(root), adapters: getAdapter, root };
}

describe('Orchestrator', () => {
  it('throws when adopting an agent with no session id', () => {
    const o = new Orchestrator(deps() as any);
    expect(() => o.adopt({ id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false })).toThrow(/session/i);
  });
  it('rejects a second dispatch to a busy agent', () => {
    const d = deps();
    const o = new Orchestrator(d as any);
    o.dispatchToAgent({ id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false }, 'do 1');
    expect(() => o.dispatchToAgent({ id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false }, 'do 2')).toThrow(/busy|running/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- orchestrator`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `orchestrator.ts`**

`adopt(agent)`: if `!agent.sessionId` throw `Error('cannot adopt agent without a session id')`; resolve the adapter, `supervisor.start(agent.id, cmd.file, cmd.args, agent.cwd)`, subscribe output to `sessions.append(agent.id, { ts: Date.now(), type: 'output', data: chunk })`, mark busy. `dispatchToAgent(agent, instruction)`: if the agent id is in a busy set, throw `Error('agent busy: <id>')`; if not started, start via adapter (fresh launch); `supervisor.write(agent.id, instruction + '\n')`; record busy. `progress(taskId)`: map each part to `{ partId, status, tail: last 2000 chars of this part's stream buffer, resultPath }`. Implement `tail` from an in-memory per-part ring buffer populated by `onOutput` routing.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- orchestrator`
Expected: PASS.

```bash
git add backend/src/tasks/orchestrator.ts backend/test/orchestrator.test.ts
git commit -m "feat: add orchestrator adopt, dispatch, and progress"
```

---

### Task 8: Split-task activation and self-report completion

**Files:**
- Modify: `backend/src/tasks/orchestrator.ts` (add `activateTask`, termination hooks)
- Test: `backend/test/orchestrator.test.ts` (extend)

**Interfaces:**
- Consumes: `Workspace` and `SessionStore` from Task 6/5; `supervisor.onExit` event from Task 4.
- Produces: `activateTask(taskId: string, parts: Array<{ part: Part; agent: Agent }>): void` on `Orchestrator`; a helper `buildPartPrompt(part: Part, background: string): string`.

- [ ] **Step 1: Write the failing tests (exit-without-DONE, DONE-without-RESULT, prompt content)**

Extend `backend/test/orchestrator.test.ts`:
```ts
it('marks a part failed when its agent exits without DONE', () => {
  const d = deps();
  const exitCbs: Array<(c: number) => void> = [];
  (d.supervisor as any).start = vi.fn(() => ({ pid: 1, write: vi.fn(), onData: () => {}, onExit: (cb: any) => exitCbs.push(cb), kill: vi.fn() }));
  const o = new Orchestrator(d as any);
  const task = d.store.createTask({ title: 'T', description: 'bg' });
  const part = d.store.addPart(task.id, { title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending' });
  const agent = { id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false } as any;
  o.activateTask(task.id, [{ part, agent }]);
  exitCbs.forEach((cb) => cb(1));
  expect(d.store.getPart(part.id)!.status).toBe('failed');
});

it('marks a part done when DONE appears, even if RESULT.md is missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  const ws = new FsWorkspace(root, ((dir: string, cb: (n: string) => void) => { cb('DONE'); return () => {}; }) as any);
  // build orchestrator with this ws (same deps helper, override workspace)
  const d = deps();
  const o = new Orchestrator({ ...d, workspace: ws } as any);
  const task = d.store.createTask({ title: 'T', description: 'bg' });
  const part = d.store.addPart(task.id, { title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending' });
  const agent = { id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false } as any;
  o.activateTask(task.id, [{ part, agent }]);
  expect(d.store.getPart(part.id)!.status).toBe('done');
});

it('builds a prompt that names the part dir, SHARED.md, RESULT.md and DONE', () => {
  const p = buildPartPrompt({ id: 'p1', taskId: 't1', title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending', resultPath: 'C:/ws/t1/parts/p1/RESULT.md', doneMarker: 'C:/ws/t1/parts/p1/DONE' }, 'bg');
  expect(p).toContain('SHARED.md');
  expect(p).toContain('RESULT.md');
  expect(p).toContain('DONE');
  expect(p).toContain('do a');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w backend test -- orchestrator`
Expected: FAIL — `activateTask` / `buildPartPrompt` not defined.

- [ ] **Step 3: Implement `activateTask` and `buildPartPrompt`**

`activateTask(taskId, parts)`: write `background` from `store.getTask(taskId)!.description` into `workspace.writeShared`; set task status `active`; for each `{part, agent}`: ensure the part dir, set part `running`, start the agent under the supervisor, register `onExit` (if the part is still `running`, set `failed`), and register `workspace.watchPartCompletion(taskId, part.id, () => { store.updatePart(part.id, { status: 'done' }); })`; then `write` the `buildPartPrompt` into the PTY. `buildPartPrompt` returns a string containing the background, the part title/description, the result path, and the instruction "write `RESULT.md` first, then create the `DONE` file."

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npm -w backend test -- orchestrator`
Expected: PASS (all orchestrator tests).

```bash
git add backend/src/tasks/orchestrator.ts backend/test/orchestrator.test.ts
git commit -m "feat: activate split tasks with self-report completion and exit failure"
```

---

### Task 9: Planner (agent-proposed split, user-confirmed)

**Files:**
- Create: `backend/src/tasks/planner.ts`
- Test: `backend/test/planner.test.ts`

**Interfaces:**
- Produces: `interface PartDraft { title: string; description: string; suggestedAgentId: string | null; }`, `interface Planner { requestSplitPlan(task: Task, plannerAgent: Agent): Promise<PartDraft[]>; }`, `class AgentPlanner implements Planner` with `constructor(deps: { supervisor: Supervisor; timeoutMs?: number })`.
- Behavior: `requestSplitPlan` asks the agent and returns drafts; it does **not** write parts or dispatch.

- [ ] **Step 1: Write the failing test**

`backend/test/planner.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { AgentPlanner } from '../src/tasks/planner';

function fakeSup() {
  let cb: ((s: string) => void) | null = null;
  let write = vi.fn();
  return {
    supervisor: { start: vi.fn(), write, onOutput: (_id: string, c: (s: string) => void) => { cb = c; return () => {}; }, isRunning: () => true, stop: vi.fn() } as any,
    emit: (s: string) => cb && cb(s),
    get write() { return write; },
  };
}

describe('AgentPlanner', () => {
  it('parses a JSON split plan into drafts without dispatching', async () => {
    const s = fakeSup();
    const p = new AgentPlanner({ supervisor: s.supervisor, timeoutMs: 50 });
    const task = { id: 't1', title: 'T', description: 'bg', workspacePath: 'C:/w/t1', status: 'planned', parts: [] } as any;
    const agent = { id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false } as any;
    const promise = p.requestSplitPlan(task, agent);
    s.emit('here you go: [{"title":"A","description":"do a","agentId":"a1"}]');
    await expect(promise).resolves.toEqual([{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }]);
    expect(s.write).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- planner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `planner.ts`**

`AgentPlanner.requestSplitPlan` starts the agent under the supervisor (if not running), subscribes `onOutput`, writes a prompt asking for a JSON array of `{title, description, agentId}` and nothing else, and resolves when a balanced JSON array appears in the accumulated output (or rejects with `Error('planner timeout')` after `timeoutMs`, default 60000). Map each element to `PartDraft`. Never call `store.addPart` or the orchestrator.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- planner`
Expected: PASS.

```bash
git add backend/src/tasks/planner.ts backend/test/planner.test.ts
git commit -m "feat: add agent-proposed split planner that returns drafts only"
```

---

### Task 10: REST API

**Files:**
- Create: `backend/src/api/routes.ts`
- Create: `backend/src/server.ts`
- Create: `backend/src/index.ts`
- Test: `backend/test/api.test.ts`

**Interfaces:**
- Produces: `buildServer(deps: { config: Config; discovery: DiscoveryRepo; orchestrator: Orchestrator; planner: Planner; store: TaskStore; sessions: SessionStore }): FastifyInstance`; routes:
  - `GET /api/agents` → `Agent[]`
  - `POST /api/agents/:id/adopt` (body `{ agent: Agent }`) → `{ ok: true }`
  - `POST /api/agents/:id/dispatch` (body `{ agent: Agent; instruction: string }`) → `{ ok: true }`
  - `GET /api/sessions/:id` → `SessionEvent[]`
  - `GET /api/tasks` → `Task[]`
  - `POST /api/tasks` (body `{ title: string; description: string }`) → `Task`
  - `POST /api/tasks/:id/plan` (body `{ agent: Agent }`) → `PartDraft[]`
  - `POST /api/tasks/:id/confirm` (body `{ parts: Array<{ title: string; description: string; agent: Agent }> }`) → `{ ok: true }`
  - `GET /api/tasks/:id/progress` → `PartProgress[]`

- [ ] **Step 1: Write the failing test**

`backend/test/api.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildServer } from '../src/server';

describe('REST API', () => {
  it('creates a task and lists it', async () => {
    const app = buildServer(testDeps());
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Login', description: 'bg' } });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(list.json()).toHaveLength(1);
  });
  it('returns drafts from /plan and nothing on /confirm without parts', async () => {
    const app = buildServer(testDeps());
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T', description: 'bg' } })).json();
    const plan = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/plan`, payload: { agent: agentFixture } });
    expect(Array.isArray(plan.json())).toBe(true);
    const confirm = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/confirm`, payload: { parts: [] } });
    expect(confirm.statusCode).toBe(200);
  });
});
```
(Define `testDeps()` and `agentFixture` in the test using in-memory DB, fake supervisor/planner/sessions.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- api`
Expected: FAIL — `buildServer` not found.

- [ ] **Step 3: Implement routes, server, and entrypoint**

`routes.ts` registers all endpoints; input validation returns `400` via Fastify schemas; `/plan` returns drafts (no persistence); `/confirm` creates the `Part`s (status `pending`) for the given drafts `{ title, description, agent }`, then calls `orchestrator.activateTask`. `server.ts` creates Fastify, registers routes, and (Task 11) the WS plugin. `index.ts` wires real deps (`loadConfig`, `openDatabase`, `Discovery`, `NodePtySupervisor`, `JsonlSessionStore`, `FsWorkspace`, `SqliteTaskStore`, `Orchestrator`, `AgentPlanner`) and calls `app.listen({ host: '127.0.0.1', port })`.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- api`
Expected: PASS.

```bash
git add backend/src/api/routes.ts backend/src/server.ts backend/src/index.ts backend/test/api.test.ts
git commit -m "feat: expose rest api for agents, tasks, plan, confirm, progress"
```

---

### Task 11: WebSocket streaming

**Files:**
- Modify: `backend/src/server.ts` (register WS)
- Create: `backend/src/api/events.ts` (hub)
- Test: `backend/test/ws.test.ts`

**Interfaces:**
- Produces: `class EventHub { subscribe(fn: (msg: WsMessage) => void): () => void; publish(msg: WsMessage): void; }` where `type WsMessage = { type: 'agent-output'; agentId: string; chunk: string } | { type: 'task-progress'; taskId: string; parts: PartProgress[] }`; `buildServer` accepts `hub?: EventHub` and, when present, forwards orchestrator output and completion events to it.

- [ ] **Step 1: Write the failing test**

`backend/test/ws.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { EventHub } from '../src/api/events';

describe('EventHub', () => {
  it('delivers published messages to subscribers and unsubscribes', () => {
    const hub = new EventHub();
    const got: any[] = [];
    const off = hub.subscribe((m) => got.push(m));
    hub.publish({ type: 'agent-output', agentId: 'a1', chunk: 'hi' });
    off();
    hub.publish({ type: 'agent-output', agentId: 'a1', chunk: 'gone' });
    expect(got).toEqual([{ type: 'agent-output', agentId: 'a1', chunk: 'hi' }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- ws` → FAIL (module missing).

- [ ] **Step 3: Implement the hub and wire WS**

`EventHub` holds a `Set` of subscribers; `publish` fans out; `subscribe` returns an unsubscribe. In `server.ts`, register `@fastify/websocket` at `/ws`, and on connection subscribe to the hub and `socket.send(JSON.stringify(msg))`. Orchestrator's output and part-status transitions publish into the hub.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w backend test -- ws` → PASS.

```bash
git add backend/src/api/events.ts backend/src/server.ts backend/test/ws.test.ts
git commit -m "feat: stream agent output and task progress over websocket"
```

---

### Task 12: Frontend scaffold and API client

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/index.html`
- Create: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/api.ts`
- Test: `frontend/test/api.test.ts`

**Interfaces:**
- Produces (`api.ts`): `interface Client { listAgents(): Promise<Agent[]>; adopt(id: string, agent: Agent): Promise<void>; dispatch(id: string, agent: Agent, instruction: string): Promise<void>; listSessions(id: string): Promise<SessionEvent[]>; listTasks(): Promise<Task[]>; createTask(title: string, description: string): Promise<Task>; plan(taskId: string, agent: Agent): Promise<PartDraft[]>; confirm(taskId: string, parts: Array<{ title: string; description: string; agent: Agent }>): Promise<void>; progress(taskId: string): Promise<PartProgress[]>; subscribe(fn: (m: WsMessage) => void): () => void; }`, `createClient(baseUrl: string, fetchImpl?: typeof fetch): Client`, and `types.ts` mirroring backend domain types.

- [ ] **Step 1: Write the failing test**

`frontend/test/api.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/api';

describe('createClient', () => {
  it('creates a task with POST /api/tasks', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 't1' }) })) as any;
    const c = createClient('http://127.0.0.1:4177', fetchImpl);
    await c.createTask('T', 'bg');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4177/api/tasks', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w frontend test -- api` → FAIL (module missing).

- [ ] **Step 3: Implement `api.ts` and scaffold Vite**

`createClient` centralizes `fetch` with `JSON.stringify` bodies and `res.ok` checks (throw on non-ok). `subscribe` uses `new WebSocket(baseUrl.replace('http','ws') + '/ws')` and forwards parsed messages. `App.tsx` renders a three-pane placeholder shell. Vite config proxies `/api` and `/ws` to `http://127.0.0.1:4177`.

- [ ] **Step 4: Run the test to verify it passes, then commit**

Run: `npm -w frontend test -- api` → PASS.

```bash
git add frontend
git commit -m "feat: scaffold react frontend and typed api client"
```

---

### Task 13: Agent list and session viewer

**Files:**
- Create: `frontend/src/components/AgentList.tsx`, `frontend/src/components/SessionViewer.tsx`
- Test: `frontend/test/AgentList.test.tsx`, `frontend/test/SessionViewer.test.tsx`

**Interfaces:**
- Consumes: `Client` from Task 12.
- Produces: `AgentList({ client }: { client: Client })` rendering each agent's name, kind, status, and an "Adopt" button (disabled when `!agent.sessionId`); `SessionViewer({ client, agentId }: { client: Client; agentId: string })` loading `listSessions` and rendering events.

- [ ] **Step 1: Write the failing tests**

`frontend/test/AgentList.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentList } from '../src/components/AgentList';

it('shows agents and disables adopt without a session id', async () => {
  const client = { listAgents: async () => ([{ id: 'a1', name: 'Claude #1', kind: 'claude', status: 'discovered', managed: false, sessionId: undefined }]) } as any;
  render(<AgentList client={client} />);
  await waitFor(() => screen.getByText('Claude #1'));
  expect(screen.getByRole('button', { name: /adopt/i })).toBeDisabled();
});
```
`frontend/test/SessionViewer.test.tsx`: renders events returned by a fake `listSessions` and asserts their text appears.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w frontend test -- AgentList SessionViewer` → FAIL.

- [ ] **Step 3: Implement both components**

Use `useEffect` + `useState`; `AgentList` maps agents to rows; `SessionViewer` renders events as a scrollable list. No data fetching in `App.tsx` yet.

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npm -w frontend test -- AgentList SessionViewer` → PASS.

```bash
git add frontend/src/components/AgentList.tsx frontend/src/components/SessionViewer.tsx frontend/test/AgentList.test.tsx frontend/test/SessionViewer.test.tsx
git commit -m "feat: add agent list and session viewer"
```

---

### Task 14: Task board, part progress, and split-plan dialog

**Files:**
- Create: `frontend/src/components/TaskBoard.tsx`, `frontend/src/components/PartProgress.tsx`, `frontend/src/components/SplitPlanDialog.tsx`
- Test: `frontend/test/TaskBoard.test.tsx`, `frontend/test/SplitPlanDialog.test.tsx`

**Interfaces:**
- Consumes: `Client` from Task 12; `PartDraft`, `Task`, `PartProgress` types.
- Produces: `TaskBoard({ client })` (create task, list tasks, request plan, show progress); `PartProgress({ client, taskId })` polling `progress`; `SplitPlanDialog({ drafts, onConfirm, onCancel })` where `onConfirm(edited: PartDraft[])` is called only when the user clicks Confirm.

- [ ] **Step 1: Write the failing tests**

`frontend/test/TaskBoard.test.tsx`: creates a task via the input and asserts `createTask` was called with the typed title.
`frontend/test/SplitPlanDialog.test.tsx`:
```tsx
it('calls onConfirm with edited drafts only after Confirm', async () => {
  const onConfirm = vi.fn();
  render(<SplitPlanDialog drafts={[{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }]} onConfirm={onConfirm} onCancel={() => {}} />);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
  expect(onConfirm).toHaveBeenCalledWith([{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm -w frontend test -- TaskBoard SplitPlanDialog` → FAIL.

- [ ] **Step 3: Implement the three components**

`SplitPlanDialog` keeps an editable copy of drafts and calls `onConfirm` only on Confirm. `TaskBoard` wires create → plan (opens dialog) → confirm → progress refresh. `PartProgress` polls `client.progress` every 2s and renders status + tail.

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `npm -w frontend test -- TaskBoard SplitPlanDialog` → PASS.

```bash
git add frontend/src/components/TaskBoard.tsx frontend/src/components/PartProgress.tsx frontend/src/components/SplitPlanDialog.tsx frontend/test/TaskBoard.test.tsx frontend/test/SplitPlanDialog.test.tsx
git commit -m "feat: add task board, part progress, and split-plan dialog"
```

---

### Task 15: Integration wiring and smoke test

**Files:**
- Modify: `frontend/src/App.tsx` (mount all panels with a real `Client`)
- Modify: `package.json` (root dev script)
- Create: `README.md`
- Test: `backend/test/smoke.test.ts`

**Interfaces:**
- Consumes everything above.

- [ ] **Step 1: Write the failing smoke test**

`backend/test/smoke.test.ts`: boots `buildServer` with in-memory deps and a fake supervisor, then asserts: `GET /api/agents` returns 200; create task → plan → confirm → `GET /api/tasks/:id/progress` returns a `running` part.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w backend test -- smoke` → FAIL (wiring gap).

- [ ] **Step 3: Wire App.tsx and root scripts; write README**

`App.tsx` renders `AgentList`, `SessionViewer` (on select), `TaskBoard`, `PartProgress` inside a three-column layout, sharing one `createClient('http://127.0.0.1:4177')`. Root `package.json` adds `"dev": "concurrently \"npm -w backend dev\" \"npm -w frontend dev\""` (add `concurrently`). `README.md` documents `npm install`, `npm run dev`, opening `http://127.0.0.1:4177`, and the "close the external agent before adopting" rule.

- [ ] **Step 4: Run all tests and the smoke test**

Run: `npm test`
Expected: PASS (backend + frontend).

- [ ] **Step 5: Commit**

```bash
git add backend/test/smoke.test.ts frontend/src/App.tsx package.json README.md
git commit -m "feat: wire workbench ui and add smoke test"
```

---

## Self-Review

- **Spec coverage:** G1 discovery → Task 3; G2 sessions → Tasks 5,13; G3 dispatch + split → Tasks 7,8,14; plan-by-agent → Tasks 9,14; G4 progress → Tasks 7,8,11,14; G5 collaboration (shared workspace + SHARED.md) → Tasks 6,8; G6 live PTY typing → Tasks 4,7; adapters for mainstream agents → Task 2. All covered.
- **Step scan:** every step names a file and an observable result; test steps carry assertions; implementation steps carry signatures, not bodies.
- **Type consistency:** `PartStatus`/`TaskStatus`/`PartDraft`/`PartProgress`/`WsMessage` are defined once (Tasks 2 and 7) and reused; no renamed duplicates.
- **Review Focus:** each of the five failure modes has a pinning test in the owning task (Tasks 4,5,7,8).
- **Proportion:** implementation bodies are signatures + prompts only; logic is left to the implementer, matching the spec's "left to the builder" section.
