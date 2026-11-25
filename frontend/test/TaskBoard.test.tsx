import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TaskBoard } from '../src/components/TaskBoard';

it('creates a task from the title input', async () => {
  const createTask = vi.fn(async () => ({ id: 't1', title: 'My Task', description: '', workspacePath: '', status: 'planned', parts: [] }));
  const client = { createTask, listTasks: async () => [] } as any;
  render(<TaskBoard client={client} />);
  fireEvent.change(screen.getByPlaceholderText(/task title/i), { target: { value: 'My Task' } });
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
  await waitFor(() => expect(createTask).toHaveBeenCalledWith('My Task', expect.any(String)));
});
