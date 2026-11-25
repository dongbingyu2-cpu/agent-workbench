import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from './api';
import type { Agent, AgentKind, CatalogModel, CodexModel, PartProgress, SessionEvent, SessionSummary, Task, TaskLiveSession } from './types';
import { applyTheme, getStoredTheme, type Theme } from './theme';
import { Sidebar } from './components/Sidebar';
import { SessionBrowser, TaskBrowser, type SessionGroup, type SortKey } from './components/SessionBrowser';
import { SessionDetail, type MessageTab, type TimelineEntry } from './components/SessionDetail';
import { SettingsModal } from './components/SettingsModal';
import { TaskPanel, type PartDraftRow } from './components/TaskPanel';
import { LangProvider } from './lang';
import {
  type DeletedSessionEntry,
  loadArchivedSessions,
  loadArchivedWorkspaces,
  loadDeletedSessions,
  loadDisabledSources,
  saveArchivedSessions,
  saveArchivedWorkspaces,
  saveDeletedSessions,
  saveDisabledSources,
  sessionArchiveKey,
} from './archive';
import { decodeEntities, projectKey, projectLabel, toMs } from './format';

const client = createClient();

function sessionAgent(session: SessionSummary): Agent {
  return { id: `session:${session.kind}:${session.id}`, name: session.kind, kind: session.kind, command: session.kind, cwd: session.project, sessionId: session.id, status: 'discovered', managed: false };
}

type Runtime = { connected: boolean; connecting: boolean; running: boolean; output: string };
const EMPTY_RUNTIME: Runtime = { connected: false, connecting: false, running: false, output: '' };

function isReadOnlySession(session: SessionSummary): boolean {
  return session.kind === 'workbuddy' || session.kind === 'dsh' || session.kind === 'antigravity';
}

/** Turn raw session events into timeline entries, dropping harness noise and empty turns. */
function toTimeline(events: SessionEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    if (event.type === 'tool') {
      const detail = decodeEntities(String(event.data || '').trim());
      if (detail) entries.push({ role: 'tool', ts: event.ts, text: detail, name: event.name });
      continue;
    }
    if (event.type === 'system' || typeof event.data !== 'string') continue;
    const text = decodeEntities(event.data.replace(/^(user|assistant|system|input|output):\s*/, ''));
    if (!text.trim()) continue;
    const role = event.data.startsWith('user:') ? 'user' : 'assistant';
    entries.push({ role, ts: event.ts, text });
  }
  return entries;
}

