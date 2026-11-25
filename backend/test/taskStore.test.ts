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
