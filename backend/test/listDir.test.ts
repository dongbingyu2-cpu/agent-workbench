import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDir } from '../src/fs/listDir';

describe('listDir', () => {
  it('lists directories before files', () => {
    const root = mkdtempSync(join(tmpdir(), 'ls-'));
    mkdirSync(join(root, 'zeta'));
    writeFileSync(join(root, 'a.txt'), 'x');
    expect(listDir(root)).toEqual([
      { name: 'zeta', dir: true },
      { name: 'a.txt', dir: false },
    ]);
  });

  it('returns [] for a missing path', () => {
    expect(listDir(join(tmpdir(), 'definitely-missing-xyz'))).toEqual([]);
  });
});
