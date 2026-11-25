import { describe, expect, it, vi } from 'vitest';
import { CodexAppServer } from '../src/agents/codexAppServer';

describe('Codex model settings', () => {
  it('loads all model pages and forwards settings with each turn', async () => {
    const server = new CodexAppServer();
    const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === 'model/list') return params.cursor ? { data: [{ model: 'second' }], nextCursor: null } : { data: [{ model: 'first' }], nextCursor: 'next' };
      if (method === 'turn/start') return { turn: { id: 'turn-1' } };
      return {};
    });
    (server as any).ready = async () => {};
    (server as any).request = request;
    expect(await server.listModels()).toEqual([{ model: 'first' }, { model: 'second' }]);
    await server.send('thread-1', 'hello', { model: 'first', effort: 'high' });
    expect(request).toHaveBeenCalledWith('turn/start', {
      threadId: 'thread-1', input: [{ type: 'text', text: 'hello' }], model: 'first', effort: 'high',
    });
  });
});
