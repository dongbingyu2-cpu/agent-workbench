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
  it('stores session identifiers containing Windows-invalid filename characters', () => {
    const store = new JsonlSessionStore(mkdtempSync(join(tmpdir(), 'ev-')));
    store.append('session:codex:test', { ts: 1, type: 'output', data: 'ok' });
    expect(store.read('session:codex:test')[0].data).toBe('ok');
  });
});
