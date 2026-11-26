export type AgentKind = 'claude' | 'codex' | 'opencode' | 'pi' | 'workbuddy' | 'dsh' | 'antigravity' | 'generic';
export type AgentOpenMode = 'desktop' | 'cli';
export interface AgentOpenOption {
  mode: AgentOpenMode;
  available: boolean;
}
export interface AgentOpenDetails {
  origin?: AgentOpenMode;
  title?: string;
  opencodeStorage?: 'v1' | 'v2';
}

declare global {
  interface Window {
    workbenchDesktop?: {
      openOptions?(kind: AgentKind, details?: AgentOpenDetails): Promise<AgentOpenOption[]>;
      openSession(kind: AgentKind, id: string, project: string, mode?: AgentOpenMode, details?: AgentOpenDetails): Promise<string | void>;
      pickDirectory?(defaultPath?: string): Promise<string | null>;
    };
  }
}
export type AgentStatus = 'discovered' | 'adopted' | 'running' | 'idle' | 'exited';

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
}

/** A model offered by a CLI agent (claude / pi / opencode), read from its local catalogue. */
export interface CatalogModel {
  id: string;
  label: string;
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  command: string;
  cwd: string;
  sessionId?: string;
  status: AgentStatus;
  managed: boolean;
  pid?: number;
}

export interface SessionEvent {
  ts: number | string;
  type: 'input' | 'output' | 'system' | 'tool';
  data: string;
  /** Tool name for `type: 'tool'` events. */
  name?: string;
}

export type TaskStatus = 'planned' | 'active' | 'paused' | 'done' | 'cancelled';
export type PartStatus = 'proposed' | 'pending' | 'running' | 'done' | 'failed';

export interface Part {
  id: string;
  taskId: string;
  round?: number;
  title: string;
  description: string;
  assignedAgentId: string | null;
  agentKind?: AgentKind | null;
  status: PartStatus;
  resultPath: string;
  doneMarker: string;
  model?: string | null;
  dependsOn?: string | null;
}

export interface Task {
  id: string;
  round?: number;
  previousRequirements?: string[];
  title: string;
  description: string;
  workspacePath: string;
  status: TaskStatus;
  parts: Part[];
  leaderAgentId?: string | null;
}

export interface PartDraft {
  title: string;
  description: string;
  suggestedAgentId: string | null;
  model?: string | null;
  phase?: 'coding' | 'review' | 'test';
  dependsOn?: string[] | null;
}

export interface PartProgress {
  partId: string;
  status: PartStatus;
  tail: string;
  resultPath: string;
  result?: string;
}

export type WsMessage =
  | { type: 'agent-output'; agentId: string; chunk: string }
  | { type: 'agent-exit'; agentId: string }
  | { type: 'codex-output'; sessionId: string; chunk: string }
  | { type: 'codex-completed'; sessionId: string }
  | { type: 'codex-error'; sessionId: string; message: string }
  | { type: 'task-progress'; taskId: string; parts: PartProgress[] };

export interface DirEntry {
  name: string;
  dir: boolean;
}

export interface WorkspaceInfo {
  path: string;
  entries: DirEntry[];
  shared?: string;
  summary?: string;
}

export interface TaskLiveSession {
  agentId: string;
  events: SessionEvent[];
}

export interface DirListing {
  path: string;
  entries: DirEntry[];
}

export interface SessionSummary {
  id: string;
  kind: AgentKind;
  title: string;
  project: string;
  updated: string | null;
  msgs: number | null;
  path?: string;
  /** When the transcript starts; falls back to `updated` in the UI. */
  startedAt?: string | null;
  model?: string | null;
  tools?: number | null;
  tokenIn?: number | null;
  tokenOut?: number | null;
  /** Prompt size of the latest turn and the model's context window, for the usage ring. */
  contextTokens?: number | null;
  contextWindow?: number | null;
  antigravityOrigins?: AgentOpenMode[];
  opencodeStorage?: 'v1' | 'v2';
  openTitle?: string;
}
