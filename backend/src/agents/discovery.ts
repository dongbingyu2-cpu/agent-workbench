import path from 'node:path';
import type { Agent, Session } from './types';
import { listAdapters } from './registry';
import { registerAdapters } from './adapters/index';
import { scanProcesses, type CommandRunner } from './processScanner';
import { matchProcess } from './matcher';

export interface DiscoveryRepo {
  scanAgents(): Promise<Agent[]>;
  scanSessions(): Promise<Session[]>;
}

interface DiscoveryDeps {
  runner: CommandRunner;
  homeDir: string;
  readdir: (p: string) => Promise<string[]>;
}

export class Discovery implements DiscoveryRepo {
  constructor(private readonly deps: DiscoveryDeps) {}

  async scanAgents(): Promise<Agent[]> {
    registerAdapters();
    const procs = await scanProcesses(this.deps.runner, process.platform);
    const adapters = listAdapters();
    const byKind = new Map(adapters.map((adapter) => [adapter.kind, adapter]));
    const seen = new Set<string>();
    const agents: Agent[] = [];

    for (const proc of procs) {
      const match = matchProcess(proc, adapters);
      if (!match) continue;
      const adapter = byKind.get(match.kind);
      if (!adapter) continue;
      // Keep distinct resumed sessions, but collapse every non-session helper
      // process of the same tool into one agent entry.
      const dedupeKey = match.sessionId ? `${match.kind}|sid:${match.sessionId}` : match.kind;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      agents.push({
        id: match.sessionId ? `session:${match.kind}:${match.sessionId}` : `kind:${match.kind}`,
        name: adapter.displayName,
        kind: match.kind,
        command: adapter.binaries[0] ?? proc.name,
        cwd: '',
        sessionId: match.sessionId,
        status: 'discovered',
        managed: false,
        pid: proc.pid,
      });
    }
    return agents;
  }

  async scanSessions(): Promise<Session[]> {
    registerAdapters();
    const sessions: Session[] = [];
    for (const adapter of listAdapters()) {
      if (!adapter.supportsResume) continue;
      const dir = path.join(this.deps.homeDir, `.${adapter.kind}`, 'sessions');
      let entries: string[] = [];
      try {
        entries = await this.deps.readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        sessions.push({
          id: entry.replace(/\.jsonl$/, ''),
          agentId: entry.replace(/\.jsonl$/, ''),
          source: 'disk',
          path: path.join(dir, entry),
          startedAt: 0,
          events: [],
        });
      }
    }
    return sessions;
  }
}
