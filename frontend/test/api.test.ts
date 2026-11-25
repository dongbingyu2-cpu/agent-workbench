import { describe, it, expect, vi } from 'vitest';
import { createClient } from '../src/api';

describe('createClient', () => {
  it('creates a task with POST /api/tasks', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ id: 't1' }) })) as any;
    const c = createClient('http://127.0.0.1:4177', fetchImpl);
    await c.createTask('T', 'bg');
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:4177/api/tasks', expect.objectContaining({ method: 'POST' }));
  });

  it('routes Codex resume, message and interrupt requests to the app-server API', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })) as any;
    const c = createClient('', fetchImpl);
    await c.resumeCodex('thread/one');
    await c.sendCodex('thread/one', 'hello');
    await c.interruptCodex('thread/one');
    expect(fetchImpl.mock.calls.map(([url, options]: [string, RequestInit]) => [url, options.method, options.body])).toEqual([
      ['/api/codex/sessions/thread%2Fone/resume', 'POST', undefined],
      ['/api/codex/sessions/thread%2Fone/input', 'POST', JSON.stringify({ text: 'hello' })],
      ['/api/codex/sessions/thread%2Fone/interrupt', 'POST', undefined],
    ]);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toBeUndefined();
  });
});

it('uses same-origin relative URLs when no base is given', async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => [] })) as any;
  const c = createClient('', fetchImpl);
  await c.listAgents();
  expect(fetchImpl).toHaveBeenCalledWith('/api/agents', expect.objectContaining({ method: 'GET' }));
});
