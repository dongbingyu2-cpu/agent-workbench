import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AgentConversations } from '../src/components/AgentConversations';

it('lists sessions and loads the first transcript', async () => {
  const client = {
    agentSessions: async () => [{ id: 's1abcd', kind: 'claude', title: 'demo conv', project: 'C:/x', updated: null, msgs: 1 }],
    sessionEvents: async () => [{ ts: 0, type: 'output', data: 'hello conv' }],
  } as any;
  const agent = { id: 'a1', name: 'x', kind: 'claude', command: 'claude', cwd: '', status: 'discovered', managed: false } as any;
  render(<AgentConversations client={client} agent={agent} />);
  await waitFor(() => screen.getByText('hello conv'));
  expect(screen.getByText('claude')).toBeInTheDocument();
  expect(screen.getByText('demo conv')).toBeInTheDocument();
});
