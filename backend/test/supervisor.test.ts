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
  it('keeps a restarted agent when its old process exits late', () => {
    const old = fakeFactory();
    const replacement = fakeFactory();
    const factory = { spawn: vi.fn().mockReturnValueOnce(old.proc).mockReturnValueOnce(replacement.proc) };
    const supervisor = new NodePtySupervisor(factory as any);
    supervisor.start('a1', 'claude', [], 'C:/x');
    supervisor.stop('a1');
    supervisor.start('a1', 'claude', [], 'C:/x');
    old.exit(0);
    expect(supervisor.isRunning('a1')).toBe(true);
    supervisor.write('a1', 'hello');
    expect(replacement.proc.write).toHaveBeenCalledWith('hello');
  });
});
