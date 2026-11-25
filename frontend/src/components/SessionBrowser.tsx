import { useState } from 'react';
import type { AgentKind, SessionSummary, Task } from '../types';
import { AgentIcon, agentName } from './AgentIcon';
import { statusKey, translate } from '../i18n';
import { sessionArchiveKey } from '../archive';
import { countLabel, durationLabel, relativeDayLabel, shortPath, tokenLabel } from '../format';

export type SortKey = 'updated' | 'msgs' | 'duration';

const SORT_LABELS: Record<SortKey, string> = { updated: '时间', msgs: '消息数', duration: '时长' };

export interface SessionGroup {
  key: string;
  label: string;
  items: SessionSummary[];
}

/** Aggregate "all sources" tile: a rounded square holding four squares. */
function AllSourcesIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1.8" y="1.8" width="20.4" height="20.4" rx="5.8" fill="currentColor" />
      <g className="all-sources-squares">
        <rect x="6.6" y="6.6" width="4.4" height="4.4" rx="1.3" />
        <rect x="13" y="6.6" width="4.4" height="4.4" rx="1.3" />
        <rect x="6.6" y="13" width="4.4" height="4.4" rx="1.3" />
        <rect x="13" y="13" width="4.4" height="4.4" rx="1.3" />
      </g>
    </svg>
  );
}

interface CardAction {
  label: string;
  title?: string;
  onClick: () => void;
  danger?: boolean;
}

/** Metadata line under a session title: source · time · duration · msgs · tools · tokens. */
function sessionStats(session: SessionSummary): { key: string; value: string; title?: string }[] {
  const stats: { key: string; value: string; title?: string }[] = [];
  const when = relativeDayLabel(session.updated ?? session.startedAt);
  if (when) stats.push({ key: 'when', value: when });
  const duration = durationLabel(session.startedAt ?? session.updated, session.updated);
  if (duration) stats.push({ key: 'duration', value: duration, title: '会话时长' });
  if (session.msgs != null) stats.push({ key: 'msgs', value: `${session.msgs} 条`, title: `${countLabel(session.msgs)} 条消息` });
  if (session.tools) stats.push({ key: 'tools', value: `${session.tools} 工具`, title: `${countLabel(session.tools)} 次工具调用` });
  const tokenIn = tokenLabel(session.tokenIn);
  const tokenOut = tokenLabel(session.tokenOut);
  if (tokenIn || tokenOut) stats.push({ key: 'tokens', value: `${tokenIn || '0'}/${tokenOut || '0'}`, title: `输入 ${countLabel(session.tokenIn)} / 输出 ${countLabel(session.tokenOut)} tokens` });
  return stats;
}

