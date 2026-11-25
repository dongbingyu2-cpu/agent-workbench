import { it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskWorkspace } from '../src/components/TaskWorkspace';

it('shows the workspace path, entries, and SHARED.md', async () => {
  const client = {
    taskWorkspace: async () => ({
      path: 'C:/ws/t1',
      entries: [
        { name: 'parts', dir: true },
        { name: 'SHARED.md', dir: false },
      ],
      shared: 'background text',
    }),
  } as any;
  render(<TaskWorkspace client={client} taskId="t1" />);
  await waitFor(() => screen.getByText('background text'));
  expect(screen.getByText(/parts/)).toBeInTheDocument();
  expect(screen.getByText('C:/ws/t1')).toBeInTheDocument();
});
