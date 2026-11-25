import type { AgentKind, SessionSummary } from './types';

const WORKSPACES_KEY = 'aw-archived-workspaces';
const SESSIONS_KEY = 'aw-archived-sessions';
const DISABLED_SOURCES_KEY = 'aw-disabled-sources';
const DELETED_SESSIONS_KEY = 'aw-deleted-sessions';

const VALID_KINDS = new Set<AgentKind>(['codex', 'claude', 'opencode', 'workbuddy', 'dsh', 'antigravity', 'pi', 'generic']);

export interface DeletedSessionEntry {
  key: string;
  kind: AgentKind;
  id: string;
  title: string;
  project: string;
  updated: string | null;
  deletedAt: number;
}

function readList(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(storageKey: string, keys: string[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...new Set(keys)]));
  } catch {
    // Storage quota or private mode; keep working in memory.
  }
}

export function sessionArchiveKey(session: Pick<SessionSummary, 'kind' | 'id'>): string {
  return `${session.kind}:${session.id}`;
}

export function loadArchivedWorkspaces(): string[] {
  return readList(WORKSPACES_KEY);
}

export function saveArchivedWorkspaces(keys: string[]): void {
  writeList(WORKSPACES_KEY, keys);
}

export function loadArchivedSessions(): string[] {
  return readList(SESSIONS_KEY);
}

export function saveArchivedSessions(keys: string[]): void {
  writeList(SESSIONS_KEY, keys);
}

export function loadDisabledSources(): AgentKind[] {
  return readList(DISABLED_SOURCES_KEY).filter((item): item is AgentKind => VALID_KINDS.has(item as AgentKind));
}

export function saveDisabledSources(kinds: AgentKind[]): void {
  writeList(DISABLED_SOURCES_KEY, kinds.filter((item) => VALID_KINDS.has(item)));
}

export function loadDeletedSessions(): DeletedSessionEntry[] {
  try {
    const raw = localStorage.getItem(DELETED_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const result: DeletedSessionEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Partial<DeletedSessionEntry>;
      if (typeof entry.key !== 'string' || typeof entry.id !== 'string' || typeof entry.kind !== 'string') continue;
      if (!VALID_KINDS.has(entry.kind as AgentKind) || seen.has(entry.key)) continue;
      seen.add(entry.key);
      result.push({
        key: entry.key,
        kind: entry.kind as AgentKind,
        id: entry.id,
        title: typeof entry.title === 'string' && entry.title ? entry.title : entry.id,
        project: typeof entry.project === 'string' ? entry.project : '',
        updated: typeof entry.updated === 'string' ? entry.updated : null,
        deletedAt: typeof entry.deletedAt === 'number' && Number.isFinite(entry.deletedAt) ? entry.deletedAt : Date.now(),
      });
    }
    return result;
  } catch {
    return [];
  }
}

export function saveDeletedSessions(items: DeletedSessionEntry[]): void {
  try {
    const deduped: DeletedSessionEntry[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      deduped.push(item);
    }
    localStorage.setItem(DELETED_SESSIONS_KEY, JSON.stringify(deduped));
  } catch {
    // Storage quota or private mode; keep working in memory.
  }
}
