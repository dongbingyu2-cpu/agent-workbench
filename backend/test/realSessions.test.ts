import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { RealSessionStore } from '../src/agents/realSessions';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

describe('RealSessionStore', () => {
  it('uses the V2 record and full title when OpenCode Desktop has migrated an existing session', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const directory = join(home, '.local', 'share', 'opencode');
    mkdirSync(directory, { recursive: true });
    const db = new DatabaseSync(join(directory, 'opencode.db'));
    try {
      db.exec(`
        CREATE TABLE session (id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
        CREATE TABLE session_v2 (id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
        CREATE TABLE session_message (session_id TEXT, seq INTEGER, type TEXT, time_created INTEGER, data TEXT);
      `);
      db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('ses_migrated', 'Old title', home, 10, 20);
      db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run('ses_legacy', 'Legacy only', home, 10, 20);
      const fullTitle = 'Updated desktop title '.repeat(6).trim();
      db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?)').run('ses_migrated', fullTitle, home, 10, 30);
      db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?)').run('ses_migrated', 1, 'user', 11, JSON.stringify({ text: 'original user message' }));
      const store = new RealSessionStore(home);
      expect(store.list('opencode')).toMatchObject([
        { id: 'ses_migrated', opencodeStorage: 'v2', openTitle: fullTitle },
        { id: 'ses_legacy', opencodeStorage: 'v1' },
      ]);
      expect(store.read('opencode', 'ses_migrated')).toEqual([{ ts: 11, type: 'output', data: 'user: original user message' }]);
    } finally {
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps Antigravity desktop and CLI sessions distinct when CLI metadata includes desktop history', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const desktop = join(home, '.gemini', 'antigravity');
    const cli = join(home, '.gemini', 'antigravity-cli');
    const desktopId = '11111111-1111-4111-8111-111111111111';
    const cliId = '22222222-2222-4222-8222-222222222222';
    const logs = join(desktop, 'brain', desktopId, '.system_generated', 'logs');
    try {
      mkdirSync(logs, { recursive: true });
      mkdirSync(join(cli, 'cache'), { recursive: true });
      mkdirSync(join(cli, 'conversations'), { recursive: true });
      writeFileSync(join(cli, 'conversations', `${cliId}.db`), '');
      writeFileSync(join(logs, 'transcript.jsonl'), [
        JSON.stringify({ type: 'USER_INPUT', content: 'desktop request', created_at: '2026-11-25T08:24:00Z' }),
        JSON.stringify({ type: 'PLANNER_RESPONSE', content: [{ text: 'desktop reply' }], created_at: '2026-11-25T08:24:01Z' }),
        JSON.stringify({ type: 'GENERIC', content: 'tool output' }),
      ].join('\n'));
      writeFileSync(join(cli, 'cache', 'conversation_metadata.json'), JSON.stringify({
        conversations: {
          [desktopId]: { summary: { AppDataDir: desktop, Title: 'Desktop copy' } },
          [cliId]: { summary: { AppDataDir: cli, Title: 'CLI copy', WorkspaceURIs: [pathToFileURL(home).href] } },
        },
      }));
      const store = new RealSessionStore(home);
      expect(store.list('antigravity')).toMatchObject([
        { id: desktopId, kind: 'antigravity', title: 'Desktop copy', antigravityOrigins: ['desktop'], msgs: 2 },
        { id: cliId, kind: 'antigravity', title: 'CLI copy', antigravityOrigins: ['cli'], project: home },
      ]);
      expect(store.read('antigravity', desktopId).map((event) => event.data)).toEqual(['user: desktop request', 'assistant: desktop reply']);
      expect(store.read('antigravity', cliId)).toEqual([]);
      expect(store.read('antigravity', '../transcript')).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('infers workspace project from collaborative task prompt when Antigravity CLI metadata omits WorkspaceURIs', () => {
    const home = mkdtempSync(join(tmpdir(), 'real-sessions-agy-ws-'));
    const cli = join(home, '.gemini', 'antigravity-cli');
    const id = '33333333-3333-4333-8333-333333333333';
    try {
      mkdirSync(join(cli, 'conversations'), { recursive: true });
      mkdirSync(join(cli, 'brain', id, '.system_generated', 'logs'), { recursive: true });
      writeFileSync(join(cli, 'conversations', `${id}.db`), '');
      writeFileSync(
        join(cli, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl'),
        `${JSON.stringify({ type: 'USER_INPUT', content: 'You own the "Review" part.\nWorkspace directory: E:\\example workspace\\agt-test (do all your work inside this directory).', created_at: '2026-11-25T15:00:00Z' })}\n`,
      );
      const store = new RealSessionStore(home);
      expect(store.list('antigravity')).toMatchObject([
        { id, kind: 'antigravity', project: 'E:\\example workspace\\agt-test' },
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.skipIf(typeof zlib.zstdCompressSync !== 'function')('lists and reads native DeepSeek Harness transcripts without invoking zstd', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const sessionId = '33333333-3333-4333-8333-333333333333';
    const sessionDir = join(home, '.dsh', 'sessions', 'project', sessionId);
    try {
      mkdirSync(sessionDir, { recursive: true });
      const records = [
        { type: 'session', id: sessionId, cwd: 'C:/project', createdAt: 1000 },
        { type: 'user/message', time: 2000, data: { content: 'hello' } },
        { type: 'assistant/message', time: 3000, data: { message: { content: [{ type: 'text', text: 'hi' }] } } },
      ];
      writeFileSync(join(sessionDir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(records.map((record) => JSON.stringify(record)).join('\n')));

      const store = new RealSessionStore(home);
      expect(store.list('dsh')).toMatchObject([{ id: sessionId, title: 'hello', kind: 'dsh', msgs: 2 }]);
      expect(store.read('dsh', sessionId).map((event) => event.data)).toEqual(['user: hello', 'assistant: hi']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('lists WorkBuddy desktop sessions and reads only messages from the matching local transcript', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const root = join(home, '.workbuddy');
    const project = join(root, 'projects', 'example');
    mkdirSync(project, { recursive: true });
    const db = new DatabaseSync(join(root, 'workbuddy.db'));
    db.exec('CREATE TABLE sessions (id TEXT, title TEXT, cwd TEXT, created_at INTEGER, updated_at INTEGER)');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run('desk-id', 'Desktop chat', 'C:/project', 1, 2);
    db.close();
    writeFileSync(join(project, 'desk-id.jsonl'), [
      JSON.stringify({ type: 'message', role: 'user', timestamp: 1, content: [{ type: 'input_text', text: 'hello' }] }),
      JSON.stringify({ type: 'reasoning', text: 'skip' }),
      JSON.stringify({ type: 'message', role: 'assistant', timestamp: 2, content: [{ type: 'output_text', text: 'hi' }] }),
      '{incomplete',
    ].join('\n'));
    const store = new RealSessionStore(home);
    expect(store.list('workbuddy')).toMatchObject([{ id: 'desk-id', title: 'Desktop chat', kind: 'workbuddy' }]);
    expect(store.read('workbuddy', 'desk-id').map((event) => event.data)).toEqual(['user: hello', 'assistant: hi']);
    expect(store.read('workbuddy', 'desk')).toEqual([]);
  });
  it('lists and reads claude sessions from a home dir', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const proj = join(home, '.claude', 'projects', 'proj');
    mkdirSync(proj, { recursive: true });
    const file = join(proj, 'sess1.jsonl');
    writeFileSync(
      file,
      [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello there' }, cwd: 'C:/proj', timestamp: '2026-11-01T00:00:00Z' }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi!' }, cwd: 'C:/proj', timestamp: '2026-11-01T00:00:01Z' }),
      ].join('\n'),
    );
    const store = new RealSessionStore(home);
    const list = store.list('claude');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'sess1', kind: 'claude', title: 'hello there', project: 'C:/proj', msgs: 2 });
    const events = store.read('claude', 'sess1');
    expect(events.map((e) => e.data)).toEqual(['user: hello there', 'assistant: hi!']);
  });

  it('reads codex transcripts with stats, tool calls and resumed files', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'));
    const dir = join(home, '.codex', 'sessions', '2026', '11', '23');
    mkdirSync(dir, { recursive: true });
    const base = join(dir, 'rollout-2026-11-23T10-00-00-abc.jsonl');
    writeFileSync(
      base,
      [
        JSON.stringify({ timestamp: '2026-11-23T02:00:00.000Z', type: 'session_meta', payload: { session_id: 'abc', cwd: 'E:/proj' } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:05.000Z', type: 'turn_context', payload: { model: 'gpt-test' } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:06.000Z', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ text: 'ignore me' }] } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:07.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'hello codex' }] } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:08.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"dir"}' } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:09.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: 'done' }] } }),
        JSON.stringify({ timestamp: '2026-11-23T02:00:10.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 340 }, last_token_usage: { input_tokens: 800, output_tokens: 120 }, model_context_window: 128000 } } }),
      ].join('\n'),
    );
    const resumed = join(dir, 'rollout-2026-11-23T11-00-00-abc_def.jsonl');
    writeFileSync(
      resumed,
      [
        JSON.stringify({ timestamp: '2026-11-23T03:00:00.000Z', type: 'session_meta', payload: { session_id: 'def', cwd: 'E:/proj' } }),
        JSON.stringify({ timestamp: '2026-11-23T03:00:01.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'second turn' }] } }),
      ].join('\n'),
    );

    const store = new RealSessionStore(home);
    const listed = store.list('codex').find((session) => session.id === 'abc');
    expect(listed).toMatchObject({ msgs: 2, tools: 1, model: 'gpt-test', tokenIn: 1200, tokenOut: 340, contextTokens: 800, contextWindow: 128000 });
    expect(listed?.startedAt).toBe('2026-11-23T02:00:00.000Z');
    expect(listed?.updated).toBe('2026-11-23T02:00:10.000Z');

    const events = store.read('codex', 'abc');
    expect(events.map((event) => (event.type === 'tool' ? `tool:${event.name}` : event.data.split(':')[0]))).toEqual([
      'user',
      'tool:exec_command',
      'assistant',
      'user',
    ]);
    expect(events[1]).toMatchObject({ type: 'tool', name: 'exec_command', data: 'dir' });
  });
});
