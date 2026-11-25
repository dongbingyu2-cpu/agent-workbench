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

  it('uses a user-picked custom workspace directory directly without extra taskId nesting', () => {
    const customDir = mkdtempSync(join(tmpdir(), 'custom-ws-'));
    const ws = new FsWorkspace(mkdtempSync(join(tmpdir(), 'ws-')));
    const resolved = ws.ensureCustomDir(customDir, 't-custom');
    expect(resolved).toBe(customDir);
    ws.writeShared('t-custom', 'shared content');
    expect(existsSync(join(customDir, 'SHARED.md'))).toBe(true);
    expect(ws.resultPath('t-custom', 'p1')).toBe(join(customDir, 'parts', 'p1', 'RESULT.md'));
  });
});
