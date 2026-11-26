export type AgentKind = 'claude' | 'codex' | 'opencode' | 'pi' | 'workbuddy' | 'dsh' | 'antigravity' | 'generic';

export function isExternalSessionKind(kind: AgentKind): boolean {
  return kind === 'workbuddy' || kind === 'dsh';
}

export type AgentStatus = 'discovered' | 'adopted' | 'running' | 'idle' | 'exited';

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

export type SessionSource = 'disk' | 'pty';
export type SessionEventType = 'input' | 'output' | 'system' | 'tool';

export interface SessionEvent {
  ts: number;
  type: SessionEventType;
  data: string;
  /** Tool name for `type: 'tool'` events (e.g. `exec_command`). */
  name?: string;
}

export interface Session {
  id: string;
  agentId: string;
  source: SessionSource;
  path: string;
  startedAt: number;
  events: SessionEvent[];
}

export type TaskStatus = 'planned' | 'active' | 'paused' | 'done' | 'cancelled';
export type PartStatus = 'proposed' | 'pending' | 'running' | 'done' | 'failed';
export type PartPhase = 'coding' | 'review' | 'test';

export interface Part {
  id: string;
  taskId: string;
  round?: number;
  title: string;
  description: string;
  assignedAgentId: string | null;
  agentKind?: AgentKind | null;
  phase?: PartPhase | null;
  status: PartStatus;
  resultPath: string;
  doneMarker: string;
  /** The model this part should be dispatched with (for CLIs that take one). */
  model?: string | null;
  /** Comma-separated part ids that must finish before this one starts. */
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
  /** The agent that completed/checked the requirement and wrote the plan. */
  leaderAgentId?: string | null;
}

export interface OneShotCommand {
  file: string;
  args: string[];
  stdin?: string;
}

export interface AgentAdapter {
  kind: AgentKind;
  displayName: string;
  binaries: string[];
  supportsResume: boolean;
  launch(opts: { resumeSessionId?: string; cwd: string; model?: string; effort?: string }): { file: string; args: string[] };
  oneShot?(opts: { prompt: string; cwd: string; model?: string; allowWrites?: boolean }): OneShotCommand;
}
