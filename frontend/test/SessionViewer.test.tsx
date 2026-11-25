import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionViewer } from '../src/components/SessionViewer';

it('renders the events of the selected agent session', async () => {
  const client = { listSessions: async () => ([{ ts: 1, type: 'output', data: 'hello from history' }]) } as any;
  render(<SessionViewer client={client} agentId="a1" />);
  await waitFor(() => screen.getByText('hello from history'));
  expect(screen.getByText('hello from history')).toBeInTheDocument();
});
