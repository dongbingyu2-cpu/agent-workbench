import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../src/App';

const api = vi.hoisted(() => ({
  listAgents: vi.fn(async () => [
    { id: 'kind:codex', name: 'codex', kind: 'codex', command: 'codex', cwd: 'E:/demo', status: 'discovered', managed: false },
    { id: 'kind:opencode', name: 'opencode', kind: 'opencode', command: 'opencode', cwd: 'E:/demo', status: 'discovered', managed: false },
  ]),
  agentSessions: vi.fn(async (agent: { kind: string }) => {
    if (agent.kind === 'codex') {
      return [{ id: 'c1', kind: 'codex', title: 'Codex 会话一', project: 'E:/demo', updated: '2026-11-25T10:00:00Z' }];
    }
    if (agent.kind === 'opencode') {
      return [{ id: 'o1', kind: 'opencode', title: 'OpenCode 会话二', project: 'E:/demo', updated: '2026-11-25T09:00:00Z' }];
    }
    return [];
  }),
  sessionEvents: vi.fn(async () => []),
  adopt: vi.fn(async () => {}),
  input: vi.fn(async () => {}),
  resumeCodex: vi.fn(async () => {}),
  listCodexModels: vi.fn(async () => []),
  agentModels: vi.fn(async () => []),
  sendCodex: vi.fn(async () => {}),
  stopAgent: vi.fn(async () => {}),
  interruptCodex: vi.fn(async () => {}),
  listTasks: vi.fn(async () => []),
  deleteTask: vi.fn(async () => {}),
  taskDirs: vi.fn(async () => []),
  taskLiveSessions: vi.fn(async () => []),
  subscribe: vi.fn(() => () => {}),
}));

vi.mock('../src/api', () => ({ createClient: () => api }));

describe('Settings modal, source toggles, archive & delete', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    cleanup();
  });

  it('places Settings button to the left of ThemeToggle and toggles agent source visibility', async () => {
    render(<App />);
    await screen.findByText('Codex 会话一');
    expect(screen.getByText('OpenCode 会话二')).toBeTruthy();

    const settingsBtn = screen.getByRole('button', { name: '设置' });
    const themeBtn = screen.getByRole('button', { name: /主题/ });
    expect(settingsBtn.compareDocumentPosition(themeBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(settingsBtn);
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const codexSwitch = within(dialog).getByRole('switch', { name: '显示 Codex 会话' });
    expect(codexSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(codexSwitch);
    expect(codexSwitch.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(screen.queryByText('Codex 会话一')).toBeNull();
    expect(screen.getByText('OpenCode 会话二')).toBeTruthy();

    // Re-open settings and turn Codex back on
    fireEvent.click(settingsBtn);
    const dialog2 = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog2).getByRole('switch', { name: '显示 Codex 会话' }));
    fireEvent.click(within(dialog2).getByRole('button', { name: '保存' }));
    expect(screen.getByText('Codex 会话一')).toBeTruthy();
  });

  it('deletes and archives sessions and restores them inside Settings modal', async () => {
    render(<App />);
    await screen.findByText('Codex 会话一');

    // Delete OpenCode session from the list
    const openCodeRow = screen.getByText('OpenCode 会话二').closest('.session-row') as HTMLElement;
    fireEvent.click(within(openCodeRow).getByRole('button', { name: '删除' }));
    expect(screen.queryByText('OpenCode 会话二')).toBeNull();

    // Archive Codex session from the list
    const codexRow = screen.getByText('Codex 会话一').closest('.session-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: '归档' }));
    expect(screen.queryByText('Codex 会话一')).toBeNull();

    // Open settings and verify both appear in 已归档 and 回收站
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const archivedSection = within(dialog).getByRole('heading', { name: '已归档' }).closest('section') as HTMLElement;
    const trashSection = within(dialog).getByRole('heading', { name: '回收站' }).closest('section') as HTMLElement;

    expect(within(archivedSection).getByText('Codex 会话一')).toBeTruthy();
    expect(within(trashSection).getByText('OpenCode 会话二')).toBeTruthy();

    // Restore both
    fireEvent.click(within(archivedSection).getByRole('button', { name: '恢复' }));
    fireEvent.click(within(trashSection).getByRole('button', { name: '恢复' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    expect(screen.getByText('Codex 会话一')).toBeTruthy();
    expect(screen.getByText('OpenCode 会话二')).toBeTruthy();
  });

  it('allows deleting archived sessions and archived workspaces inside Settings modal', async () => {
    render(<App />);
    await screen.findByText('Codex 会话一');

    // Archive Codex session, then delete it from Settings -> 已归档
    const codexRow = screen.getByText('Codex 会话一').closest('.session-row') as HTMLElement;
    fireEvent.click(within(codexRow).getByRole('button', { name: '归档' }));

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const archivedSection = within(dialog).getByRole('heading', { name: '已归档' }).closest('section') as HTMLElement;
    const trashSection = within(dialog).getByRole('heading', { name: '回收站' }).closest('section') as HTMLElement;

    expect(within(archivedSection).getByText('Codex 会话一')).toBeTruthy();
    fireEvent.click(within(archivedSection).getByRole('button', { name: '删除' }));

    expect(within(archivedSection).queryByText('Codex 会话一')).toBeNull();
    expect(within(trashSection).getByText('Codex 会话一')).toBeTruthy();
  });
});
