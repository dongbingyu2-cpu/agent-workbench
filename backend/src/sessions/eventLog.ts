import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Session, SessionEvent } from '../agents/types';

export interface SessionStore {
  append(sessionId: string, event: SessionEvent): void;
  read(sessionId: string, opts?: { limit?: number }): SessionEvent[];
  importDisk(filePath: string, agentId: string): Session;
}

export class JsonlSessionStore implements SessionStore {
  constructor(private readonly rootDir: string) {}

  private fileFor(sessionId: string): string {
    return path.join(this.rootDir, `${encodeURIComponent(sessionId)}.jsonl`);
  }

  append(sessionId: string, event: SessionEvent): void {
    mkdirSync(this.rootDir, { recursive: true });
    appendFileSync(this.fileFor(sessionId), `${JSON.stringify(event)}\n`, 'utf8');
  }

  read(sessionId: string, opts?: { limit?: number }): SessionEvent[] {
    const file = this.fileFor(sessionId);
    if (!existsSync(file)) return [];
    const events: SessionEvent[] = [];
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SessionEvent);
      } catch {
        // skip unparseable lines
      }
    }
    return opts?.limit ? events.slice(-opts.limit) : events;
  }

  importDisk(filePath: string, agentId: string): Session {
    let raw = '';
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      raw = '';
    }
    const events: SessionEvent[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const data =
        typeof obj.data === 'string'
          ? obj.data
          : typeof obj.text === 'string'
            ? obj.text
            : typeof obj.content === 'string'
              ? obj.content
              : undefined;
      if (data === undefined) continue;
      events.push({ ts: Number(obj.ts ?? obj.timestamp ?? 0), type: 'output', data });
    }
    return {
      id: path.basename(filePath).replace(/\.jsonl$/, ''),
      agentId,
      source: 'disk',
      path: filePath,
      startedAt: 0,
      events,
    };
  }
}
