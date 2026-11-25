import { it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AgentList } from '../src/components/AgentList';

it('shows agents and disables adopt without a session id', async () => {
  const client = { listAgents: async () => ([{ id: 'a1', name: 'Claude #1', kind: 'claude', status: 'discovered', managed: false, sessionId: undefined }]) } as any;
  render(<AgentList client={client} />);
  await waitFor(() => screen.getByText('Claude #1'));
  expect(screen.getByRole('button', { name: /adopt/i })).toBeDisabled();
});

it('expands an agent to show its run directory', async () => {
  const client = {
    listAgents: async () => ([{ id: 'a1', name: 'Claude #1', kind: 'claude', cwd: 'C:/proj', status: 'discovered', managed: false }]),
    agentWorkspace: async () => ({ path: 'C:/proj', entries: [{ name: 'src', dir: true }, { name: 'README.md', dir: false }] }),
  } as any;
  render(<AgentList client={client} />);
  await waitFor(() => screen.getByText('Claude #1'));
  fireEvent.click(screen.getByText('Claude #1'));
  await waitFor(() => screen.getByText(/src/));
  expect(screen.getByText('C:/proj')).toBeInTheDocument();
});
