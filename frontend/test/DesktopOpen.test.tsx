import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { App } from '../src/App';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(async () => [
    { id: 'codex', kind: 'codex', name: 'Codex' },
    { id: 'dsh', kind: 'dsh', name: 'DeepSeek Harness' },
    { id: 'opencode', kind: 'opencode', name: 'OpenCode' },
    { id: 'antigravity', kind: 'antigravity', name: 'Antigravity' },
  ]),
  agentSessions: vi.fn(async (agent: { kind: string }) => {
    const common = { project: 'E:/project', msgs: 1, updated: null };
    switch (agent.kind) {
      case 'dsh': return [{ ...common, id: '33333333-3333-4333-8333-333333333333', kind: 'dsh', title: 'DSH session' }];
      case 'opencode': return [{ ...common, id: 'ses_123', kind: 'opencode', title: 'OpenCode session', openTitle: 'Full OpenCode session title', opencodeStorage: 'v2' }];
      case 'antigravity': return [
        { ...common, id: '11111111-1111-4111-8111-111111111111', kind: 'antigravity', title: 'Antigravity session', antigravityOrigins: ['desktop'] },
        { ...common, id: '22222222-2222-4222-8222-222222222222', kind: 'antigravity', title: 'Native CLI session', antigravityOrigins: ['cli'] },
      ];
      default: return [{ ...common, id: 'one', kind: 'codex', title: 'Example session' }];
    }
  }),
  sessionEvents: vi.fn(async () => []),
  resumeCodex: vi.fn(async () => {}),
  adopt: vi.fn(async () => {}),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('../src/api', () => ({ createClient: () => api }));

it('browses without resuming and opens the selected session only on request', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async () => {});
  window.workbenchDesktop = { openSession };
  render(<App />);
  fireEvent.click(await screen.findByText('Example session'));
  await waitFor(() => expect(api.sessionEvents).toHaveBeenCalledWith('one', undefined, 'codex'));
  expect(api.resumeCodex).not.toHaveBeenCalled();
  expect(api.adopt).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox', { name: '发送到会话' })).not.toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Codex' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('codex', 'one', 'E:/project'));
  delete window.workbenchDesktop;
});

it('opens a DSH session through the desktop bridge', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async () => {});
  window.workbenchDesktop = { openSession };
  render(<App />);
  fireEvent.click(await screen.findByText('DSH session'));
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'DeepSeek Harness' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('dsh', '33333333-3333-4333-8333-333333333333', 'E:/project'));
  delete window.workbenchDesktop;
});

it('refreshes OpenCode installation detection on focus and forwards both launch modes', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async () => {});
  const options = [
    { mode: 'desktop' as const, available: false },
    { mode: 'cli' as const, available: true },
  ];
  const openOptions = vi.fn(async () => options);
  window.workbenchDesktop = { openOptions, openSession };
  render(<App />);
  fireEvent.click(await screen.findByText('OpenCode session'));
  expect(await screen.findByRole('button', { name: 'Desktop' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'CLI' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('opencode', 'ses_123', 'E:/project', 'cli', { title: 'Full OpenCode session title', origin: undefined, opencodeStorage: 'v2' }));
  options[0]!.available = true;
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Desktop' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('opencode', 'ses_123', 'E:/project', 'desktop', { title: 'Full OpenCode session title', origin: undefined, opencodeStorage: 'v2' }));
  delete window.workbenchDesktop;
});

it('opens native Antigravity desktop sessions and keeps CLI import available', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async (_kind, _id, _project, mode) => mode === 'desktop' ? '已定位到桌面会话' : '使用 /resume 导入桌面会话');
  window.workbenchDesktop = {
    openSession,
    openOptions: async () => [{ mode: 'desktop', available: true }, { mode: 'cli', available: true }],
  };
  render(<App />);
  fireEvent.click(await screen.findByText('Antigravity session'));
  fireEvent.click(await screen.findByRole('button', { name: 'Desktop' }));
  expect(await screen.findByText('已定位到桌面会话')).toBeInTheDocument();
  expect(openSession).toHaveBeenCalledWith('antigravity', '11111111-1111-4111-8111-111111111111', 'E:/project', 'desktop', { title: 'Antigravity session', origin: 'desktop' });
  fireEvent.click(await screen.findByRole('button', { name: 'CLI 导入' }));
  expect(await screen.findByText('使用 /resume 导入桌面会话')).toBeInTheDocument();
  expect(openSession).toHaveBeenCalledWith('antigravity', '11111111-1111-4111-8111-111111111111', 'E:/project', 'cli', { title: 'Antigravity session', origin: 'desktop' });
  delete window.workbenchDesktop;
});

it('shows Desktop and CLI open buttons for Codex sessions and forwards CLI launch', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async () => {});
  window.workbenchDesktop = {
    openSession,
    openOptions: async () => [{ mode: 'desktop', available: true }, { mode: 'cli', available: true }],
  };
  render(<App />);
  fireEvent.click(await screen.findByText('Example session'));
  expect(await screen.findByRole('button', { name: 'Desktop' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'CLI' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('codex', 'one', 'E:/project', 'cli', { title: 'Example session', origin: undefined }));
  delete window.workbenchDesktop;
});

it('identifies CLI-only Antigravity sessions and routes them to exact CLI continuation', async () => {
  window.history.replaceState(null, '', '/');
  const openSession = vi.fn(async () => {});
  window.workbenchDesktop = {
    openSession,
    openOptions: async (_kind, details) => [{ mode: 'desktop', available: details?.origin !== 'cli' }, { mode: 'cli', available: true }],
  };
  render(<App />);
  fireEvent.click(await screen.findByText('Native CLI session'));
  expect(await screen.findByRole('button', { name: 'Desktop' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'CLI' }));
  await waitFor(() => expect(openSession).toHaveBeenCalledWith('antigravity', '22222222-2222-4222-8222-222222222222', 'E:/project', 'cli', { title: 'Native CLI session', origin: 'cli' }));
  delete window.workbenchDesktop;
});
