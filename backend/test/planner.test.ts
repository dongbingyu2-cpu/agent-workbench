import { describe, it, expect, vi } from 'vitest';
import { AgentPlanner } from '../src/tasks/planner';

function fakeSup() {
  let cb: ((s: string) => void) | null = null;
  const write = vi.fn();
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
    await expect(promise).resolves.toEqual([{ title: 'A', description: 'do a', suggestedAgentId: 'a1', model: null, phase: undefined, dependsOn: null }]);
    expect(s.write).toHaveBeenCalledTimes(1);
  });

  it('records dependsOn and model from the planner JSON', async () => {
    const s = fakeSup();
    const p = new AgentPlanner({ supervisor: s.supervisor, timeoutMs: 50 });
    const task = { id: 't1', title: 'T', description: 'bg', workspacePath: 'C:/w/t1', status: 'planned', parts: [] } as any;
    const agent = { id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false } as any;
    const promise = p.requestSplitPlan(task, agent);
    s.emit('[{"title":"Backend","description":"api","phase":"coding","agentId":"a1","dependsOn":[],"model":"claude-4"},{"title":"Review","description":"reviews","phase":"review","dependsOn":["Backend"],"model":""}]');
    await expect(promise).resolves.toEqual([
      { title: 'Backend', description: 'api', suggestedAgentId: 'a1', model: 'claude-4', phase: 'coding', dependsOn: [] },
      { title: 'Review', description: 'reviews', suggestedAgentId: null, model: null, phase: 'review', dependsOn: ['Backend'] },
    ]);
  });

  it('completes a requirement via the leader agent', async () => {
    const s = fakeSup();
    const p = new AgentPlanner({ supervisor: s.supervisor, timeoutMs: 50 });
    const task = { id: 't1', title: 'T', description: 'bg', workspacePath: 'C:/w/t1', status: 'planned', parts: [] } as any;
    const leader = { id: 'l1', name: 'x', kind: 'claude', command: 'claude', cwd: 'C:/', status: 'discovered', managed: false } as any;
    const promise = p.completeRequirement(task, leader);
    s.emit('{"requirement":"Build a login page with JWT auth."}');
    await expect(promise).resolves.toBe('Build a login page with JWT auth.');
  });

  it('auto-starts a stopped leader agent via its adapter and ignores echoed placeholder JSON', async () => {
    let emit: (s: string) => void = () => {};
    const start = vi.fn(() => ({ pid: 1, write: vi.fn(), onData: vi.fn(), onExit: vi.fn(), kill: vi.fn() }));
    const write = vi.fn();
    const supervisor = {
      start,
      write,
      onOutput: (_id: string, c: (s: string) => void) => { emit = c; return () => {}; },
      isRunning: () => false,
      stop: vi.fn(),
    } as any;
    const adapters = vi.fn(() => ({
      kind: 'antigravity' as const,
      displayName: 'Antigravity',
      binaries: ['agy'],
      supportsResume: true,
      launch: () => ({ file: 'agy', args: [] }),
    }));
    const p = new AgentPlanner({ supervisor, adapters, timeoutMs: 50 });
    const task = { id: 't1', title: 'T', description: 'bg', workspacePath: 'E:/proj', status: 'planned', parts: [] } as any;
    const leader = { id: 'kind:antigravity', name: 'Antigravity', kind: 'antigravity', command: 'agy', cwd: '', status: 'discovered', managed: false } as any;
    const promise = p.completeRequirement(task, leader);
    expect(start).toHaveBeenCalledWith('kind:antigravity', 'agy', [], 'E:/proj');
    emit('Reply with ONLY a JSON object {"requirement":"...write the full requirement here..."}.\n');
    emit('\x1b[32m{"requirement":"Optimize local agent workbench."}\x1b[0m');
    await expect(promise).resolves.toBe('Optimize local agent workbench.');
  });
});
