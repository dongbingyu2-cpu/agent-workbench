import { useEffect, useRef, useState } from 'react';
import type { Agent, AgentKind, CatalogModel, DirListing, PartDraft, PartProgress, SessionSummary, Task, TaskLiveSession } from '../types';
import { statusKey, translate } from '../i18n';
import { AgentIcon, agentName } from './AgentIcon';
import { CollapsibleText } from './CollapsibleText';
import { pathTail, shortPath } from '../format';

export interface PartDraftRow {
  title: string;
  description: string;
  agentId: string;
  model: string;
  phase: 'coding' | 'review' | 'test';
  dependsOn: string;
}

type DetailTab = 'all' | 'tree' | 'output';

function statusLabel(status: string): string {
  return translate('zh', statusKey(status));
}

const DESKTOP_ONLY_KINDS = new Set<AgentKind>(['workbuddy', 'dsh']);
const RUNNABLE_LEADER_KINDS: AgentKind[] = ['claude', 'codex', 'opencode', 'pi', 'antigravity'];
const PHASES: Array<{ key: PartDraftRow['phase']; label: string }> = [
  { key: 'coding', label: '开发' },
  { key: 'review', label: '审查' },
  { key: 'test', label: '测试' },
];

function makeFallbackAgent(kind: AgentKind): Agent {
  return {
    id: `kind:${kind}`,
    name: agentName(kind),
    kind,
    command: kind,
    cwd: '',
    status: 'discovered',
    managed: false,
  };
}

function buildLeaderAgents(discovered: Agent[]): Agent[] {
  const list = discovered.filter((agent) => !DESKTOP_ONLY_KINDS.has(agent.kind) && agent.kind !== 'generic');
  for (const kind of RUNNABLE_LEADER_KINDS) {
    if (!list.some((agent) => agent.kind === kind)) list.push(makeFallbackAgent(kind));
  }
  return list;
}

function buildAssignableAgents(discovered: Agent[]): Agent[] {
  const list = [...discovered];
  for (const kind of RUNNABLE_LEADER_KINDS) {
    if (!list.some((agent) => agent.kind === kind)) list.push(makeFallbackAgent(kind));
  }
  return list;
}

function applyDraft(draft: PartDraft): PartDraftRow {
  return {
    title: draft.title,
    description: draft.description,
    agentId: '',
    model: draft.model ?? '',
    phase: draft.phase ?? 'coding',
    dependsOn: (draft.dependsOn ?? []).join(', '),
  };
}

function agentOptionLabel(agent: Agent): string {
  const base = agentName(agent.kind);
  const sid = agent.sessionId ? ` · ${agent.sessionId.slice(0, 8)}` : '';
  const tag = DESKTOP_ONLY_KINDS.has(agent.kind) ? '（桌面只读）' : '';
  return `${base}${sid}${tag}`;
}

