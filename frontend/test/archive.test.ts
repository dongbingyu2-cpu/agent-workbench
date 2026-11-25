import { describe, expect, it, beforeEach } from 'vitest';
import {
  loadArchivedSessions,
  loadArchivedWorkspaces,
  loadDeletedSessions,
  loadDisabledSources,
  saveArchivedSessions,
  saveArchivedWorkspaces,
  saveDeletedSessions,
  saveDisabledSources,
  sessionArchiveKey,
} from '../src/archive';

describe('archive storage', () => {
  beforeEach(() => localStorage.clear());

  it('persists workspace keys and removes duplicates', () => {
    expect(loadArchivedWorkspaces()).toEqual([]);
    saveArchivedWorkspaces(['e:/example workspace', 'e:/example workspace', 'e:/test']);
    expect(loadArchivedWorkspaces()).toEqual(['e:/example workspace', 'e:/test']);
  });

  it('keeps session keys in their own slot', () => {
    saveArchivedSessions([sessionArchiveKey({ kind: 'codex', id: 'abc' }), sessionArchiveKey({ kind: 'codex', id: 'abc' })]);
    expect(loadArchivedSessions()).toEqual(['codex:abc']);
    expect(loadArchivedWorkspaces()).toEqual([]);
  });

  it('persists disabled sources and ignores unknown agent kinds', () => {
    saveDisabledSources(['codex', 'codex', 'antigravity']);
    expect(loadDisabledSources()).toEqual(['codex', 'antigravity']);
    localStorage.setItem('aw-disabled-sources', '["opencode", "unknown-kind", 123]');
    expect(loadDisabledSources()).toEqual(['opencode']);
  });

  it('persists deleted sessions and deduplicates by key', () => {
    saveDeletedSessions([
      { key: 'opencode:s1', kind: 'opencode', id: 's1', title: '下载 opencode 桌面版', project: 'E:/proj', updated: '2026-11-23T11:24:00Z', deletedAt: 1000 },
      { key: 'opencode:s1', kind: 'opencode', id: 's1', title: 'duplicate', project: 'E:/proj', updated: null, deletedAt: 2000 },
    ]);
    const loaded = loadDeletedSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('下载 opencode 桌面版');
  });

  it('survives malformed or unexpected payloads', () => {
    localStorage.setItem('aw-archived-workspaces', '{not json');
    expect(loadArchivedWorkspaces()).toEqual([]);
    localStorage.setItem('aw-archived-workspaces', '{"a":1}');
    expect(loadArchivedWorkspaces()).toEqual([]);
    localStorage.setItem('aw-archived-workspaces', '["ok", 42, null]');
    expect(loadArchivedWorkspaces()).toEqual(['ok']);
    localStorage.setItem('aw-archived-sessions', 'nonsense');
    expect(loadArchivedSessions()).toEqual([]);
    localStorage.setItem('aw-deleted-sessions', '{bad');
    expect(loadDeletedSessions()).toEqual([]);
  });
});
