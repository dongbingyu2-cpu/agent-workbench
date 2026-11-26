import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSync };

function tryAddColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // column already exists (or table is new) — safe to ignore
  }
}

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new sqlite.DatabaseSync(dbPath);
  const schema = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  // Forward migrations for databases created before these columns existed.
  tryAddColumn(db, 'tasks', 'leader_agent_id', 'TEXT');
  tryAddColumn(db, 'parts', 'model', 'TEXT');
  tryAddColumn(db, 'parts', 'depends_on', 'TEXT');
  tryAddColumn(db, 'parts', 'agent_kind', 'TEXT');
  tryAddColumn(db, 'parts', 'phase', 'TEXT');
  tryAddColumn(db, 'parts', 'round', 'INTEGER NOT NULL DEFAULT 1');
  return db;
}
