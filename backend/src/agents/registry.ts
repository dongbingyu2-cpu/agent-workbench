import type { AgentAdapter, AgentKind } from './types';

const adapters = new Map<AgentKind, AgentAdapter>();

export function registerAdapter(adapter: AgentAdapter): void {
  adapters.set(adapter.kind, adapter);
}

export function getAdapter(kind: AgentKind): AgentAdapter {
  const found = adapters.get(kind) ?? adapters.get('generic');
  if (!found) throw new Error(`no adapter registered for kind: ${kind}`);
  return found;
}

export function listAdapters(): AgentAdapter[] {
  return [...adapters.values()];
}
