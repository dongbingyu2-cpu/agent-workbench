import { useEffect, useState } from 'react';
import type { AgentKind, SessionSummary } from '../types';
import type { DeletedSessionEntry } from '../archive';
import { sessionArchiveKey } from '../archive';
import { AgentIcon, agentName } from './AgentIcon';
import { projectLabel } from '../format';

export const SOURCE_KINDS: AgentKind[] = [
  'workbuddy',
  'opencode',
  'claude',
  'codex',
  'pi',
  'dsh',
  'antigravity',
];

function formatDateTime(value: string | number | null): string {
  if (value == null) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function SettingsModal({
  open,
  onClose,
  detectedKinds,
  disabledSources,
  onSaveDisabledSources,
  archivedWorkspaces,
  archivedSessions,
  deletedSessions,
  onRestoreWorkspace,
  onRestoreArchivedSession,
  onDeleteArchivedWorkspace,
  onDeleteArchivedSession,
  onRestoreDeletedSession,
}: {
  open: boolean;
  onClose: () => void;
  detectedKinds: Set<AgentKind>;
  disabledSources: AgentKind[];
  onSaveDisabledSources: (next: AgentKind[]) => void;
  archivedWorkspaces: Array<{ key: string; label: string; count: number }>;
  archivedSessions: SessionSummary[];
  deletedSessions: DeletedSessionEntry[];
  onRestoreWorkspace: (key: string) => void;
  onRestoreArchivedSession: (key: string) => void;
  onDeleteArchivedWorkspace: (key: string) => void;
  onDeleteArchivedSession: (session: SessionSummary) => void;
  onRestoreDeletedSession: (key: string) => void;
}) {
  const [draftDisabled, setDraftDisabled] = useState<AgentKind[]>(disabledSources);

  useEffect(() => {
    if (open) setDraftDisabled(disabledSources);
  }, [open, disabledSources]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggleSource = (kind: AgentKind) => {
    setDraftDisabled((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  };

  const handleSave = () => {
    onSaveDisabledSources(draftDisabled);
    onClose();
  };

  const hasArchived = archivedWorkspaces.length > 0 || archivedSessions.length > 0;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <header className="settings-head">
          <h2 id="settings-modal-title">设置</h2>
          <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置">
            ×
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section" aria-labelledby="settings-sources-title">
            <h3 id="settings-sources-title">扫描来源</h3>
            <p className="settings-hint">关闭的来源不显示其会话；重新打开立即恢复。</p>
            <div className="source-toggle-list">
              {SOURCE_KINDS.map((kind) => {
                const enabled = !draftDisabled.includes(kind);
                const detected = detectedKinds.has(kind);
                return (
                  <div key={kind} className="source-toggle-row">
                    <div className="source-toggle-info">
                      <AgentIcon kind={kind} />
                      <span className="source-toggle-name">{agentName(kind)}</span>
                    </div>
                    <div className="source-toggle-right">
                      {!detected && <span className="source-status">未检测到</span>}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`显示 ${agentName(kind)} 会话`}
                        className={`switch-toggle${enabled ? ' on' : ''}`}
                        onClick={() => toggleSource(kind)}
                      >
                        <span className="switch-thumb" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-archived-title">
            <h3 id="settings-archived-title">已归档</h3>
            <p className="settings-hint">归档的工作区与单条会话仅从列表隐藏，原始数据不动，可随时恢复。</p>
            {!hasArchived ? (
              <div className="settings-empty">暂无已归档的工作区或会话。</div>
            ) : (
              <div className="settings-item-list">
                {archivedWorkspaces.map((workspace) => (
                  <div key={`ws:${workspace.key}`} className="settings-item-row">
                    <div className="settings-item-info">
                      <div className="settings-item-title">{workspace.label}</div>
                      <div className="settings-item-meta">
                        工作区 · 已归档{workspace.count > 0 ? ` · ${workspace.count} 条会话` : ''}
                      </div>
                    </div>
                    <div className="settings-item-actions">
                      <button
                        type="button"
                        className="settings-restore-btn"
                        onClick={() => onRestoreWorkspace(workspace.key)}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        className="settings-delete-btn"
                        onClick={() => onDeleteArchivedWorkspace(workspace.key)}
                        title="移入回收站（不删除原数据）"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
                {archivedSessions.map((session) => {
                  const key = sessionArchiveKey(session);
                  const when = formatDateTime(session.updated ?? session.startedAt ?? null);
                  return (
                    <div key={`sess:${key}`} className="settings-item-row">
                      <div className="settings-item-info">
                        <div className="settings-item-title">{session.title}</div>
                        <div className="settings-item-meta">
                          {agentName(session.kind)} · 已归档{session.project ? ` · ${projectLabel(session.project)}` : ''}{when ? ` · ${when}` : ''}
                        </div>
                      </div>
                      <div className="settings-item-actions">
                        <button
                          type="button"
                          className="settings-restore-btn"
                          onClick={() => onRestoreArchivedSession(key)}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          className="settings-delete-btn"
                          onClick={() => onDeleteArchivedSession(session)}
                          title="移入回收站（不删除原数据）"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="settings-section" aria-labelledby="settings-trash-title">
            <h3 id="settings-trash-title">回收站</h3>
            <p className="settings-hint">删除的会话在这里。agent 原始数据不动，仅从列表隐藏，可随时恢复。</p>
            {deletedSessions.length === 0 ? (
              <div className="settings-empty">回收站为空。</div>
            ) : (
              <div className="settings-item-list">
                {deletedSessions.map((item) => {
                  const when = formatDateTime(item.updated ?? item.deletedAt);
                  return (
                    <div key={item.key} className="settings-item-row">
                      <div className="settings-item-info">
                        <div className="settings-item-title">{item.title}</div>
                        <div className="settings-item-meta">
                          {agentName(item.kind)} · 已隐藏{when ? ` · ${when}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="settings-restore-btn"
                        onClick={() => onRestoreDeletedSession(item.key)}
                      >
                        恢复
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <footer className="settings-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </footer>
      </div>
    </div>
  );
}
