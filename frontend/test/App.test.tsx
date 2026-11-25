import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(async () => [{ id: 'codex', kind: 'codex', name: 'Codex' }]),
  agentSessions: vi.fn(async () => [{ id: 'one', kind: 'codex', title: 'Example session', project: 'E:/project', msgs: 1, updated: null }]),
  sessionEvents: vi.fn(async () => []),
  adopt: vi.fn(async () => {}),
  input: vi.fn(async (_id: string, _data: string) => {}),
  resumeCodex: vi.fn(async (_id: string) => {}),
  listCodexModels: vi.fn(async () => [{ id: 'm1', model: 'model-1', displayName: 'Model One', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' }, { reasoningEffort: 'high', description: '' }] }]),
  agentModels: vi.fn(async (_kind: string) => [{ id: 'magpie/auto', label: 'Auto · magpie' }]),
  sendCodex: vi.fn(async (_id: string, _text: string, _options?: { model?: string; effort?: string }) => {}),
  stopAgent: vi.fn(async () => {}),
  interruptCodex: vi.fn(async (_id: string) => {}),
  deleteTask: vi.fn(async () => {}),
  taskDirs: vi.fn(async () => []),
  taskLiveSessions: vi.fn(async () => []),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../src/api', () => ({ createClient: () => api }));

describe('session selection', () => {
  it('loads sessions with numeric and string timestamps', async () => {
    window.history.replaceState(null, '', '/');
    api.agentSessions.mockResolvedValueOnce([
      { id: 'numeric', kind: 'codex', title: 'Numeric timestamp', project: 'E:/project', msgs: 0, updated: 1794447410742 },
      { id: 'iso', kind: 'codex', title: 'ISO timestamp', project: 'E:/project', msgs: 0, updated: '2026-11-01T00:00:00Z' },
    ] as any);
    render(<App />);
    expect(await screen.findByText('Numeric timestamp')).toBeInTheDocument();
    expect(screen.getByText('ISO timestamp')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens a WorkBuddy transcript as read-only', async () => {
    window.history.replaceState(null, '', '/');
    api.adopt.mockClear();
    api.subscribe.mockClear();
    api.listAgents.mockResolvedValueOnce([{ id: 'workbuddy', kind: 'workbuddy', name: 'WorkBuddy' }]);
    api.agentSessions.mockResolvedValueOnce([{ id: 'desktop-1', kind: 'workbuddy', title: 'Desktop transcript', project: 'E:/project', msgs: 1, updated: null }]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Desktop transcript/ }));
    await waitFor(() => expect(api.sessionEvents).toHaveBeenCalledWith('desktop-1', undefined, 'workbuddy'));
    expect(screen.queryByRole('textbox', { name: '发送到会话' })).not.toBeInTheDocument();
    expect(api.adopt).not.toHaveBeenCalled();
    expect(api.subscribe).not.toHaveBeenCalled();
  });

  it('shows the open-in-client button for a selected session without auto-resuming', async () => {
    window.history.replaceState(null, '', '/');
    window.workbenchDesktop = { openSession: vi.fn(async () => {}) } as any;
    api.resumeCodex.mockClear();
    render(<App />);
    fireEvent.click(await screen.findByText('Example session'));
    await waitFor(() => expect(api.sessionEvents).toHaveBeenCalledWith('one', undefined, 'codex'));
    expect(api.resumeCodex).not.toHaveBeenCalled();
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '发送到会话' })).not.toBeInTheDocument();
    delete window.workbenchDesktop;
  });
});
