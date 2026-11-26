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

  it('treats a saved task from before round tracking as the first round', () => {
    const root = mkdtempSync(join(tmpdir(), 'ws-'));
    const file = join(root, 'legacy.db');
    const workspace = new FsWorkspace(root);
    const before = openDatabase(file);
    const oldStore = new SqliteTaskStore(before, workspace);
    const task = oldStore.createTask({ title: 'Example', description: 'Original request' });
    const part = oldStore.addPart(task.id, { title: 'First part', description: 'Work', assignedAgentId: null, status: 'done' });
    oldStore.updateTaskStatus(task.id, 'done');
    before.exec('ALTER TABLE parts DROP COLUMN round; DROP TABLE task_rounds;');
    before.close();

    const after = openDatabase(file);
    try {
      const migrated = new SqliteTaskStore(after, workspace);
      expect(migrated.beginFollowUp(task.id, 'Next request')).toMatchObject({
        round: 2, status: 'planned', previousRequirements: ['Original request'],
        parts: [{ id: part.id, round: 1, status: 'done' }],
      });
    } finally {
      after.close();
    }
  });
});
