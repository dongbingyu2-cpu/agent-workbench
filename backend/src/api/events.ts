import type { PartProgress } from '../tasks/orchestrator';

export type WsMessage =
  | { type: 'agent-output'; agentId: string; chunk: string }
  | { type: 'agent-exit'; agentId: string }
  | { type: 'codex-output'; sessionId: string; chunk: string }
  | { type: 'codex-completed'; sessionId: string }
  | { type: 'codex-error'; sessionId: string; message: string }
  | { type: 'task-progress'; taskId: string; parts: PartProgress[] };

export class EventHub {
  private readonly subscribers = new Set<(msg: WsMessage) => void>();

  subscribe(fn: (msg: WsMessage) => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  publish(msg: WsMessage): void {
    for (const fn of this.subscribers) fn(msg);
  }
}
