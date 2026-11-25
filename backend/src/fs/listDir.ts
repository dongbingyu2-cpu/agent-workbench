import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface DirEntry {
  name: string;
  dir: boolean;
}

/** List a directory's top-level entries (dirs first, then files), or [] if unreadable. */
export function listDir(absPath: string): DirEntry[] {
  let names: string[];
  try {
    names = readdirSync(absPath);
  } catch {
    return [];
  }
  const entries: DirEntry[] = [];
  for (const name of names) {
    let dir = false;
    try {
      dir = statSync(path.join(absPath, name)).isDirectory();
    } catch {
      // skip entries we cannot stat
    }
    entries.push({ name, dir });
  }
  return entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}
