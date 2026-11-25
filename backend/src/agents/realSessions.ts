import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { AgentKind, SessionEvent } from './types';

const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string, options?: { readOnly: boolean }) => any };

/**
 * A session summary plus the cheap-to-derive statistics the workbench shows in
 * the sidebar cards and the session header (duration, model, tool calls, tokens).
 * Fields stay nullable: not every agent format records them.
 */
export interface RealSession {
  id: string;
  title: string;
  project: string;
  updated: string | null;
  msgs: number | null;
  kind: AgentKind;
  path?: string;
  startedAt?: string | null;
  model?: string | null;
  tools?: number | null;
  tokenIn?: number | null;
  tokenOut?: number | null;
  /** Prompt size of the most recent turn, used for the context-usage ring. */
  contextTokens?: number | null;
  /** Model context window reported by the agent, when it exposes one. */
  contextWindow?: number | null;
  antigravityOrigins?: Array<'desktop' | 'cli'>;
  opencodeStorage?: 'v1' | 'v2';
  openTitle?: string;
}

interface Scan {
  model: string | null;
  tools: number;
  tokenIn: number | null;
  tokenOut: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
  startedAt: string | null;
}

const emptyScan = (): Scan => ({ model: null, tools: 0, tokenIn: null, tokenOut: null, contextTokens: null, contextWindow: null, startedAt: null });
const ANTIGRAVITY_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

interface AntigravitySummary {
  AppDataDir?: string;
  Title?: string;
  Preview?: string;
  WorkspaceURIs?: string[];
  UpdatedAt?: string;
  Cloud?: boolean;
  Internal?: boolean;
}

/** Response-item types that represent a tool invocation rather than chat text. */
const TOOL_ITEMS = new Set([
  'function_call',
  'custom_tool_call',
  'local_shell_call',
  'tool_search_call',
  'web_search_call',
  'mcp_tool_call',
]);

/** User-role messages that are machine injected context, not something the human typed. */
function isInjectedUserText(text: string): boolean {
  const head = text.trimStart().slice(0, 80);
  return (
    head.startsWith('<environment_context') ||
    head.startsWith('<user_instructions') ||
    head.startsWith('<codex_apps_client_time_context') ||
    head.startsWith('# AGENTS.md instructions')
  );
}

function walk(dir: string, ext: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(ext)) out.push(full);
    }
  }
  return out;
}

