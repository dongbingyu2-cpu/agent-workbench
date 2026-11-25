import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Orchestrator, buildPartPrompt } from '../src/tasks/orchestrator';
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

const agentOf = (over: Record<string, unknown> = {}) =>
  ({ id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false, ...over }) as any;

describe('Orchestrator', () => {
  it('throws when adopting an agent with no session id', () => {
    const o = new Orchestrator(deps() as any);
    expect(() => o.adopt({ id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false })).toThrow(/session/i);
  });
  it('reuses a running managed session on repeated adoption', () => {
    const d = deps();
    const orchestrator = new Orchestrator(d as any);
    const agent = agentOf({ sessionId: 'session-1' });
    orchestrator.adopt(agent);
    expect(() => orchestrator.adopt(agent)).not.toThrow();
  });

  it('rejects a second dispatch to a busy agent', () => {
    const d = deps();
    const o = new Orchestrator(d as any);
    o.dispatchToAgent(agentOf(), 'do 1');
    expect(() => o.dispatchToAgent(agentOf(), 'do 2')).toThrow(/busy|running/i);
  });

  it('marks a part failed when its agent exits without DONE', () => {
    registerAdapters();
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const exitCbs: Array<(c: number) => void> = [];
    const supervisor = new NodePtySupervisor({ spawn: () => ({ pid: 1, write: vi.fn(), onData: () => {}, onExit: (cb: any) => exitCbs.push(cb), kill: vi.fn() }) } as any);
    const store = new SqliteTaskStore(openDatabase(':memory:'), new FsWorkspace(root));
    const d = { supervisor, store, workspace: new FsWorkspace(root), sessions: new JsonlSessionStore(root), adapters: getAdapter, root };
    const o = new Orchestrator(d as any);
    const task = d.store.createTask({ title: 'T', description: 'bg' });
    const part = d.store.addPart(task.id, { title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending' });
    o.activateTask(task.id, [{ part, agent: agentOf() }]);
    exitCbs.forEach((cb) => cb(1));
    expect(d.store.getPart(part.id)!.status).toBe('failed');
  });

  it('marks a part done when DONE appears, even if RESULT.md is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const ws = new FsWorkspace(root, ((dir: string, cb: (n: string) => void) => { cb('DONE'); return () => {}; }) as any);
    const d = deps();
    const o = new Orchestrator({ ...d, workspace: ws } as any);
    const task = d.store.createTask({ title: 'T', description: 'bg' });
    const part = d.store.addPart(task.id, { title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending' });
    o.activateTask(task.id, [{ part, agent: agentOf() }]);
    expect(d.store.getPart(part.id)!.status).toBe('done');
    expect(d.store.getTask(task.id)!.status).toBe('done');
  });

  it('marks a failed startup and continues dispatching other parts', () => {
    const d = deps();
    const original = d.supervisor.start.bind(d.supervisor);
    vi.spyOn(d.supervisor, 'start').mockImplementation((id, file, args, cwd) => {
      if (id === 'a1') throw new Error('CLI unavailable');
      return original(id, file, args, cwd);
    });
    const orchestrator = new Orchestrator(d as any);
    const task = d.store.createTask({ title: 'T', description: '' });
    const first = d.store.addPart(task.id, { title: 'A', description: 'a', assignedAgentId: 'a1', status: 'pending' });
    const second = d.store.addPart(task.id, { title: 'B', description: 'b', assignedAgentId: 'a2', status: 'pending' });
    orchestrator.activateTask(task.id, [{ part: first, agent: agentOf() }, { part: second, agent: agentOf({ id: 'a2' }) }]);
    expect(d.store.getPart(first.id)?.status).toBe('failed');
    expect(d.store.getPart(second.id)?.status).toBe('running');
    expect(orchestrator.progress(task.id)[0].tail).toContain('CLI unavailable');
  });

  it('builds a prompt that names the part dir, SHARED.md, RESULT.md and DONE', () => {
    const p = buildPartPrompt({ id: 'p1', taskId: 't1', title: 'A', description: 'do a', assignedAgentId: 'a1', status: 'pending', resultPath: 'C:/ws/t1/parts/p1/RESULT.md', doneMarker: 'C:/ws/t1/parts/p1/DONE' }, 'bg');
    expect(p).toContain('SHARED.md');
    expect(p).toContain('RESULT.md');
    expect(p).toContain('DONE');
    expect(p).toContain('do a');
  });

  it('defaults an empty cwd to process.cwd() when starting an agent', () => {
    registerAdapters();
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const calls: unknown[][] = [];
    const supervisor = {
      start: (...args: unknown[]) => {
        calls.push(args);
        return { pid: 1, write: () => {}, onData: () => {}, onExit: () => {}, kill: () => {} };
      },
      write: () => {},
      onOutput: () => () => {},
      isRunning: () => false,
      stop: () => {},
    } as any;
    const store = new SqliteTaskStore(openDatabase(':memory:'), new FsWorkspace(root));
    const o = new Orchestrator({ supervisor, store, workspace: new FsWorkspace(root), sessions: new JsonlSessionStore(root), adapters: getAdapter });
    o.dispatchToAgent(agentOf({ cwd: '' }), 'hi');
    expect(calls[0][3]).toBe(process.cwd());
  });

  it('allows a new dispatch after release', () => {
    const d = deps();
    const o = new Orchestrator(d as any);
    o.dispatchToAgent(agentOf(), 'do 1');
    o.release('a1');
    expect(() => o.dispatchToAgent(agentOf(), 'do 2')).not.toThrow();
  });
});
