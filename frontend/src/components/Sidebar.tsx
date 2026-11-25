import type { ReactNode } from 'react';
import type { Theme } from '../theme';
import { ThemeToggle } from './ThemeToggle';

/**
 * The fixed left rail: brand, view switch, view-specific body and a status foot.
 * Keeps the shell markup in one place so both views share identical chrome.
 */
export function Sidebar({
  tab,
  onTab,
  theme,
  onTheme,
  onOpenSettings,
  footer,
  children,
}: {
  tab: 'sessions' | 'tasks';
  onTab: (tab: 'sessions' | 'tasks') => void;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onOpenSettings?: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="sidebar">
      <div className="side-head">
        <img className="logo" src="/app-icon.png" alt="" aria-hidden="true" />
        <div className="brand-block">
          <strong>Agent 工作台</strong>
          <div className="muted">会话 · 项目 · 协作</div>
        </div>
        <div className="spacer" />
        <div className="side-head-actions">
          {onOpenSettings && (
            <button
              type="button"
              className="btn btn-ghost settings-trigger"
              onClick={onOpenSettings}
              aria-label="设置"
              title="设置"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          <ThemeToggle theme={theme} onChange={onTheme} />
        </div>
      </div>
      <nav className="nav" aria-label="视图切换">
        <button type="button" className={tab === 'sessions' ? 'chosen' : ''} aria-current={tab === 'sessions' ? 'page' : undefined} onClick={() => onTab('sessions')}>
          会话记录
        </button>
        <button type="button" className={tab === 'tasks' ? 'chosen' : ''} aria-current={tab === 'tasks' ? 'page' : undefined} onClick={() => onTab('tasks')}>
          协作任务
        </button>
      </nav>
      {children}
      <div className="side-foot">{footer}</div>
    </aside>
  );
}
