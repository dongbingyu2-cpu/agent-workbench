import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWindowsCommand } from '../src/pty/windowsCommand';

describe('Windows command resolution', () => {
  it('launches an npm cmd shim through the command processor', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agent cli '));
    const shim = path.join(directory, 'agent.cmd');
    writeFileSync(shim, '');
    const result = resolveWindowsCommand('agent', ['--resume', 'session-id'], { PATH: directory, PATHEXT: '.EXE;.CMD', ComSpec: 'cmd.exe' });
    expect(result.file).toBe('cmd.exe');
    expect(result.args).toBe(`/d /s /c ""${shim}" "--resume" "session-id""`);
  });

  it('resolves an absolute executable path directly without prefixing dot', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-abs-'));
    const exe = path.join(directory, 'agy.exe');
    writeFileSync(exe, '');
    const result = resolveWindowsCommand(exe, ['--conversation', 'c1'], { PATH: '', PATHEXT: '.EXE' });
    expect(result).toEqual({ file: exe, args: ['--conversation', 'c1'] });
  });

  it('rejects batch metacharacters and reports missing commands', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'agent-cli-'));
    writeFileSync(path.join(directory, 'agent.cmd'), '');
    const env = { PATH: directory, PATHEXT: '.CMD' };
    expect(() => resolveWindowsCommand('agent', ['hello&whoami'], env)).toThrow(/特殊字符/);
    expect(() => resolveWindowsCommand('missing', [], env)).toThrow(/找不到智能体命令/);
  });
});