function EmptyState() {
  return (
    <div className="blank">
      <img className="logo large" src="/app-icon.png" alt="" aria-hidden="true" />
      <h2>选择一个会话</h2>
      <p>从左侧按项目浏览历史记录，或先搜索标题与路径。</p>
      <ul className="hint-list">
        <li>历史会话可在工作台浏览，并在支持的原客户端中打开。</li>
        <li>用「只看对话 / 只看工具」在长会话里快速定位。</li>
        <li>协作任务视图可把一件事拆给多个智能体并行推进。</li>
      </ul>
    </div>
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [runtimes, setRuntimes] = useState<Record<string, Runtime>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = selected ? sessionArchiveKey(selected) : '';
  const input = drafts[draftKey] ?? '';
  const setInput = (value: string) => setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<AgentKind | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('updated');
  const [msgTab, setMsgTab] = useState<MessageTab>(() => {
    if (typeof window === 'undefined') return 'all';
    const initial = new URLSearchParams(window.location.search).get('tab');
    return initial === 'chat' || initial === 'tools' ? initial : 'all';
  });
  const [tab, setTab] = useState<'sessions' | 'tasks'>('sessions');
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [agentModels, setAgentModels] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelReload, setModelReload] = useState(0);
  const [modelsError, setModelsError] = useState('');
  const [choices, setChoices] = useState<Record<string, { model: string; effort: string }>>({});
  const choice = choices[draftKey] ?? { model: '', effort: '' };
  const setChoice = (next: { model: string; effort: string }) => setChoices((previous) => ({ ...previous, [draftKey]: next }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openFeedback, setOpenFeedback] = useState<{ key: string; text: string }>();
  const [archived, setArchived] = useState<string[]>(loadArchivedWorkspaces);
  const [archivedSessions, setArchivedSessions] = useState<string[]>(loadArchivedSessions);
  const [disabledSources, setDisabledSources] = useState<AgentKind[]>(loadDisabledSources);
  const [deletedSessions, setDeletedSessions] = useState<DeletedSessionEntry[]>(loadDeletedSessions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [task, setTask] = useState<Task | null>(null);
  const [parts, setParts] = useState<PartDraftRow[]>([]);
  const [progress, setProgress] = useState<PartProgress[]>([]);
  const [taskSummary, setTaskSummary] = useState('');
  const [liveSessions, setLiveSessions] = useState<TaskLiveSession[]>([]);

  // Read the deep link once: the URL sync effect below would otherwise erase it before sessions load.
  const deepLink = useRef(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session'));
  const modelsKind = useRef<AgentKind | ''>('');
  const forceModelRefresh = useRef(false);

  // Each resumed session keeps its own connection/run state so switching away from one
  // transcript never tears down another that is still working.
  const runtimesRef = useRef(runtimes);
  runtimesRef.current = runtimes;
  const socketRef = useRef<{ close: () => void } | null>(null);
  const socketOpenRef = useRef(false);
  const resumeQueue = useRef<Array<() => void>>([]);
  const idleTimers = useRef<Record<string, number>>({});

  const patchRuntime = (key: string, patch: Partial<Runtime>) => {
    setRuntimes((previous) => ({ ...previous, [key]: { ...EMPTY_RUNTIME, ...previous[key], ...patch } }));
  };
  const appendOutput = (key: string, chunk: string) => {
    setRuntimes((previous) => {
      const current = previous[key] ?? EMPTY_RUNTIME;
      return { ...previous, [key]: { ...current, output: (current.output + chunk).slice(-100000) } };
    });
  };
  const clearTurnTimer = (key: string) => {
    const timer = idleTimers.current[key];
    if (timer) {
      window.clearTimeout(timer);
      delete idleTimers.current[key];
    }
  };
  const armTurnTimer = (key: string) => {
    clearTurnTimer(key);
    idleTimers.current[key] = window.setTimeout(() => {
      patchRuntime(key, { running: false });
      delete idleTimers.current[key];
    }, 2500);
  };

  const ensureSocket = () => {
    if (socketRef.current) return;
    socketRef.current = {
      close: client.subscribe(
        (message) => {
          if (message.type === 'agent-output') {
            const key = message.agentId.startsWith('session:') ? message.agentId.slice('session:'.length) : message.agentId;
            appendOutput(key, message.chunk);
            if (runtimesRef.current[key]?.running) armTurnTimer(key);
          } else if (message.type === 'agent-exit') {
            const key = message.agentId.startsWith('session:') ? message.agentId.slice('session:'.length) : message.agentId;
            clearTurnTimer(key);
            patchRuntime(key, { connected: false, running: false });
            setError('智能体进程已退出，请检查实时输出并重试。');
          } else if (message.type === 'codex-output') {
            appendOutput(`codex:${message.sessionId}`, message.chunk);
          } else if (message.type === 'codex-completed') {
            const key = `codex:${message.sessionId}`;
            clearTurnTimer(key);
            patchRuntime(key, { connected: true, running: false });
          } else if (message.type === 'codex-error') {
            const key = `codex:${message.sessionId}`;
            clearTurnTimer(key);
            patchRuntime(key, { connected: false, running: false });
            setError(message.message);
          }
        },
        () => {
          socketOpenRef.current = true;
          const queued = resumeQueue.current;
          resumeQueue.current = [];
          queued.forEach((run) => run());
        },
        () => { socketOpenRef.current = false; },
      ),
    };
  };

  const resumeSession = (session: SessionSummary, force = false) => {
    if (isReadOnlySession(session)) return;
    const key = sessionArchiveKey(session);
    const current = runtimesRef.current[key];
    if (!force && (current?.connected || current?.connecting)) return;
    patchRuntime(key, { connecting: true });
    setError('');
    const run = () => {
      const agent = sessionAgent(session);
      const picked = choices[key] ?? { model: '', effort: '' };
      const pending = session.kind === 'codex'
        ? client.resumeCodex(session.id)
        : client.adopt(agent.id, agent, { model: picked.model || undefined, effort: picked.effort || undefined });
      pending
        .then(() => patchRuntime(key, { connecting: false, connected: true }))
        .catch((err) => {
          patchRuntime(key, { connecting: false, connected: false });
          setError(`自动续接失败：${err instanceof Error ? err.message : String(err)}`);
        });
    };
    ensureSocket();
    if (socketOpenRef.current) run();
    else resumeQueue.current.push(run);
  };

  useEffect(() => () => {
    socketRef.current?.close();
    Object.values(idleTimers.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const refresh = async () => {
    setLoading(true);
    try {
      const found = await client.listAgents();
      setAgents(found);
      const kinds = [...new Set(found.map((agent) => agent.kind))];
      const lists = await Promise.all(kinds.map((item) => client.agentSessions(found.find((agent) => agent.kind === item)!).catch(() => [])));
      setSessions(lists.flat().sort((left, right) => (toMs(right.updated) ?? 0) - (toMs(left.updated) ?? 0)));
      setError('');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    setEvents([]);
    if (!selected) return;
    setError('');
    let alive = true;
    setEventsLoading(true);
    client.sessionEvents(selected.id, selected.path, selected.kind)
      .then((items) => { if (alive) setEvents(items); })
      .catch((err) => { if (alive) setError(String(err)); })
      .finally(() => { if (alive) setEventsLoading(false); });
    return () => { alive = false; };
  }, [selected]);


  useEffect(() => {
    if (tab !== 'tasks') return;
    client.listTasks().then(setTasks).catch((err) => setError(String(err)));
  }, [tab]);

  // Deep link support: ?session=<kind>:<id> opens a transcript directly and survives a reload.
  useEffect(() => {
    if (selected || sessions.length === 0) return;
    const raw = deepLink.current;
    if (!raw) return;
    const [sessionKind, ...rest] = raw.split(':');
    const id = rest.join(':');
    const match = sessions.find((session) => session.kind === sessionKind && session.id === id);
    if (match) {
      deepLink.current = null;
      setSelected(match);
    }
  }, [sessions, selected]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!selected && deepLink.current) return; // keep the incoming link until it resolves
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set('session', `${selected.kind}:${selected.id}`);
    else url.searchParams.delete('session');
    window.history.replaceState(null, '', url.toString());
  }, [selected]);

  useEffect(() => {
    if (!task) {
      setTaskSummary('');
      return;
    }
    const fetchSummary = () => client.taskWorkspace(task.id).then((ws) => setTaskSummary(ws.summary ?? '')).catch(() => {});
    const update = () => client.progress(task.id).then((items) => {
      setProgress(items);
      if (items.length > 0 && task.status === 'active' && items.every((item) => item.status === 'done' || item.status === 'failed')) {
        client.listTasks().then((list) => {
          setTasks(list);
          const refreshed = list.find((item) => item.id === task.id);
          if (refreshed) setTask(refreshed);
        }).catch(() => {});
        void fetchSummary();
      }
    }).catch((err) => setError(String(err)));
    void update();
    if (task.status === 'done') void fetchSummary();
    else setTaskSummary('');
    if (task.status !== 'active') return;
    const timer = setInterval(update, 2000);
    return () => clearInterval(timer);
  }, [task]);

  const archivedSessionSet = useMemo(() => new Set(archivedSessions), [archivedSessions]);
  const disabledSourceSet = useMemo(() => new Set(disabledSources), [disabledSources]);
  const deletedSessionSet = useMemo(() => new Set(deletedSessions.map((item) => item.key)), [deletedSessions]);

  const detectedKinds = useMemo(() => {
    const set = new Set<AgentKind>();
    for (const agent of agents) set.add(agent.kind);
    for (const session of sessions) set.add(session.kind);
    return set;
  }, [agents, sessions]);

  const scopedSessions = useMemo(() => {
    const workspaces = new Set(archived);
    return sessions.filter((session) => {
      if (disabledSourceSet.has(session.kind)) return false;
      const key = sessionArchiveKey(session);
      if (deletedSessionSet.has(key)) return false;
      if (workspaces.has(projectKey(session.project ?? '')) || archivedSessionSet.has(key)) return false;
      return true;
    });
  }, [sessions, archived, archivedSessionSet, disabledSourceSet, deletedSessionSet]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const session of scopedSessions) map[session.kind] = (map[session.kind] ?? 0) + 1;
    return map;
  }, [scopedSessions]);

  const kinds = useMemo(() => {
    const present = new Set<AgentKind>();
    for (const session of scopedSessions) present.add(session.kind);
    return [...present].sort((left, right) => (counts[right] ?? 0) - (counts[left] ?? 0));
  }, [scopedSessions, counts]);

  const visibleSessions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const metric = (session: SessionSummary): number => {
      if (sort === 'msgs') return session.msgs ?? 0;
      if (sort === 'duration') {
        const end = toMs(session.updated) ?? 0;
        const start = toMs(session.startedAt) ?? end;
        return Math.max(0, end - start);
      }
      return toMs(session.updated) ?? 0;
    };
    return scopedSessions
      .filter((session) => kind === 'all' || session.kind === kind)
      .filter((session) => !needle || `${session.title} ${session.project}`.toLowerCase().includes(needle))
      .slice()
      .sort((left, right) => metric(right) - metric(left));
  }, [scopedSessions, search, kind, sort]);

  const groups = useMemo(() => {
    const map = new Map<string, SessionGroup>();
    for (const session of visibleSessions) {
      const key = projectKey(session.project ?? '');
      const entry = map.get(key) ?? { key, label: projectLabel(session.project ?? ''), items: [] };
      entry.items.push(session);
      map.set(key, entry);
    }
    return [...map.values()];
  }, [visibleSessions]);

  const archivedWorkspaceItems = useMemo(() => {
    const countsByKey = new Map<string, { label: string; count: number }>();
    for (const session of sessions) {
      const key = projectKey(session.project ?? '');
      const current = countsByKey.get(key) ?? { label: projectLabel(session.project ?? ''), count: 0 };
      current.count += 1;
      countsByKey.set(key, current);
    }
    return archived.map((key) => {
      const info = countsByKey.get(key);
      return { key, label: info?.label ?? projectLabel(key), count: info?.count ?? 0 };
    });
  }, [sessions, archived]);

  /** Individually archived sessions whose workspace is still visible. */
  const archivedLoose = useMemo(() => {
    const workspaces = new Set(archived);
    return sessions.filter((session) => {
      const key = sessionArchiveKey(session);
      if (deletedSessionSet.has(key)) return false;
      if (workspaces.has(projectKey(session.project ?? ''))) return false;
      return archivedSessionSet.has(key);
    });
  }, [sessions, archived, archivedSessionSet, deletedSessionSet]);

  const archiveWorkspace = (key: string) => {
    const next = [...new Set([...archived, key])];
    saveArchivedWorkspaces(next);
    setArchived(next);
  };

  const restoreWorkspace = (key: string) => {
    const next = archived.filter((item) => item !== key);
    saveArchivedWorkspaces(next);
    setArchived(next);
  };

  const archiveSession = (key: string) => {
    const next = [...new Set([...archivedSessions, key])];
    saveArchivedSessions(next);
    setArchivedSessions(next);
  };

  const restoreSession = (key: string) => {
    const next = archivedSessions.filter((item) => item !== key);
    saveArchivedSessions(next);
    setArchivedSessions(next);
  };

  const deleteSession = (session: SessionSummary) => {
    const key = sessionArchiveKey(session);
    const entry: DeletedSessionEntry = {
      key,
      kind: session.kind,
      id: session.id,
      title: session.title,
      project: session.project,
      updated: session.updated,
      deletedAt: Date.now(),
    };
    const next = [entry, ...deletedSessions.filter((item) => item.key !== key)];
    saveDeletedSessions(next);
    setDeletedSessions(next);
    if (archivedSessions.includes(key)) {
      const nextArchived = archivedSessions.filter((item) => item !== key);
      saveArchivedSessions(nextArchived);
      setArchivedSessions(nextArchived);
    }
    if (selected && sessionArchiveKey(selected) === key) setSelected(null);
  };

  const deleteArchivedWorkspace = (workspaceKey: string) => {
    const now = Date.now();
    const matched = sessions.filter((session) => projectKey(session.project ?? '') === workspaceKey);
    const entries: DeletedSessionEntry[] = matched.map((session) => ({
      key: sessionArchiveKey(session),
      kind: session.kind,
      id: session.id,
      title: session.title,
      project: session.project,
      updated: session.updated,
      deletedAt: now,
    }));
    if (entries.length > 0) {
      const addedKeys = new Set(entries.map((item) => item.key));
      const nextDeleted = [...entries, ...deletedSessions.filter((item) => !addedKeys.has(item.key))];
      saveDeletedSessions(nextDeleted);
      setDeletedSessions(nextDeleted);
      const nextArchivedSessions = archivedSessions.filter((item) => !addedKeys.has(item));
      if (nextArchivedSessions.length !== archivedSessions.length) {
        saveArchivedSessions(nextArchivedSessions);
        setArchivedSessions(nextArchivedSessions);
      }
    }
    const nextWorkspaces = archived.filter((item) => item !== workspaceKey);
    saveArchivedWorkspaces(nextWorkspaces);
    setArchived(nextWorkspaces);
    if (selected && projectKey(selected.project ?? '') === workspaceKey) setSelected(null);
  };

  const restoreDeletedSession = (key: string) => {
    const next = deletedSessions.filter((item) => item.key !== key);
    saveDeletedSessions(next);
    setDeletedSessions(next);
  };

  const updateDisabledSources = (next: AgentKind[]) => {
    saveDisabledSources(next);
    setDisabledSources(next);
    if (selected && next.includes(selected.kind)) setSelected(null);
    if (kind !== 'all' && next.includes(kind)) setKind('all');
  };

  const timeline = useMemo(() => toTimeline(events), [events]);

  const run = async (action: () => Promise<void>) => { try { setError(''); await action(); } catch (err) { setError(String(err)); } };

  // Each session tracks its own turn; the pause button reads from that session's runtime,
  // so switching away and back keeps the running state intact.
  const send = () => selected && input.trim() && run(async () => {
    const key = sessionArchiveKey(selected);
    if (selected.kind === 'codex') await client.sendCodex(selected.id, input, { model: choice.model || undefined, effort: choice.effort || undefined });
    else await client.input(sessionAgent(selected).id, `${input}\r`);
    patchRuntime(key, { running: true });
    if (selected.kind !== 'codex') armTurnTimer(key);
    // 回执只清理发送时的会话和文本，不覆盖等待期间新写的草稿。
    setDrafts((previous) => previous[draftKey] === input ? { ...previous, [draftKey]: '' } : previous);
  });
  const interrupt = () => selected && run(async () => {
    const key = sessionArchiveKey(selected);
    if (selected.kind === 'codex') await client.interruptCodex(selected.id);
    else await client.input(sessionAgent(selected).id, '\u0003');
    clearTurnTimer(key);
    patchRuntime(key, { running: false });
  });
  const create = () => run(async () => {
    const effectiveTitle = title.trim() || description.trim().split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.slice(0, 48) || '';
    const created = await client.createTask(effectiveTitle, description, workspacePath || undefined);
    setTasks((old) => [created, ...old]);
    setTask(created);
    setTitle('');
    setDescription('');
  });
  const removeTask = () => task && run(async () => {
    if (!window.confirm(`删除任务「${task.title}」？工作区文件不会被删除。`)) return;
    await client.deleteTask(task.id);
    setTasks((old) => old.filter((item) => item.id !== task.id));
    setTask(null);
  });
  const refreshActiveTask = async (taskId: string) => {
    const [list, prog] = await Promise.all([client.listTasks(), client.progress(taskId).catch(() => [])]);
    setTasks(list);
    setTask(list.find((item) => item.id === taskId) ?? null);
    setProgress(prog);
  };
  const pauseTask = () => task && run(async () => {
    await client.pauseTask(task.id);
    await refreshActiveTask(task.id);
  });
  const resumeTask = () => task && run(async () => {
    await client.resumeTask(task.id);
    await refreshActiveTask(task.id);
  });
  const cancelTask = () => task && run(async () => {
    if (!window.confirm(`取消任务「${task.title}」？运行中的分片将立即停止。`)) return;
    await client.cancelTask(task.id);
    await refreshActiveTask(task.id);
  });
  const startParts = (assignments: Array<{ title: string; description: string; agent: Agent; model?: string; dependsOn?: string; phase?: 'coding' | 'review' | 'test' }>, leader: Agent | undefined) => task && run(async () => {
    await client.confirm(task.id, assignments, leader);
    const list = await client.listTasks();
    setTasks(list);
    setTask(list.find((item) => item.id === task.id) ?? { ...task, status: 'active' });
  });

  const applyChoice = () => void run(async () => {
    if (!selected || !window.confirm('应用设置会中断当前 CLI 进程并重新续接，是否继续？')) return;
    const key = sessionArchiveKey(selected);
    await client.stopAgent(sessionAgent(selected).id);
    patchRuntime(key, { connected: false, running: false });
    resumeSession(selected, true);
  });

  const selectedKey = selected ? sessionArchiveKey(selected) : '';
  const selectedRuntime = selected ? runtimes[selectedKey] ?? EMPTY_RUNTIME : EMPTY_RUNTIME;
  const busyKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, runtime] of Object.entries(runtimes)) {
      if (runtime.connecting || runtime.running) set.add(key);
    }
    return set;
  }, [runtimes]);

  return <LangProvider lang="zh">
    <div className="shell">
      <Sidebar
        tab={tab}
        onTab={setTab}
        theme={theme}
        onTheme={setTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        footer={`本地工作台 · ${agents.length} 个智能体来源`}
      >
        {tab === 'sessions'
          ? <SessionBrowser
              sessions={visibleSessions}
              total={scopedSessions.length}
              groups={groups}
              search={search}
              onSearch={setSearch}
              kind={kind}
              onKind={setKind}
              kinds={kinds}
              counts={counts}
              selected={selected}
              onSelect={setSelected}
              busyKeys={busyKeys}
              sort={sort}
              onSort={setSort}
              onRefresh={() => void refresh()}
              loading={loading}
              hasHidden={archived.length > 0 || archivedSessions.length > 0 || deletedSessions.length > 0 || disabledSources.length > 0}
              onArchiveWorkspace={(key) => {
                archiveWorkspace(key);
                if (selected && projectKey(selected.project ?? '') === key) setSelected(null);
              }}
              onArchiveSession={(key) => {
                archiveSession(key);
                if (selected && sessionArchiveKey(selected) === key) setSelected(null);
              }}
              onDeleteSession={deleteSession}
            />
          : <TaskBrowser
              tasks={tasks}
              activeId={task?.id ?? null}
              onSelect={(id) => {
                const found = tasks.find((item) => item.id === id) ?? null;
                setTask(found);
                if (found) client.taskLiveSessions(found.id).then(setLiveSessions).catch(() => setLiveSessions([]));
              }}
              onNewTask={() => {
                setTask(null);
                setLiveSessions([]);
              }}
            />}
      </Sidebar>

      <main className="content">
        {error && <div className="error" role="alert">{error}<button type="button" onClick={() => setError('')} aria-label="关闭提示">×</button></div>}
        {tab === 'sessions' && selected && openFeedback?.key === sessionArchiveKey(selected) && (
          <div className="notice" role="status">{openFeedback.text}</div>
        )}
        {tab === 'sessions'
          ? (selected
              ? <SessionDetail
                  session={selected}
                  entries={timeline}
                  loading={eventsLoading}
                  tab={msgTab}
                  onTab={setMsgTab}
                  connected={selectedRuntime.connected}
                  connecting={selectedRuntime.connecting}
                  onRetry={() => selected && resumeSession(selected)}
                  output={selectedRuntime.output}
                  input={input}
                  onInput={setInput}
                  onSend={() => void send()}
                  onInterrupt={() => void interrupt()}
                  running={selectedRuntime.running}
                  models={codexModels}
                  cliModels={agentModels}
                  modelsError={modelsError}
                  modelsLoading={modelsLoading}
                  onRefreshModels={() => {
                    forceModelRefresh.current = true;
                    setModelReload((value) => value + 1);
                  }}
                  model={choice.model}
                  effort={choice.effort}
                  onChoice={setChoice}
                  onApply={applyChoice}
                  onDelete={() => selected && deleteSession(selected)}
                  onOpenAgent={(mode) => void run(async () => {
                    setOpenFeedback(undefined);
                    const bridge = window.workbenchDesktop;
                    if (!bridge) throw new Error('请使用桌面工作台打开会话');
                    const origins = selected.antigravityOrigins;
                    const preferred = mode ?? 'cli';
                    const origin = origins?.includes(preferred) ? preferred : origins?.[0];
                    const message = mode === undefined && selected.kind !== 'antigravity'
                      && selected.kind !== 'opencode' ? await bridge.openSession(selected.kind, selected.id, selected.project)
                      : await bridge.openSession(selected.kind, selected.id, selected.project, mode, {
                        title: selected.openTitle ?? selected.title, origin,
                        ...(selected.opencodeStorage ? { opencodeStorage: selected.opencodeStorage } : {}),
                      });
                    if (message) setOpenFeedback({ key: sessionArchiveKey(selected), text: message });
                  })}
                />
              : <EmptyState />)
          : <TaskPanel
              agents={agents}
              tasks={tasks}
              task={task}
              title={title}
              description={description}
              workspacePath={workspacePath}
              parts={parts}
              progress={progress}
              summary={taskSummary}
              onTitle={setTitle}
              onDescription={setDescription}
              onWorkspacePath={setWorkspacePath}
              onCreate={() => void create()}
              onDelete={() => void removeTask()}
              onPause={() => void pauseTask()}
              onResume={() => void resumeTask()}
              onCancel={() => void cancelTask()}
              onParts={setParts}
              onStart={startParts}
              onOpenTask={setTask}
              onJumpSession={(session) => setSelected(session)}
              onLiveSessions={(taskId) => client.taskLiveSessions(taskId).then(setLiveSessions).catch(() => setLiveSessions([]))}
              liveSessions={liveSessions}
              onOpenAgent={(kind, id, project, partTitle) => void run(async () => {
                const probeAgent = agents.find((a) => a.kind === kind) ?? {
                  id: `kind:${kind}`,
                  name: kind,
                  kind,
                  command: kind,
                  cwd: project ?? '',
                  status: 'discovered' as const,
                  managed: false,
                };
                const fresh = await client.agentSessions(probeAgent).catch(() => [] as SessionSummary[]);
                if (fresh.length > 0) {
                  setSessions((prev) => {
                    const others = prev.filter((item) => item.kind !== kind);
                    return [...others, ...fresh].sort((l, r) => (toMs(r.updated) ?? 0) - (toMs(l.updated) ?? 0));
                  });
                }
                const pool = (fresh.length > 0 ? fresh : sessions.filter((item) => item.kind === kind))
                  .slice()
                  .sort((l, r) => (toMs(r.updated) ?? 0) - (toMs(l.updated) ?? 0));
                const targetKey = project ? projectKey(project) : '';
                const byId = id ? pool.find((item) => item.id === id) : undefined;
                const inWorkspace = targetKey ? pool.filter((item) => projectKey(item.project ?? '') === targetKey) : pool;
                const needle = partTitle?.trim().toLowerCase() ?? '';
                const matched =
                  byId
                  ?? (needle ? inWorkspace.find((item) => item.title.toLowerCase().includes(needle)) : undefined)
                  ?? inWorkspace[0]
                  ?? (needle ? pool.find((item) => item.title.toLowerCase().includes(needle)) : undefined)
                  ?? pool[0];
                if (matched) {
                  setSelected(matched);
                  setTab('sessions');
                  return;
                }
                if (!window.workbenchDesktop) throw new Error('暂未找到对应的会话记录');
                await window.workbenchDesktop.openSession(kind, id, project ?? '', !id ? 'cli' : undefined);
              })}
              onNewTask={() => {
                setTask(null);
                setLiveSessions([]);
              }}
              onLoadDirs={(dir) => client.taskDirs(dir)}
              onCompleteRequirement={(taskId, leaderAgent) => client.completeRequirement(taskId, leaderAgent)}
              onPlan={(taskId, leaderAgent) => client.plan(taskId, leaderAgent)}
              onLoadModels={async (agentKind) => {
                if (agentKind === 'codex') {
                  const list = await client.listCodexModels();
                  return list.map((m) => ({ id: m.model || m.id, label: m.displayName || m.model || m.id }));
                }
                if (agentKind === 'claude' || agentKind === 'pi' || agentKind === 'opencode' || agentKind === 'antigravity') {
                  return client.agentModels(agentKind);
                }
                return [];
              }}
            />}
      </main>
    </div>
    <SettingsModal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      detectedKinds={detectedKinds}
      disabledSources={disabledSources}
      onSaveDisabledSources={updateDisabledSources}
      archivedWorkspaces={archivedWorkspaceItems}
      archivedSessions={archivedLoose}
      deletedSessions={deletedSessions}
      onRestoreWorkspace={restoreWorkspace}
      onRestoreArchivedSession={restoreSession}
      onDeleteArchivedWorkspace={deleteArchivedWorkspace}
      onDeleteArchivedSession={deleteSession}
      onRestoreDeletedSession={restoreDeletedSession}
    />
  </LangProvider>;
}
