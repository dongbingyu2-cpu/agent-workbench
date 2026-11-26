import type { Agent, AgentKind, CatalogModel, CodexModel, DirEntry, DirListing, PartDraft, PartProgress, SessionEvent, SessionSummary, Task, TaskLiveSession, WorkspaceInfo, WsMessage } from './types';

export interface Client {
  listAgents(): Promise<Agent[]>;
  adopt(id: string, agent: Agent, options?: { model?: string; effort?: string }): Promise<void>;
  stopAgent(id: string): Promise<void>;
  dispatch(id: string, agent: Agent, instruction: string): Promise<void>;
  release(id: string): Promise<void>;
  input(id: string, data: string): Promise<void>;
  resumeCodex(sessionId: string): Promise<void>;
  listCodexModels(): Promise<CodexModel[]>;
  agentModels(kind: AgentKind, refresh?: boolean): Promise<CatalogModel[]>;
  sendCodex(sessionId: string, text: string, options?: { model?: string; effort?: string }): Promise<void>;
  interruptCodex(sessionId: string): Promise<void>;
  listSessions(id: string): Promise<SessionEvent[]>;
  listTasks(): Promise<Task[]>;
  createTask(title: string, description: string, workspacePath?: string): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  pauseTask(id: string): Promise<void>;
  resumeTask(id: string): Promise<void>;
  followUpTask(id: string, description: string, round: number): Promise<Task>;
  cancelTask(id: string): Promise<void>;
  taskDirs(dir?: string): Promise<DirListing[]>;
  plan(taskId: string, agent: Agent, description?: string): Promise<PartDraft[]>;
  completeRequirement(taskId: string, agent: Agent, description?: string): Promise<string>;
  confirm(taskId: string, parts: Array<{ title: string; description: string; agent: Agent; model?: string; dependsOn?: string; phase?: 'coding' | 'review' | 'test' }>, leaderAgent?: Agent, draft?: { round: number; description: string }): Promise<void>;
  progress(taskId: string): Promise<PartProgress[]>;
  taskLiveSessions(taskId: string): Promise<TaskLiveSession[]>;
  agentWorkspace(agent: Agent): Promise<WorkspaceInfo>;
  agentSessions(agent: Agent): Promise<SessionSummary[]>;
  sessionEvents(id: string, path?: string, kind?: AgentKind): Promise<SessionEvent[]>;
  taskWorkspace(taskId: string): Promise<WorkspaceInfo>;
  subscribe(fn: (m: WsMessage) => void, onOpen?: () => void, onError?: () => void): () => void;
}

export function createClient(baseUrl = '', fetchImpl: typeof fetch = fetch): Client {
  const call = (path: string, method: string, body?: unknown): Promise<Response> =>
    fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const callJson = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
    const res = await call(path, method, body);
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { message?: string; error?: string } | null;
      throw new Error(body?.message || body?.error || `request failed: ${method} ${path}`);
    }
    return (await res.json()) as T;
  };

  return {
    listAgents: () => callJson<Agent[]>('/api/agents', 'GET'),
    adopt: async (id, agent, options) => {
      await callJson(`/api/agents/${encodeURIComponent(id)}/adopt`, 'POST', { agent, ...options });
    },
    stopAgent: async (id) => { await callJson(`/api/agents/${encodeURIComponent(id)}/stop`, 'POST'); },
    dispatch: async (id, agent, instruction) => {
      await callJson(`/api/agents/${id}/dispatch`, 'POST', { agent, instruction });
    },
    release: async (id) => {
      await callJson(`/api/agents/${id}/release`, 'POST');
    },
    input: async (id, data) => {
      await callJson(`/api/agents/${encodeURIComponent(id)}/input`, 'POST', { data });
    },
    resumeCodex: async (sessionId) => {
      await callJson(`/api/codex/sessions/${encodeURIComponent(sessionId)}/resume`, 'POST');
    },
    listCodexModels: () => callJson<CodexModel[]>('/api/codex/models', 'GET'),
    agentModels: async (kind, refresh) => {
      const result = await callJson<{ models: CatalogModel[] }>(`/api/models?kind=${encodeURIComponent(kind)}${refresh ? '&refresh=1' : ''}`, 'GET');
      return result.models;
    },
    sendCodex: async (sessionId, text, options) => {
      await callJson(`/api/codex/sessions/${encodeURIComponent(sessionId)}/input`, 'POST', { text, ...options });
    },
    interruptCodex: async (sessionId) => {
      await callJson(`/api/codex/sessions/${encodeURIComponent(sessionId)}/interrupt`, 'POST');
    },
    listSessions: (id) => callJson<SessionEvent[]>(`/api/sessions/${id}`, 'GET'),
    taskDirs: (dir) => callJson<DirListing[]>(`/api/tasks/dirs${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`, 'GET'),
    listTasks: () => callJson<Task[]>('/api/tasks', 'GET'),
    createTask: (title, description, workspacePath) => callJson<Task>('/api/tasks', 'POST', { title, description, workspacePath }),
    deleteTask: async (id) => { await callJson(`/api/tasks/${encodeURIComponent(id)}`, 'DELETE'); },
    pauseTask: async (id) => { await callJson(`/api/tasks/${encodeURIComponent(id)}/pause`, 'POST'); },
    resumeTask: async (id) => { await callJson(`/api/tasks/${encodeURIComponent(id)}/resume`, 'POST'); },
    followUpTask: (id, description, round) => callJson<Task>(`/api/tasks/${encodeURIComponent(id)}/follow-up`, 'POST', { description, round }),
    cancelTask: async (id) => { await callJson(`/api/tasks/${encodeURIComponent(id)}/cancel`, 'POST'); },
    plan: (taskId, agent, description) => callJson<PartDraft[]>(`/api/tasks/${taskId}/plan`, 'POST', { agent, description }),
    completeRequirement: (taskId, agent, description) => callJson<{ requirement: string }>(`/api/tasks/${taskId}/complete-requirement`, 'POST', { agent, description }).then((r) => r.requirement),
    confirm: async (taskId, parts, leaderAgent, draft) => {
      await callJson(`/api/tasks/${taskId}/confirm`, 'POST', { parts, leaderAgent, ...draft });
    },
    taskLiveSessions: (taskId) => callJson<TaskLiveSession[]>(`/api/tasks/${taskId}/live-sessions`, 'GET'),
    progress: (taskId) => callJson<PartProgress[]>(`/api/tasks/${taskId}/progress`, 'GET'),
    agentWorkspace: (agent) =>
      callJson<WorkspaceInfo>(`/api/agents/${agent.id}/workspace?path=${encodeURIComponent(agent.cwd || '')}`, 'GET'),
    agentSessions: (agent) =>
      callJson<SessionSummary[]>(`/api/agents/${agent.id}/sessions?kind=${encodeURIComponent(agent.kind)}`, 'GET'),
    sessionEvents: (id, path, kind) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (kind) params.set('kind', kind);
      const qs = params.toString();
      return callJson<SessionEvent[]>(`/api/sessions/${id}${qs ? `?${qs}` : ''}`, 'GET');
    },
    taskWorkspace: (taskId) => callJson<WorkspaceInfo>(`/api/tasks/${taskId}/workspace`, 'GET'),
    subscribe: (fn, onOpen, onError) => {
      const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4177');
      const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/ws');
      ws.onopen = () => onOpen?.();
      ws.onerror = () => onError?.();
      ws.onmessage = (ev: MessageEvent) => fn(JSON.parse(ev.data as string) as WsMessage);
      return () => ws.close();
    },
  };
}