function deriveTitle(text: string): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function FolderIcon() {
  return (
    <svg className="chip-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5.5M6.2 11.3 12 5.5l5.8 5.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The 协作任务 view: minimalist Agent-app experience with a unified dialog box
 * both on the home screen (creating a task) and docked at the bottom of a
 * planned task (refining requirements, asking Leader to complete/split, and dispatching).
 */
export function TaskPanel({
  agents,
  tasks,
  task,
  title,
  description,
  workspacePath,
  parts,
  progress,
  summary,
  liveSessions,
  onTitle,
  onDescription,
  onWorkspacePath,
  onCreate,
  onDelete,
  onPause,
  onResume,
  onFollowUp,
  onCancel,
  onParts,
  onStart,
  onOpenTask,
  onJumpSession: _onJumpSession,
  onLiveSessions,
  onOpenAgent,
  onNewTask,
  onLoadDirs,
  onCompleteRequirement,
  onPlan,
  onLoadModels,
}: {
  agents: Agent[];
  tasks: Task[];
  task: Task | null;
  title: string;
  description: string;
  workspacePath: string;
  parts: PartDraftRow[];
  progress: PartProgress[];
  summary?: string;
  liveSessions: TaskLiveSession[];
  onTitle: (value: string) => void;
  onDescription: (value: string) => void;
  onWorkspacePath: (value: string) => void;
  onCreate: () => void;
  onDelete: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onFollowUp?: (taskId: string, note: string, round: number) => Promise<void>;
  onCancel?: () => void;
  onParts: (parts: PartDraftRow[]) => void;
  onStart: (assignments: Array<{ title: string; description: string; agent: Agent; model?: string; dependsOn?: string; phase?: 'coding' | 'review' | 'test' }>, leader: Agent | undefined) => void;
  onOpenTask: (task: Task) => void;
  onJumpSession: (session: SessionSummary) => void;
  onLiveSessions: (taskId: string) => void;
  onOpenAgent: (kind: AgentKind, id: string, project?: string, partTitle?: string) => void;
  onNewTask?: () => void;
  onLoadDirs?: (dir?: string) => Promise<DirListing[]>;
  onCompleteRequirement?: (taskId: string, agent: Agent, description: string) => Promise<string>;
  onPlan?: (taskId: string, agent: Agent, description: string) => Promise<PartDraft[]>;
  onLoadModels?: (kind: AgentKind) => Promise<CatalogModel[]>;
}) {
  const [dirs, setDirs] = useState<DirListing[]>([]);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [dirsLoading, setDirsLoading] = useState(false);
  const [leaderId, setLeaderId] = useState(task?.leaderAgentId ?? '');
  const [followUp, setFollowUp] = useState('');
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [busyPlan, setBusyPlan] = useState(false);
  const [busyComplete, setBusyComplete] = useState(false);
  const [localError, setLocalError] = useState('');
  const [copiedKey, setCopiedKey] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('all');
  const [modelsByKind, setModelsByKind] = useState<Partial<Record<AgentKind, CatalogModel[]>>>({});
  const [loadingKinds, setLoadingKinds] = useState<Partial<Record<AgentKind, boolean>>>({});
  const requestedKindsRef = useRef<Set<AgentKind>>(new Set());

  useEffect(() => {
    if (task?.leaderAgentId) setLeaderId(task.leaderAgentId);
    setFollowUp('');
    setLocalError('');
    setCopiedKey('');
    setDetailTab('all');
  }, [task?.id, task?.round, task?.leaderAgentId]);

  const cliAgents = buildLeaderAgents(agents);
  const assignableAgents = buildAssignableAgents(agents);
  const leader = cliAgents.find((agent) => agent.id === leaderId);

  const ensureModelsForKind = (agentKind: AgentKind) => {
    if (!onLoadModels || requestedKindsRef.current.has(agentKind)) return;
    requestedKindsRef.current.add(agentKind);
    setLoadingKinds((prev) => ({ ...prev, [agentKind]: true }));
    void onLoadModels(agentKind)
      .then((list) => setModelsByKind((prev) => ({ ...prev, [agentKind]: list })))
      .catch(() => setModelsByKind((prev) => ({ ...prev, [agentKind]: [] })))
      .finally(() => setLoadingKinds((prev) => ({ ...prev, [agentKind]: false })));
  };

  useEffect(() => {
    for (const part of parts) {
      const assigned = assignableAgents.find((agent) => agent.id === part.agentId);
      if (assigned) ensureModelsForKind(assigned.kind);
    }
  }, [parts, agents, onLoadModels]);

  const partsWithAgents = parts
    .map((part) => ({ ...part, agent: assignableAgents.find((agent) => agent.id === part.agentId) }))
    .filter((part) => part.agent && part.title.trim() && part.description.trim()) as Array<PartDraftRow & { agent: Agent }>;
  const incompleteCount = parts.filter((part) => !part.agentId || !part.title.trim() || !part.description.trim()).length;

  const fetchDirs = async (dir?: string) => {
    setDirsLoading(true);
    setLocalError('');
    try {
      if (onLoadDirs) {
        setDirs(await onLoadDirs(dir));
        return;
      }
      const response = await fetch(`/api/tasks/dirs${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`, { method: 'GET' });
      if (!response.ok) throw new Error('读取工作区目录失败');
      setDirs(await response.json());
    } catch (err) {
      setLocalError(errorMessage(err, '读取工作区目录失败'));
    } finally {
      setDirsLoading(false);
    }
  };

  const toggleDirPicker = () => {
    const next = !dirPickerOpen;
    setDirPickerOpen(next);
    if (next && dirs.length === 0) void fetchDirs();
  };

  const pickWorkspaceFolder = async () => {
    if (window.workbenchDesktop?.pickDirectory) {
      setLocalError('');
      try {
        const picked = await window.workbenchDesktop.pickDirectory(workspacePath || undefined);
        if (picked) onWorkspacePath(picked);
      } catch (err) {
        setLocalError(errorMessage(err, '打开文件夹选择器失败'));
      }
      return;
    }
    toggleDirPicker();
  };

  const mergeFollowUpIntoTask = (): Task | null => {
    if (!task) return null;
    const note = followUp.trim();
    if (!note) return task;
    const nextDesc = task.description ? `${task.description}\n\n${note}` : note;
    const updated: Task = { ...task, description: nextDesc };
    onDescription(nextDesc);
    onOpenTask(updated);
    setFollowUp('');
    return updated;
  };

  const submitFollowUp = async () => {
    const note = followUp.trim();
    if (task?.status !== 'done' || !onFollowUp || !note || sendingFollowUp) return;
    setSendingFollowUp(true);
    setLocalError('');
    try {
      await onFollowUp(task.id, note, task.round ?? 1);
    } catch (err) {
      setLocalError(errorMessage(err, '追加要求失败'));
    } finally {
      setSendingFollowUp(false);
    }
  };

  const completeRequirement = async () => {
    if (!leader || !task) return;
    const activeTask = mergeFollowUpIntoTask() ?? task;
    setBusyComplete(true);
    setLocalError('');
    try {
      let completed = '';
      if (onCompleteRequirement) {
        completed = await onCompleteRequirement(activeTask.id, leader, activeTask.description);
      } else {
        const response = await fetch(`/api/tasks/${activeTask.id}/complete-requirement`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent: leader, description: activeTask.description }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '补全需求失败');
        const data = (await response.json()) as { requirement: string };
        completed = data.requirement;
      }
      onDescription(completed);
      onOpenTask({ ...activeTask, description: completed, leaderAgentId: leader.id });
    } catch (err) {
      setLocalError(errorMessage(err, '补全需求失败'));
    } finally {
      setBusyComplete(false);
    }
  };

  const planByLeader = async () => {
    if (!leader || !task) return;
    const activeTask = mergeFollowUpIntoTask() ?? task;
    setBusyPlan(true);
    setLocalError('');
    try {
      let drafts: PartDraft[] = [];
      if (onPlan) {
        drafts = await onPlan(activeTask.id, leader, activeTask.description);
      } else {
        const response = await fetch(`/api/tasks/${activeTask.id}/plan`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agent: leader, description: activeTask.description }),
        });
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || '拆分分工失败');
        drafts = (await response.json()) as PartDraft[];
      }
      onParts(drafts.map(applyDraft));
    } catch (err) {
      setLocalError(errorMessage(err, '拆分分工失败'));
    } finally {
      setBusyPlan(false);
    }
  };

  const copyText = (key: string, value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(value).then(() => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? '' : cur)), 1600);
      }).catch(() => {});
    }
  };

  const promptText = description || title;
  const canCreate = Boolean(promptText.trim());
  const handlePromptChange = (value: string) => {
    onDescription(value);
    onTitle(deriveTitle(value));
  };

  if (!task) {
    return (
      <div className="task-view">
        {localError && (
          <div className="error" role="alert">
            <span>{localError}</span>
            <button type="button" onClick={() => setLocalError('')} aria-label="关闭提示">×</button>
          </div>
        )}

        <div className="task-home">
          <div className="task-home-inner">
            <div className="task-hero">
              <img className="logo large" src="/app-icon.png" alt="" aria-hidden="true" />
              <h1>协作任务</h1>
              <p className="muted">选择工作区与 Leader 智能体，直接输入需求开始协作。</p>
            </div>

            <div className="composer-card task-composer">
              <textarea
                value={promptText}
                onChange={(event) => handlePromptChange(event.target.value)}
                placeholder="描述你想完成的任务…（首行将作为任务标题）"
                aria-label="任务描述"
                rows={3}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (canCreate) onCreate();
                  }
                }}
              />

              <div className="composer-bar task-composer-bar">
                <div className="workspace-chip-group">
                  <button
                    type="button"
                    className={`composer-chip${dirPickerOpen ? ' active' : ''}`}
                    onClick={() => void pickWorkspaceFolder()}
                    aria-expanded={window.workbenchDesktop?.pickDirectory ? undefined : dirPickerOpen}
                    title={workspacePath || '点击选择本地工作区文件夹（支持新建）'}
                  >
                    <FolderIcon />
                    <span className="chip-text">{workspacePath ? pathTail(workspacePath) : '选择工作区'}</span>
                  </button>
                  {workspacePath && (
                    <button
                      type="button"
                      className="chip-clear"
                      onClick={() => onWorkspacePath('')}
                      aria-label="重置工作区"
                      title="恢复默认工作区"
                    >
                      ×
                    </button>
                  )}
                </div>

                <label className="composer-chip composer-select-chip">
                  {leader ? <AgentIcon kind={leader.kind} /> : <span className="leader-dot" aria-hidden="true" />}
                  <select
                    value={leaderId}
                    onChange={(event) => setLeaderId(event.target.value)}
                    aria-label="选择 leader 智能体"
                  >
                    <option value="">选择 Leader</option>
                    {cliAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agentOptionLabel(agent)}</option>
                    ))}
                  </select>
                </label>

                <span className="spacer" />

                <button
                  type="button"
                  className="send-btn"
                  disabled={!canCreate}
                  onClick={onCreate}
                  aria-label="创建任务"
                  title="创建任务（Enter 发送，Shift+Enter 换行）"
                >
                  <SendArrowIcon />
                </button>
              </div>
            </div>

            {dirPickerOpen && (
              <div className="dir-drawer">
                <div className="workspace-pick">
                  <input
                    className="input mono"
                    placeholder="输入或粘贴工作区绝对路径（留空使用默认）"
                    value={workspacePath}
                    onChange={(event) => onWorkspacePath(event.target.value)}
                    aria-label="工作区文件夹"
                  />
                  {workspacePath && (
                    <button type="button" className="btn btn-ghost" onClick={() => onWorkspacePath('')}>
                      重置
                    </button>
                  )}
                </div>
                <div className="dir-options">
                  {dirsLoading && <div className="empty">正在读取目录…</div>}
                  {!dirsLoading && dirs.length === 0 && <div className="empty">暂无可选目录，可直接输入路径。</div>}
                  {dirs.map((dir) => (
                    <div key={dir.path} className="dir-option">
                      <button
                        type="button"
                        className={`dir-path${workspacePath === dir.path ? ' chosen' : ''}`}
                        onClick={() => {
                          onWorkspacePath(dir.path);
                          void fetchDirs(dir.path);
                        }}
                      >
                        {dir.path}
                      </button>
                      <div className="dir-entries">
                        {dir.entries.filter((entry) => entry.dir).slice(0, 8).map((entry) => {
                          const nextPath = `${dir.path.replace(/[\\/]+$/, '')}/${entry.name}`;
                          return (
                            <button
                              key={entry.name}
                              type="button"
                              className={`dir-sub${workspacePath === nextPath ? ' chosen' : ''}`}
                              onClick={() => {
                                onWorkspacePath(nextPath);
                                void fetchDirs(nextPath);
                              }}
                            >
                              ▸ {entry.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasks.length > 0 && (
              <div className="recent-tasks">
                <div className="recent-tasks-head">最近任务</div>
                <div className="recent-tasks-list">
                  {tasks.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="recent-task-pill"
                      onClick={() => {
                        onOpenTask(item);
                        void onLiveSessions(item.id);
                      }}
                    >
                      <span className={`dot ${item.status}`} aria-hidden="true" />
                      <span className="recent-task-title">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const progressByPartId = new Map(progress.map((item) => [item.partId, item]));
  const round = task.round ?? 1;
  const currentParts = task.parts.filter((part) => (part.round ?? 1) === round);
  const totalParts = currentParts.length;
  const doneParts = currentParts.filter((part) => (progressByPartId.get(part.id)?.status ?? part.status) === 'done').length;
  const runningParts = currentParts.filter((part) => (progressByPartId.get(part.id)?.status ?? part.status) === 'running').length;
  const failedParts = currentParts.filter((part) => (progressByPartId.get(part.id)?.status ?? part.status) === 'failed').length;
  const pct = totalParts > 0 ? Math.round((doneParts / totalParts) * 100) : 0;
  const taskLeader = (task.leaderAgentId ? assignableAgents.find((agent) => agent.id === task.leaderAgentId) : undefined) ?? leader;
  const showTree = detailTab === 'all' || detailTab === 'tree';
  const showOutput = detailTab === 'all' || detailTab === 'output';
  const canDispatch = partsWithAgents.length > 0;

  const dispatchNow = () => {
    if (!canDispatch) return;
    onStart(
      partsWithAgents.map((part) => ({
        title: part.title,
        description: part.description,
        agent: part.agent,
        model: part.model || undefined,
        dependsOn: part.dependsOn || undefined,
        phase: part.phase,
      })),
      leader,
    );
  };

  return (
    <div className="task-view">
      <header className="content-head">
        <div className="head-title-row">
          <div className="head-title">
            <div className="task-title-line">
              <h1>{task.title}</h1>
              <span className={`badge ${task.status}`}>{statusLabel(task.status)}</span>
              {round > 1 && <span className="tool-name">第 {round} 轮</span>}
            </div>
            <div className="head-path" title={task.workspacePath}>
              {shortPath(task.workspacePath) || '默认工作区'}
              {task.workspacePath && (
                <button
                  type="button"
                  className="copy-btn task-inline-copy"
                  onClick={() => copyText('ws', task.workspacePath)}
                >
                  {copiedKey === 'ws' ? '已复制' : '复制路径'}
                </button>
              )}
            </div>
          </div>
          <div className="head-actions">
            {task.status === 'active' && onPause && (
              <button type="button" className="btn" onClick={onPause}>
                暂停
              </button>
            )}
            {task.status === 'paused' && onResume && (
              <button type="button" className="btn btn-primary" onClick={onResume}>
                继续
              </button>
            )}
            {(task.status === 'active' || task.status === 'paused') && onCancel && (
              <button type="button" className="btn btn-danger-ghost" onClick={onCancel}>
                取消任务
              </button>
            )}
            {onNewTask && (
              <button type="button" className="btn btn-ghost" onClick={onNewTask}>
                新建
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => onLiveSessions(task.id)}>
              刷新
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={onDelete} aria-label="删除任务">
              删除
            </button>
          </div>
        </div>
        <div className="meta">
          {taskLeader && (
            <span className="kind-chip">
              <AgentIcon kind={taskLeader.kind} />
              {agentName(taskLeader.kind)}
            </span>
          )}
          <span>{totalParts > 0 ? `${doneParts}/${totalParts} 完成（${pct}%）` : '待拆分'}</span>
          {runningParts > 0 && <span>{runningParts} 运行中</span>}
          {failedParts > 0 && <span className="text-danger">{failedParts} 失败</span>}
        </div>
      </header>

      {task.status !== 'planned' && (
        <div className="tabs-row">
          <div className="tabs" role="tablist" aria-label="任务视图筛选">
            {([
              { key: 'all', label: '全部', count: totalParts },
              { key: 'tree', label: '依赖树', count: totalParts },
              { key: 'output', label: '执行输出', count: progress.length },
            ] as Array<{ key: DetailTab; label: string; count: number }>).map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={detailTab === item.key}
                className={detailTab === item.key ? 'chosen' : ''}
                onClick={() => setDetailTab(item.key)}
              >
                {item.label}
                <span className="tab-count">{item.count}</span>
              </button>
            ))}
          </div>
          <div className="tabs-count">{totalParts > 0 ? `${doneParts}/${totalParts} 完成（${pct}%）` : '暂无分片'}</div>
        </div>
      )}

      {localError && (
        <div className="error" role="alert">
          <span>{localError}</span>
          <button type="button" onClick={() => setLocalError('')} aria-label="关闭提示">×</button>
        </div>
      )}

      <div className="task-scroll">
        <div className="task-inner">
          {detailTab === 'all' && (
            <article className="message user">
              <div className="message-head">
                <span className="role-tag user">{round > 1 ? '本轮需求' : '需求'}</span>
              </div>
              <div className="message-body">
                {task.description ? <CollapsibleText text={task.description} /> : task.title}
              </div>
            </article>
          )}
          {detailTab === 'all' && Boolean(task.previousRequirements?.length) && (
            <details className="part-log-details">
              <summary>查看之前的需求</summary>
              <CollapsibleText text={task.previousRequirements!.map((text, index) => `第 ${index + 1} 轮\n${text}`).join('\n\n')} />
            </details>
          )}

          {task.status === 'planned' && parts.length === 0 && (
            <article className="message assistant">
              <div className="message-head">
                <span className="role-tag assistant">Leader</span>
                {leader && <span className="tool-name">{agentName(leader.kind)}</span>}
              </div>
              <div className="message-body muted">
                在下方对话框中可直接补充需求细节，点击「补全需求」或「智能拆分」生成分片方案，也可以点「+ 手动分片」自行编排。
              </div>
            </article>
          )}

          {task.status === 'planned' && parts.length > 0 && (
            <article className="message assistant">
              <div className="message-head">
                <span className="role-tag assistant">分片方案</span>
                <span className="msg-time">已就绪 {partsWithAgents.length} / {parts.length}</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => onParts([...parts, { title: '', description: '', agentId: '', model: '', phase: 'coding', dependsOn: '' }])}
                >
                  + 添加分片
                </button>
              </div>

              <div className="part-box-list">
                {parts.map((part, index) => {
                  const usableTitles = parts.slice(0, index).map((item) => item.title.trim()).filter(Boolean);
                  const selectedAgent = assignableAgents.find((agent) => agent.id === part.agentId);
                  const kindModels = selectedAgent ? (modelsByKind[selectedAgent.kind] ?? []) : [];
                  const isModelsLoading = selectedAgent ? Boolean(loadingKinds[selectedAgent.kind]) : false;
                  const hasCustomModel = Boolean(part.model && !kindModels.some((m) => m.id === part.model));
                  return (
                    <div className="part-box" key={index}>
                      <div className="part-box-head">
                        <span className="part-index">#{index + 1}</span>
                        <select
                          className={`part-phase-inline phase-${part.phase}`}
                          value={part.phase}
                          onChange={(event) => onParts(parts.map((item, i) => (i === index ? { ...item, phase: event.target.value as PartDraftRow['phase'] } : item)))}
                          aria-label="阶段"
                        >
                          {PHASES.map((phase) => <option key={phase.key} value={phase.key}>{phase.label}</option>)}
                        </select>
                        <input
                          className="part-title-bare"
                          placeholder="分片标题"
                          value={part.title}
                          onChange={(event) => onParts(parts.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))}
                          aria-label={`分工${index + 1}标题`}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-remove-part"
                          onClick={() => onParts(parts.filter((_, i) => i !== index))}
                          title="移除此分片"
                        >
                          移除
                        </button>
                      </div>

                      <textarea
                        className="part-desc-bare"
                        rows={2}
                        placeholder="职责说明与交付要求…"
                        value={part.description}
                        onChange={(event) => onParts(parts.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))}
                        aria-label={`分工${index + 1}说明`}
                      />

                      <div className="part-box-bar">
                        <label className="composer-chip composer-select-chip">
                          {selectedAgent ? <AgentIcon kind={selectedAgent.kind} /> : <span className="leader-dot" aria-hidden="true" />}
                          <select
                            value={part.agentId}
                            onChange={(event) => {
                              const nextAgentId = event.target.value;
                              const nextAgent = assignableAgents.find((agent) => agent.id === nextAgentId);
                              if (nextAgent) ensureModelsForKind(nextAgent.kind);
                              onParts(parts.map((item, i) => (i === index ? { ...item, agentId: nextAgentId, model: '' } : item)));
                            }}
                            aria-label={`分工${index + 1}智能体`}
                          >
                            <option value="">选择智能体</option>
                            {assignableAgents.map((agent) => (
                              <option key={agent.id} value={agent.id}>{agentOptionLabel(agent)}</option>
                            ))}
                          </select>
                        </label>

                        <label className={`composer-chip composer-select-chip${!selectedAgent ? ' disabled' : ''}`}>
                          <select
                            value={part.model}
                            disabled={!selectedAgent || isModelsLoading}
                            onChange={(event) => onParts(parts.map((item, i) => (i === index ? { ...item, model: event.target.value } : item)))}
                            aria-label={`分工${index + 1}模型`}
                          >
                            <option value="">
                              {!selectedAgent ? '先选智能体' : isModelsLoading ? '加载模型…' : '默认模型'}
                            </option>
                            {hasCustomModel && <option value={part.model}>{part.model}</option>}
                            {kindModels.map((model) => (
                              <option key={model.id} value={model.id}>{model.label}</option>
                            ))}
                          </select>
                        </label>

                        <label className="composer-chip composer-select-chip">
                          <select
                            value={part.dependsOn}
                            onChange={(event) => onParts(parts.map((item, i) => (i === index ? { ...item, dependsOn: event.target.value } : item)))}
                            aria-label={`分工${index + 1}依赖`}
                          >
                            <option value="">无前置依赖</option>
                            {usableTitles.map((titleOption) => (
                              <option key={titleOption} value={titleOption}>依赖：{titleOption}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {selectedAgent && DESKTOP_ONLY_KINDS.has(selectedAgent.kind) && (
                        <div className="part-hint">
                          桌面智能体将生成 PROMPT.md，需在客户端完成后写入 RESULT.md 与 DONE。
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {incompleteCount > 0 && partsWithAgents.length > 0 && (
                <div className="muted small">尚有 {incompleteCount} 条未填完整，派发时将仅提交已就绪的 {partsWithAgents.length} 条。</div>
              )}
            </article>
          )}

          {showTree && totalParts > 0 && (
            <section className="task-section">
              <div className="section-head">
                <h2>依赖树</h2>
                <span className="muted small">{doneParts}/{totalParts} 完成（{pct}%）</span>
              </div>
              <div className="progress-bar-track" aria-label={`任务总进度 ${pct}%`}>
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <TaskTree parts={currentParts} progress={progress} agents={agents} />
            </section>
          )}

          {detailTab === 'all' && summary && (
            <article className="message assistant">
              <div className="message-head">
                <span className="role-tag assistant">Leader 汇总</span>
                {taskLeader && <span className="tool-name">{agentName(taskLeader.kind)}</span>}
              </div>
              <div className="message-body">
                <CollapsibleText text={summary} />
              </div>
            </article>
          )}

          {(task.status !== 'planned' || task.parts.length > 0) && showOutput && (
            <section className="task-section">
              <div className="section-head">
                <h2>执行输出与结果</h2>
                <span className="muted small">{progress.length} 项</span>
              </div>
              {progress.length === 0 && <div className="empty">暂无执行记录。</div>}
              <div className="progress-stream">
                {progress.map((part) => {
                  const pt = task.parts.find((item) => item.id === part.partId);
                  const agent = assignableAgents.find((a) => a.id === pt?.assignedAgentId)
                    ?? (pt?.agentKind ? assignableAgents.find((a) => a.kind === pt.agentKind) : undefined);
                  const copyId = `res:${part.partId}`;
                  const emptyHint =
                    part.status === 'done'
                      ? '已完成（未生成 RESULT.md）'
                      : part.status === 'failed'
                        ? '执行失败，无终端输出'
                        : part.status === 'pending'
                          ? '等待前置分片完成…'
                          : '等待智能体输出…';
                  return (
                    <article className="message" key={part.partId}>
                      <div className="message-head">
                        <span className={`badge ${part.status}`}>{statusLabel(part.status)}</span>
                        <strong className="progress-title">{pt?.title || part.partId.slice(0, 8)}</strong>
                        {round > 1 && pt && <span className="tool-name">第 {pt.round ?? 1} 轮</span>}
                        {agent && (
                          <span className="source-badge">
                            <AgentIcon kind={agent.kind} />
                            {agentName(agent.kind)}
                          </span>
                        )}
                        {pt?.model && <span className="tool-name">{pt.model}</span>}
                        <span className="spacer" />
                        <button
                          type="button"
                          className="copy-btn"
                          disabled={!agent || DESKTOP_ONLY_KINDS.has(agent.kind)}
                          title={!agent ? '旧任务的智能体标识已失效，请新建任务' : '跳转到该智能体对应的会话'}
                          onClick={() => agent && onOpenAgent(agent.kind, agent.sessionId ?? '', task.workspacePath || agent.cwd, pt?.title)}
                        >
                          打开会话
                        </button>
                      </div>
                      {part.result ? (
                        <>
                          <div className="part-result-body">
                            <CollapsibleText text={part.result} />
                          </div>
                          {part.tail && (
                            <details className="part-log-details">
                              <summary>查看终端输出</summary>
                              <pre className="tool-output">{part.tail}</pre>
                            </details>
                          )}
                        </>
                      ) : (
                        <pre className="tool-output">{part.tail || emptyHint}</pre>
                      )}
                      {part.resultPath && (
                        <div className="result-path-row">
                          <small className="mono">{part.resultPath}</small>
                          <button
                            type="button"
                            className="copy-btn task-inline-copy"
                            onClick={() => copyText(copyId, part.resultPath)}
                          >
                            {copiedKey === copyId ? '已复制' : '复制'}
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          {detailTab === 'all' && liveSessions.length > 0 && (
            <section className="task-section">
              <div className="section-head">
                <h2>实时会话</h2>
                <span className="muted small">{liveSessions.length} 个</span>
              </div>
              <div className="live-list">
                {liveSessions.map((session) => {
                  const pt = task.parts.find((item) => item.assignedAgentId === session.agentId);
                  const agent = assignableAgents.find((a) => a.id === session.agentId)
                    ?? (pt?.agentKind ? assignableAgents.find((a) => a.kind === pt.agentKind) : undefined);
                  return (
                    <div key={session.agentId} className="live-session-row">
                      <span className="kind-chip">
                        <AgentIcon kind={agent?.kind || 'generic'} />
                        <span>{agent ? agentOptionLabel(agent) : session.agentId}</span>
                      </span>
                      <span className="dim small">{session.events.length} 条</span>
                      <span className="spacer" />
                      <button
                        type="button"
                        className="link-btn"
                        disabled={!agent || DESKTOP_ONLY_KINDS.has(agent.kind)}
                        title={!agent ? '旧任务的智能体标识已失效，请新建任务' : '跳转到该智能体对应的会话'}
                        onClick={() => agent && onOpenAgent(agent.kind, agent.sessionId ?? '', task.workspacePath || agent.cwd, pt?.title)}
                      >
                        打开
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {task.status === 'done' && onFollowUp && (
        <div className="composer task-docked-composer">
          <form className="composer-card task-composer" onSubmit={(event) => { event.preventDefault(); void submitFollowUp(); }}>
            <textarea
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              disabled={sendingFollowUp}
              placeholder="输入追加要求，继续在此工作区完成下一轮…"
              aria-label="追加任务要求"
              rows={2}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void submitFollowUp();
                }
              }}
            />
            <div className="composer-bar task-composer-bar">
              <span className="spacer" />
              <button type="submit" className="btn btn-primary task-dispatch-btn" disabled={!followUp.trim() || sendingFollowUp}>
                {sendingFollowUp ? '正在追加…' : '开始下一轮'}
              </button>
            </div>
          </form>
        </div>
      )}

      {task.status === 'planned' && (
        <div className="composer task-docked-composer">
          <div className="task-quick-actions">
            <button type="button" className="btn" disabled={!leader || busyComplete} onClick={() => void completeRequirement()}>
              {busyComplete ? '补全中…' : '补全需求'}
            </button>
            <button type="button" className="btn" disabled={!leader || busyPlan} onClick={() => void planByLeader()}>
              {busyPlan ? '拆分中…' : '智能拆分'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onParts([...parts, { title: '', description: '', agentId: '', model: '', phase: 'coding', dependsOn: '' }])}
            >
              + 手动分片
            </button>
          </div>

          <div className="composer-card task-composer">
            <textarea
              value={followUp}
              onChange={(event) => setFollowUp(event.target.value)}
              placeholder="补充需求细节，Enter 追加到需求背景…"
              aria-label="补充任务说明"
              rows={2}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  if (followUp.trim()) mergeFollowUpIntoTask();
                }
              }}
            />
            <div className="composer-bar task-composer-bar">
              <label className="composer-chip composer-select-chip">
                {leader ? <AgentIcon kind={leader.kind} /> : <span className="leader-dot" aria-hidden="true" />}
                <select
                  value={leaderId}
                  onChange={(event) => setLeaderId(event.target.value)}
                  aria-label="选择 leader 智能体"
                >
                  <option value="">选择 Leader</option>
                  {cliAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agentOptionLabel(agent)}</option>
                  ))}
                </select>
              </label>

              <span className="spacer" />

              {followUp.trim() ? (
                <button
                  type="button"
                  className="send-btn"
                  onClick={() => mergeFollowUpIntoTask()}
                  aria-label="追加需求"
                  title="追加到需求背景（Enter）"
                >
                  <SendArrowIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary task-dispatch-btn"
                  disabled={!canDispatch}
                  onClick={dispatchNow}
                >
                  确认并派发（{partsWithAgents.length}）
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskTree({
  parts,
  progress,
  agents,
}: {
  parts: { id: string; title: string; description: string; status: string; assignedAgentId?: string | null; model?: string | null; dependsOn?: string | null }[];
  progress: PartProgress[];
  agents: Agent[];
}) {
  const progressMap = new Map(progress.map((item) => [item.partId, item.status]));
  const statusOf = (id: string) => progressMap.get(id) ?? parts.find((part) => part.id === id)?.status ?? 'pending';
  const used: Record<string, boolean> = {};

  const node = (part: { id: string; title: string; assignedAgentId?: string | null; model?: string | null }) => {
    const status = statusOf(part.id);
    const agent = part.assignedAgentId ? agents.find((a) => a.id === part.assignedAgentId) : undefined;
    return (
      <div className={`tree-node ${status}`}>
        <span className={`tree-dot ${status}`} aria-hidden="true" />
        <span className="tree-title">{part.title || part.id.slice(0, 8)}</span>
        {agent && (
          <span className="source-badge">
            <AgentIcon kind={agent.kind} />
            {agentName(agent.kind)}
          </span>
        )}
        {part.model && <span className="tool-name">{part.model}</span>}
        <span className="tree-status">{statusLabel(status)}</span>
      </div>
    );
  };

  const roots = parts.filter(
    (part) => !part.dependsOn || !parts.some((other) => other.title === part.dependsOn?.split(/[,，]/)[0].trim() && other.title !== part.title),
  );

  const renderLevel = (ids: string[], depth: number): React.ReactNode => {
    if (!ids.length) return null;
    return (
      <div className={`tree-level${depth > 0 ? ' nested' : ''}`}>
        {ids.map((id) => {
          if (used[id]) return null;
          const part = parts.find((item) => item.id === id);
          if (!part) return null;
          used[id] = true;
          const children = parts.filter((item) => item.dependsOn?.split(/[,，]/).map((x) => x.trim()).includes(part.title));
          return (
            <div key={id} className="tree-branch">
              {node(part)}
              {children.length > 0 && renderLevel(children.map((child) => child.id), depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  const rootsToRender = roots.filter((part) => !used[part.id]);
  return (
    <div className="task-tree">
      {rootsToRender.length === 0 && parts.length > 0 && renderLevel(parts.map((part) => part.id), 0)}
      {rootsToRender.length > 0 && renderLevel(rootsToRender.map((part) => part.id), 0)}
      {parts.length === 0 && <div className="empty">暂无分工。</div>}
    </div>
  );
}