function readJsonl(file: string): any[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (typeof c === 'string') return c;
        if (c && typeof c.text === 'string') return c.text;
        if (c && typeof c.content === 'string') return c.content;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function truncate(value: unknown, n = 80): string {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function toIso(ms: number | null | undefined): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

/** Timestamps arrive as ISO strings (jsonl) or epoch ms (sqlite); normalise to ms. */
export function timestampOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function laterIso(current: string | null | undefined, candidate: string | null | undefined): string | null {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

function earlierIso(current: string | null | undefined, candidate: string | null | undefined): string | null {
  if (!candidate) return current ?? null;
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

/** Build a compact, single-line description of a tool call's arguments. */
function toolDetail(payload: any): string {
  const args = payload?.arguments ?? payload?.input ?? payload?.query ?? '';
  let text = '';
  if (typeof args === 'string') {
    try {
      const parsed = JSON.parse(args);
      text = parsed.cmd || parsed.command || parsed.path || parsed.query || parsed.prompt || args;
    } catch {
      text = args;
    }
  } else if (args && typeof args === 'object') {
    text = args.cmd || args.command || args.path || args.query || JSON.stringify(args);
  }
  if (typeof text !== 'string') text = JSON.stringify(text);
  const collapsed = text.replace(/\r/g, '').trim();
  return collapsed.length > 2000 ? `${collapsed.slice(0, 2000)}\n…` : collapsed;
}

function codexScan(lines: any[]): Scan {
  const scan = emptyScan();
  for (const line of lines) {
    if (line.type === 'turn_context' && line.payload?.model) scan.model = line.payload.model;
    if (line.type === 'event_msg' && line.payload?.type === 'token_count') {
      const info = line.payload.info;
      const total = info?.total_token_usage;
      if (total) {
        scan.tokenIn = Number(total.input_tokens ?? 0);
        scan.tokenOut = Number(total.output_tokens ?? 0);
      }
      const last = info?.last_token_usage;
      if (last) scan.contextTokens = Number(last.input_tokens ?? 0);
      if (typeof info?.model_context_window === 'number') scan.contextWindow = info.model_context_window;
    }
    if (line.type === 'response_item' && TOOL_ITEMS.has(line.payload?.type)) scan.tools += 1;
  }
  return scan;
}

function claudeScan(lines: any[]): Scan {
  const scan = emptyScan();
  let outputTokens = 0;
  for (const line of lines) {
    const message = line.message;
    if (!message) continue;
    if (message.model) scan.model = message.model;
    const usage = message.usage;
    if (usage) {
      // Input tokens are per-request context sizes; the last one is the real footprint.
      const input = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0);
      if (input > 0) scan.tokenIn = input;
      outputTokens += Number(usage.output_tokens ?? 0);
    }
    if (Array.isArray(message.content)) {
      scan.tools += message.content.filter((block: any) => block?.type === 'tool_use').length;
    }
    if (line.type === 'user' && message.role === 'user') scan.startedAt = earlierIso(scan.startedAt, line.timestamp);
  }
  if (outputTokens > 0) scan.tokenOut = outputTokens;
  return scan;
}

export class RealSessionStore {
  constructor(private readonly homeDir?: string) {}

  private home(): string {
    return this.homeDir || os.homedir();
  }

  list(kind: AgentKind): RealSession[] {
    switch (kind) {
      case 'claude':
        return this.listClaude();
      case 'codex':
        return this.listCodex();
      case 'pi':
        return this.listPi();
      case 'opencode':
        return this.listOpencode();
      case 'workbuddy':
        return this.listWorkbuddy();
      case 'dsh':
        return this.listDsh();
      case 'antigravity':
        return this.listAntigravity();
      default:
        return [];
    }
  }

  read(kind: AgentKind, id: string): SessionEvent[] {
    switch (kind) {
      case 'claude':
        return this.readClaude(id);
      case 'codex':
        return this.readCodex(id);
      case 'pi':
        return this.readPi(id);
      case 'opencode':
        return this.readOpencode(id);
      case 'workbuddy':
        return this.readWorkbuddy(id);
      case 'dsh':
        return this.readDsh(id);
      case 'antigravity':
        return this.readAntigravity(id);
      default:
        return [];
    }
  }

  private listClaude(): RealSession[] {
    const out: RealSession[] = [];
    for (const file of walk(path.join(this.home(), '.claude', 'projects'), '.jsonl')) {
      const lines = readJsonl(file);
      let cwd = '';
      let title = '';
      let msgs = 0;
      let updated = '';
      let started = '';
      for (const l of lines) {
        if (l.cwd) cwd = l.cwd;
        if (l.timestamp) {
          if (l.timestamp > updated) updated = l.timestamp;
          if (!started || l.timestamp < started) started = l.timestamp;
        }
        if (l.type === 'user' && l.message?.role === 'user') {
          msgs++;
          if (!title) title = textOf(l.message.content);
        } else if (l.type === 'assistant' && l.message?.role === 'assistant') {
          msgs++;
        }
      }
      const scan = claudeScan(lines);
      out.push({
        id: path.basename(file, '.jsonl'),
        title: truncate(title) || '(no title)',
        project: cwd,
        updated: updated || null,
        msgs,
        kind: 'claude',
        path: file,
        startedAt: started || null,
        model: scan.model,
        tools: scan.tools,
        tokenIn: scan.tokenIn,
        tokenOut: scan.tokenOut,
      });
    }
    return out;
  }

  private listCodex(): RealSession[] {
    const index: any[] = readJsonl(path.join(this.home(), '.codex', 'session_index.jsonl')).map((l) => ({
      id: l.id,
      title: l.thread_name,
      updated: l.updated_at,
    }));
    const merged = new Map<string, RealSession>();
    for (const file of walk(path.join(this.home(), '.codex', 'sessions'), '.jsonl')) {
      const lines = readJsonl(file);
      const meta = lines.find((l) => l.type === 'session_meta');
      const id = meta?.payload?.session_id || meta?.payload?.id || path.basename(file, '.jsonl');
      let title = '';
      let msgs = 0;
      let updated = '';
      let started = '';
      for (const l of lines) {
        if (l.timestamp) {
          if (l.timestamp > updated) updated = l.timestamp;
          if (!started || l.timestamp < started) started = l.timestamp;
        }
        if (l.type === 'response_item' && l.payload?.role === 'user') {
          msgs++;
          if (!title) {
            const text = textOf(l.payload.content);
            if (!isInjectedUserText(text)) title = text;
          }
        } else if (l.type === 'response_item' && l.payload?.role === 'assistant') {
          const text = textOf(l.payload.content).trim();
          if (text) msgs++;
        }
      }
      const scan = codexScan(lines);
      const idx = index.find((x) => x.id === id);
      const existing = merged.get(id);
      if (!existing) {
        merged.set(id, {
          id,
          title: idx?.title || truncate(title) || '(no title)',
          project: meta?.payload?.cwd || '',
          // The index can lag behind the transcript, so keep whichever timestamp is newer.
          updated: laterIso(idx?.updated ?? null, updated || null),
          msgs,
          kind: 'codex',
          path: file,
          startedAt: started || meta?.payload?.timestamp || null,
          model: scan.model,
          tools: scan.tools,
          tokenIn: scan.tokenIn,
          tokenOut: scan.tokenOut,
          contextTokens: scan.contextTokens,
          contextWindow: scan.contextWindow,
        });
      } else {
        existing.msgs = Math.max(existing.msgs ?? 0, msgs);
        existing.tools = Math.max(existing.tools ?? 0, scan.tools);
        existing.tokenIn = Math.max(existing.tokenIn ?? 0, scan.tokenIn ?? 0) || null;
        existing.tokenOut = Math.max(existing.tokenOut ?? 0, scan.tokenOut ?? 0) || null;
        existing.contextTokens = Math.max(existing.contextTokens ?? 0, scan.contextTokens ?? 0) || null;
        existing.contextWindow = Math.max(existing.contextWindow ?? 0, scan.contextWindow ?? 0) || null;
        existing.model = existing.model || scan.model;
        existing.startedAt = earlierIso(existing.startedAt, started);
        existing.updated = laterIso(existing.updated, idx?.updated || updated);
      }
    }
    return [...merged.values()];
  }

  private listPi(): RealSession[] {
    const out: RealSession[] = [];
    for (const file of walk(path.join(this.home(), '.pi', 'agent', 'sessions'), '.jsonl')) {
      const lines = readJsonl(file);
      let id = '';
      let cwd = '';
      let title = '';
      let msgs = 0;
      let updated = '';
      let started = '';
      for (const l of lines) {
        if (l.timestamp) {
          if (l.timestamp > updated) updated = l.timestamp;
          if (!started || l.timestamp < started) started = l.timestamp;
        }
        if (l.type === 'session') {
          id = l.id;
          if (l.cwd) cwd = l.cwd;
        }
        if (l.type === 'message' && l.message?.role === 'user') {
          msgs++;
          if (!title) title = textOf(l.message.content) || textOf(l.message.sections?.preamble);
        } else if (l.type === 'message' && l.message?.role === 'assistant') {
          msgs++;
        }
      }
      out.push({
        id: id || path.basename(file, '.jsonl'),
        title: truncate(title) || '(no title)',
        project: cwd,
        updated: updated || null,
        msgs,
        kind: 'pi',
        path: file,
        startedAt: started || null,
      });
    }
    return out;
  }

  private listOpencode(): RealSession[] {
    const dbPath = path.join(this.home(), '.local', 'share', 'opencode', 'opencode.db');
    if (!fs.existsSync(dbPath)) return [];
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: { name: string }) => row.name));
      const sessions = new Map<string, RealSession>();
      // 桌面端迁移后会保留旧表，优先使用同 ID 的 V2 记录和原始标题。
      for (const storage of ['v1', 'v2'] as const) {
        const sessionTable = storage === 'v2' ? 'session_v2' : 'session';
        const messageTable = storage === 'v2' ? 'session_message' : 'message';
        if (!tables.has(sessionTable)) continue;
        const counts = new Map<string, number>();
        if (tables.has(messageTable)) {
          for (const row of db.prepare(`SELECT session_id, count(*) c FROM ${messageTable} GROUP BY session_id`).all()) counts.set(row.session_id, row.c);
        }
        for (const row of db.prepare(`SELECT id, title, directory, time_created, time_updated FROM ${sessionTable}`).all()) {
          sessions.set(row.id, {
            id: row.id, kind: 'opencode', opencodeStorage: storage, openTitle: row.title || undefined,
            title: truncate(row.title) || '(no title)', project: row.directory || '',
            updated: toIso(row.time_updated), msgs: counts.get(row.id) || 0, startedAt: toIso(row.time_created),
          });
        }
      }
      return [...sessions.values()];
    } finally {
      db.close();
    }
  }

  private listWorkbuddy(): RealSession[] {
    const dbPath = path.join(this.home(), '.workbuddy', 'workbuddy.db');
    if (!fs.existsSync(dbPath)) return [];
    // 桌面客户端仍可写入会话库，工作台仅以只读方式访问。
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare('SELECT id, title, cwd, created_at, updated_at FROM sessions').all();
      return rows.map((row: any) => ({
        id: row.id,
        title: truncate(row.title) || '(no title)',
        project: row.cwd || '',
        updated: toIso(row.updated_at),
        msgs: null,
        kind: 'workbuddy',
        startedAt: toIso(row.created_at),
      }));
    } finally {
      db.close();
    }
  }

  private dshRecords(file: string): any[] {
    try {
      const maxOutputLength = 64 * 1024 * 1024;
      // 优先使用 Node 内置解压，旧版 Node 仍可调用 PATH 中的 zstd。
      const output = typeof zlib.zstdDecompressSync === 'function'
        ? zlib.zstdDecompressSync(fs.readFileSync(file), { maxOutputLength }).toString('utf8')
        : execFileSync('zstd', ['-d', '-c', '--', file], { encoding: 'utf8', maxBuffer: maxOutputLength, timeout: 15000, windowsHide: true });
      return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
    } catch {
      return [];
    }
  }

  private listDsh(): RealSession[] {
    const files = walk(path.join(this.home(), '.dsh', 'sessions'), '.zstd');
    return files.flatMap((file) => {
      const records = this.dshRecords(file);
      const meta = records.find((record) => record.type === 'session');
      if (!meta?.id) return [];
      const messages = records.filter((record) => record.type === 'user/message' || record.type === 'assistant/message');
      const firstUser = messages.find((record) => record.type === 'user/message');
      const lastTime = messages.reduce((latest, record) => Math.max(latest, timestampOf(record.time)), 0);
      const startedAt = toIso(timestampOf(meta.createdAt));
      return [{ id: String(meta.id), title: truncate(textOf(firstUser?.data?.content)) || '(no title)', project: meta.cwd || '', updated: toIso(lastTime) || startedAt, startedAt, msgs: messages.length, kind: 'dsh' as const, path: file }];
    });
  }

  private readDsh(id: string): SessionEvent[] {
    const file = walk(path.join(this.home(), '.dsh', 'sessions'), '.zstd').find((candidate) => path.basename(path.dirname(candidate)) === id);
    if (!file) return [];
    return this.dshRecords(file).flatMap((record) => {
      const role = record.type === 'user/message' ? 'user' : record.type === 'assistant/message' ? 'assistant' : '';
      if (!role) return [];
      const content = role === 'user' ? record.data?.content : record.data?.message?.content;
      const text = textOf(Array.isArray(content) ? content.filter((block: any) => block?.type === 'text') : content).trim();
      return text ? [{ ts: timestampOf(record.time), type: 'output' as const, data: `${role}: ${text}` }] : [];
    });
  }

  private antigravityDirectory(origin: 'desktop' | 'cli'): string {
    return path.join(this.home(), '.gemini', origin === 'desktop' ? 'antigravity' : 'antigravity-cli');
  }

  private antigravityTranscript(root: string, id: string): SessionEvent[] {
    const file = path.join(root, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    try {
      return readJsonl(file).flatMap((record) => {
        const role = record.type === 'USER_INPUT' ? 'user'
          : ['PLANNER_RESPONSE', 'ASSISTANT_RESPONSE'].includes(record.type) ? 'assistant' : '';
        const text = role && textOf(record.content).trim();
        return text ? [{ ts: timestampOf(record.created_at), type: 'output' as const, data: `${role}: ${text}` }] : [];
      });
    } catch {
      return [];
    }
  }

  private antigravitySummaries(root: string): Record<string, { summary?: AntigravitySummary; is_internal?: boolean; last_modified_time?: string }> {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'cache', 'conversation_metadata.json'), 'utf8')).conversations ?? {};
    } catch {
      return {};
    }
  }

  private listAntigravity(): RealSession[] {
    const sessions = new Map<string, RealSession>();
    const cached = (['desktop', 'cli'] as const).flatMap((origin) => {
      const root = this.antigravityDirectory(origin);
      return Object.entries(this.antigravitySummaries(root)).map(([id, entry]) => ({ id, entry, root }));
    });
    for (const origin of ['desktop', 'cli'] as const) {
      const root = this.antigravityDirectory(origin);
      // CLI 的 Other 列表也会缓存桌面记录，来源以元数据指向的本机目录为准。
      const metadata = Object.fromEntries(cached.filter(({ entry, root: cacheRoot }) => {
        const storedRoot = entry?.summary?.AppDataDir;
        const sourceRoot = typeof storedRoot === 'string' && path.isAbsolute(storedRoot) ? storedRoot : cacheRoot;
        return path.resolve(sourceRoot).toLowerCase() === path.resolve(root).toLowerCase();
      }).map(({ id, entry }) => [id, entry]));
      const directory = path.join(root, 'conversations');
      const databases = fs.existsSync(directory)
        ? fs.readdirSync(directory).filter((name) => name.endsWith('.db')).map((name) => name.slice(0, -3)) : [];
      for (const id of new Set([...databases, ...Object.keys(metadata)])) {
        if (!ANTIGRAVITY_ID.test(id)) continue;
        const entry = metadata[id];
        const summary = entry?.summary;
        if (entry?.is_internal || summary?.Internal || summary?.Cloud) continue;
        const previous = sessions.get(id);
        const events = this.antigravityTranscript(root, id);
        const firstUser = events.find((event) => event.data.startsWith('user: '));
        const lastEvent = events.at(-1);
        const uri = Array.isArray(summary?.WorkspaceURIs) ? summary.WorkspaceURIs[0] : undefined;
        let project = '';
        if (typeof uri === 'string') {
          try { project = uri.startsWith('file:') ? fileURLToPath(uri) : path.isAbsolute(uri) ? uri : ''; } catch {}
        }
        if (!project && firstUser?.data) {
          const match = firstUser.data.match(/Workspace directory:\s*([^\r\n(]+)/i);
          const candidate = match?.[1]?.trim();
          if (candidate && path.isAbsolute(candidate)) project = candidate;
        }
        const modified = fs.statSync(path.join(directory, `${id}.db`), { throwIfNoEntry: false })?.mtimeMs;
        const nativeTitle = typeof summary?.Title === 'string' ? summary.Title.trim() : '';
        const openTitle = nativeTitle || firstUser?.data.slice(6).split(/\r?\n/, 1)[0]?.trim() || previous?.openTitle;
        sessions.set(id, {
          id, kind: 'antigravity', antigravityOrigins: [...(previous?.antigravityOrigins ?? []), origin],
          openTitle,
          project: project || previous?.project || '',
          title: truncate(summary?.Title || firstUser?.data.slice(6) || summary?.Preview) || previous?.title || `Antigravity · ${id.slice(0, 8)}`,
          updated: toIso(timestampOf(summary?.UpdatedAt || entry?.last_modified_time)) || toIso(lastEvent?.ts || modified) || previous?.updated || null,
          startedAt: toIso(events[0]?.ts) || previous?.startedAt,
          msgs: events.length || previous?.msgs || null,
        });
      }
    }
    return [...sessions.values()];
  }

  private readAntigravity(id: string): SessionEvent[] {
    if (!ANTIGRAVITY_ID.test(id)) return [];
    for (const origin of ['cli', 'desktop'] as const) {
      const root = this.antigravityDirectory(origin);
      const events = this.antigravityTranscript(root, id);
      if (events.length) return events;
    }
    return [];
  }

  private readWorkbuddy(id: string): SessionEvent[] {
    const file = walk(path.join(this.home(), '.workbuddy', 'projects'), '.jsonl')
      .find((candidate) => path.basename(candidate, '.jsonl') === id);
    if (!file) return [];
    let records: ReturnType<typeof readJsonl>;
    try {
      records = readJsonl(file);
    } catch {
      return [];
    }
    return records.flatMap((record) => {
      if (record.type !== 'message' || (record.role !== 'user' && record.role !== 'assistant')) return [];
      const text = textOf(record.content);
      return text.trim() ? [{ ts: timestampOf(record.timestamp), type: 'output' as const, data: `${record.role}: ${text}` }] : [];
    });
  }

  private readClaude(id: string): SessionEvent[] {
    const file = walk(path.join(this.home(), '.claude', 'projects'), '.jsonl').find((f) => path.basename(f, '.jsonl') === id);
    if (!file) return [];
    const events: SessionEvent[] = [];
    for (const l of readJsonl(file)) {
      if (l.type !== 'user' && l.type !== 'assistant') continue;
      const role = l.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const ts = timestampOf(l.timestamp) || Date.now();
      const blocks = Array.isArray(l.message.content) ? l.message.content : [];
      const text = textOf(l.message.content).trim();
      if (text) events.push({ ts, type: 'output', data: `${role}: ${text}` });
      for (const block of blocks) {
        if (block?.type === 'tool_use') {
          events.push({ ts, type: 'tool', name: String(block.name || 'tool'), data: toolDetail({ input: block.input }) });
        }
      }
    }
    return events;
  }

  private readCodex(id: string): SessionEvent[] {
    // One logical session can span several rollout files (resumes write a new one),
    // so read every match and stitch them back into a single timeline.
    const files = walk(path.join(this.home(), '.codex', 'sessions'), '.jsonl').filter((f) => path.basename(f).includes(id));
    if (files.length === 0) return [];
    const perFile = files.map((file) => this.readCodexFile(file)).sort((left, right) => right.length - left.length);
    const primary = perFile[0];
    const lastTs = primary.reduce((max, event) => Math.max(max, event.ts), 0);
    const continuation = perFile.slice(1).flat().filter((event) => event.ts > lastTs);
    return [...primary, ...continuation].sort((left, right) => left.ts - right.ts);
  }

  private readCodexFile(file: string): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (const l of readJsonl(file)) {
      if (l.type !== 'response_item' || !l.payload) continue;
      const payload = l.payload;
      const ts = timestampOf(l.timestamp) || Date.now();
      if (payload.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
        const text = textOf(payload.content).trim();
        if (!text) continue;
        // Drop harness-injected context so the timeline only shows the real dialogue.
        if (payload.role === 'user' && isInjectedUserText(text)) continue;
        events.push({ ts, type: 'output', data: `${payload.role}: ${text}` });
        continue;
      }
      if (TOOL_ITEMS.has(payload.type)) {
        events.push({ ts, type: 'tool', name: String(payload.name || payload.type), data: toolDetail(payload) });
      }
    }
    return events;
  }

  private readPi(id: string): SessionEvent[] {
    const file = walk(path.join(this.home(), '.pi', 'agent', 'sessions'), '.jsonl').find((f) => f.includes(id));
    if (!file) return [];
    return readJsonl(file)
      .filter((l) => l.type === 'message' && (l.message?.role === 'user' || l.message?.role === 'assistant'))
      .map((l) => ({
        ts: timestampOf(l.timestamp) || Date.now(),
        type: 'output' as const,
        data: `${l.message.role}: ${textOf(l.message.content)}`,
      }));
  }

  private readOpencode(id: string): SessionEvent[] {
    const dbPath = path.join(this.home(), '.local', 'share', 'opencode', 'opencode.db');
    if (!fs.existsSync(dbPath)) return [];
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: { name: string }) => row.name));
      if (tables.has('session_v2') && tables.has('session_message') && db.prepare('SELECT 1 FROM session_v2 WHERE id = ?').get(id)) {
        return db.prepare('SELECT type, data, time_created FROM session_message WHERE session_id = ? ORDER BY seq').all(id).flatMap((row: any) => {
          if (row.type !== 'user' && row.type !== 'assistant') return [];
          try {
            const data = JSON.parse(row.data);
            const text = textOf(data.text ?? data.content).trim();
            return text ? [{ ts: row.time_created, type: 'output' as const, data: `${row.type}: ${text}` }] : [];
          } catch { return []; }
        });
      }
      if (!tables.has('message') || !tables.has('part')) return [];
      const parts = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY time_created, id');
      return db.prepare('SELECT id, data, time_created FROM message WHERE session_id = ? ORDER BY time_created, id').all(id).flatMap((row: any) => {
        try {
          const { role } = JSON.parse(row.data);
          if (role !== 'user' && role !== 'assistant') return [];
          const text = parts.all(row.id).flatMap((part: any) => {
            try {
              const value = JSON.parse(part.data);
              return value.type === 'text' && typeof value.text === 'string' ? [value.text] : [];
            } catch { return []; }
          }).join('\n').trim();
          return text ? [{ ts: row.time_created, type: 'output' as const, data: `${role}: ${text}` }] : [];
        } catch { return []; }
      });
    } finally {
      db.close();
    }
  }
}
