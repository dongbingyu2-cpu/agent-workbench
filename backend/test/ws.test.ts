import { describe, it, expect } from 'vitest';
import { EventHub } from '../src/api/events';

describe('EventHub', () => {
  it('delivers published messages to subscribers and unsubscribes', () => {
    const hub = new EventHub();
    const got: any[] = [];
    const off = hub.subscribe((m) => got.push(m));
    hub.publish({ type: 'agent-output', agentId: 'a1', chunk: 'hi' });
    off();
    hub.publish({ type: 'agent-output', agentId: 'a1', chunk: 'gone' });
    expect(got).toEqual([{ type: 'agent-output', agentId: 'a1', chunk: 'hi' }]);
  });
});