function SessionCard({ session, active, onSelect, actions = [], busy }: { session: SessionSummary; active: boolean; onSelect: (session: SessionSummary) => void; actions?: CardAction[]; busy?: boolean }) {
  return (
    <div className={`session-row${actions.length > 0 ? ' has-action' : ''}`}>
      <button type="button" className={`session-item${active ? ' active' : ''}`} onClick={() => onSelect(session)} title={session.title}>
        {busy && <span className="session-spinner" role="status" aria-label="续接中" />}
        <span className="session-title">{session.title}</span>
        <span className="session-meta">
          <span className="source-badge">
            <AgentIcon kind={session.kind} />
            {agentName(session.kind)}
          </span>
          {sessionStats(session).map((stat, index) => (
            <span key={stat.key} className="meta-part" title={stat.title}>
              {index > 0 && <span className="meta-dot" aria-hidden="true">·</span>}
              {stat.value}
            </span>
          ))}
        </span>
      </button>
      {actions.length > 0 && (
        <div className="session-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={`session-action${action.danger ? ' danger' : ''}`}
              onClick={action.onClick}
              title={action.title ?? action.label}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SessionBrowser({
  sessions,
  total,
  groups,
  search,
  onSearch,
  kind,
  onKind,
  kinds,
  counts,
  selected,
  onSelect,
  busyKeys,
  sort,
  onSort,
  onRefresh,
  loading,
  hasHidden = false,
  onArchiveWorkspace,
  onArchiveSession,
  onDeleteSession,
}: {
  sessions: SessionSummary[];
  total: number;
  groups: SessionGroup[];
  search: string;
  onSearch: (value: string) => void;
  kind: AgentKind | 'all';
  onKind: (value: AgentKind | 'all') => void;
  kinds: AgentKind[];
  counts: Record<string, number>;
  selected: SessionSummary | null;
  onSelect: (session: SessionSummary) => void;
  busyKeys: Set<string>;
  sort: SortKey;
  onSort: (value: SortKey) => void;
  onRefresh: () => void;
  loading: boolean;
  hasHidden?: boolean;
  onArchiveWorkspace: (key: string) => void;
  onArchiveSession: (key: string) => void;
  onDeleteSession: (session: SessionSummary) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const visible = sessions.length;
  const filtered = Boolean(search) || kind !== 'all';

  const toggleGroup = (key: string) => {
    setCollapsed((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const renderCard = (session: SessionSummary) => (
    <SessionCard
      key={`${session.kind}:${session.id}`}
      session={session}
      active={Boolean(selected && selected.id === session.id && selected.kind === session.kind)}
      onSelect={onSelect}
      actions={[
        {
          label: '归档',
          title: '归档这条会话（可在设置中恢复）',
          onClick: () => onArchiveSession(sessionArchiveKey(session)),
        },
        {
          label: '删除',
          title: '删除这条会话（移入设置中的回收站，不删除原数据）',
          danger: true,
          onClick: () => onDeleteSession(session),
        },
      ]}
      busy={busyKeys.has(sessionArchiveKey(session))}
    />
  );

  return (
    <div className="side-body">
      <div className="side-search">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input className="input search" placeholder="搜索标题 / 路径" value={search} onChange={(event) => onSearch(event.target.value)} aria-label="搜索标题或路径" />
        {search && (
          <button type="button" className="search-clear" onClick={() => onSearch('')} aria-label="清除搜索">
            ×
          </button>
        )}
      </div>

      <div className="filters" role="group" aria-label="按来源筛选">
        <button
          type="button"
          className={`filter-icon filter-all-icon${kind === 'all' ? ' chosen' : ''}`}
          onClick={() => onKind('all')}
          title="全部来源"
          aria-label="全部来源"
          aria-pressed={kind === 'all'}
        >
          <AllSourcesIcon />
          <span className="filter-count">{total}</span>
        </button>
        {kinds.map((item) => (
          <button
            key={item}
            type="button"
            className={`filter-icon${kind === item ? ' chosen' : ''}`}
            onClick={() => onKind(item)}
            title={agentName(item)}
            aria-label={agentName(item)}
            aria-pressed={kind === item}
          >
            <AgentIcon kind={item} />
            <span className="filter-count">{counts[item] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="list-caption">
        <span>{filtered ? `${visible} / ${total} 个会话` : `${total} 个会话`}</span>
        <span className="caption-actions">
          <label className="sort-select">
            排序
            <select value={sort} onChange={(event) => onSort(event.target.value as SortKey)} aria-label="排序方式">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="link-btn" onClick={onRefresh}>
            刷新
          </button>
        </span>
      </div>

      <div className="project-list" data-loading={loading ? 'true' : undefined}>
        {loading && sessions.length === 0 && (
          <div className="skeleton-list" aria-hidden="true">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="skeleton-row">
                <span className="skeleton-line wide" />
                <span className="skeleton-line" />
              </div>
            ))}
          </div>
        )}
        {!loading && groups.length === 0 && (
          <div className="empty padded">
            {hasHidden && !filtered ? '当前会话已归档、删除或来源已关闭，可在「设置」中恢复。' : '没有匹配的会话。'}
          </div>
        )}
        {groups.map((group) => {
          const open = !collapsed.includes(group.key);
          return (
            <section key={group.key} className="project-group">
              <div className="project-head">
                <button type="button" className="project-toggle" onClick={() => toggleGroup(group.key)} aria-expanded={open} title={group.label}>
                  <span className="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <span className="project-dot" aria-hidden="true" />
                  <span className="project-name">{group.label}</span>
                  <span className="project-count">{group.items.length}</span>
                </button>
                <button
                  type="button"
                  className="project-action"
                  onClick={() => onArchiveWorkspace(group.key)}
                  title={`归档整个工作区「${group.label}」（可在设置中恢复）`}
                >
                  归档
                </button>
              </div>
              {open && (
                <div className="project-items">
                  {group.items.map((session) => renderCard(session))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function TaskBrowser({
  tasks,
  activeId,
  onSelect,
  onNewTask,
}: {
  tasks: Task[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewTask?: () => void;
}) {
  return (
    <div className="side-body">
      <div className="list-caption">
        <span>{tasks.length} 个任务</span>
        {onNewTask && (
          <button type="button" className="link-btn" onClick={onNewTask}>
            + 新建任务
          </button>
        )}
      </div>
      <div className="project-list">
        {tasks.length === 0 && <div className="empty padded">暂无任务，去右侧新建一个。</div>}
        <div className="project-items">
          {tasks.map((task) => {
            const doneCount = task.parts.filter((part) => part.status === 'done').length;
            return (
              <button
                type="button"
                key={task.id}
                className={`session-item${activeId === task.id ? ' active' : ''}`}
                onClick={() => onSelect(task.id)}
              >
                <span className="session-title">{task.title}</span>
                <span className="session-meta">
                  <span className={`badge ${task.status}`}>{translate('zh', statusKey(task.status))}</span>
                  <span className="meta-dot" aria-hidden="true">·</span>
                  <span className="meta-part">{task.parts.length > 0 ? `${doneCount}/${task.parts.length} 分片` : '待拆分'}</span>
                  {task.workspacePath && (
                    <>
                      <span className="meta-dot" aria-hidden="true">·</span>
                      <span className="meta-part task-side-path" title={task.workspacePath}>{shortPath(task.workspacePath)}</span>
                    </>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
