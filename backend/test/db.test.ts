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
