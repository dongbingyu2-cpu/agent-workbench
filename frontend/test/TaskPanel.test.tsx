import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { TaskPanel } from '../src/components/TaskPanel';

const agents = [
  { id: 'c', name: 'c', kind: 'claude', command: 'claude', cwd: '', status: 'discovered', managed: false },
  { id: 'o', name: 'o', kind: 'opencode', command: 'opencode', cwd: '', status: 'discovered', managed: false },
  { id: 'w', name: 'w', kind: 'workbuddy', command: 'workbuddy', cwd: '', status: 'discovered', managed: false },
  { id: 'd', name: 'd', kind: 'dsh', command: 'dsh', cwd: '', status: 'discovered', managed: false },
] as any;

function makeProps(overrides: Partial<Parameters<typeof TaskPanel>[0]> = {}) {
  return {
    agents,
    tasks: [] as any[],
    task: null,
    title: 'T',
    description: 'bg',
    workspacePath: '',
    parts: [{ title: 'A', description: 'a', agentId: '', model: '', phase: 'coding' as const, dependsOn: '' }],
    progress: [] as any[],
    liveSessions: [] as any[],
    onTitle: vi.fn(),
    onDescription: vi.fn(),
    onWorkspacePath: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
    onParts: vi.fn(),
    onStart: vi.fn(),
    onOpenTask: vi.fn(),
    onJumpSession: vi.fn(),
    onLiveSessions: vi.fn(),
    onOpenAgent: vi.fn(),
    ...overrides,
  };
}

it('offers WorkBuddy and DeepSeek Harness as assignable agents', () => {
  const task = { id: 't', title: 'T', description: 'bg', workspacePath: '', status: 'planned', parts: [] } as any;
  render(<TaskPanel {...makeProps({ task })} />);
  const selects = screen.getAllByRole('combobox');
  expect(selects.length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('option', { name: /WorkBuddy/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /DeepSeek Harness/ })).toBeInTheDocument();
});

it('renders unified agent-style composer with all CLI leader options and native folder picker', async () => {
  const onWorkspacePath = vi.fn();
  const onCreate = vi.fn();
  const pickDirectory = vi.fn(async () => 'D:/MyNewProject');
  window.workbenchDesktop = { openSession: vi.fn(async () => {}), pickDirectory };
  try {
    render(<TaskPanel {...makeProps({ task: null, agents: [], onWorkspacePath, onCreate })} />);

    expect(screen.getByRole('textbox', { name: '任务描述' })).toBeInTheDocument();
    const leaderSelect = screen.getByRole('combobox', { name: '选择 leader 智能体' });
    expect(leaderSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'pi' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Antigravity' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择工作区' }));
    await waitFor(() => expect(pickDirectory).toHaveBeenCalledTimes(1));
    expect(onWorkspacePath).toHaveBeenCalledWith('D:/MyNewProject');

    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  } finally {
    delete window.workbenchDesktop;
  }
});

it('loads models for the selected part agent into a dropdown without manual text input', async () => {
  const onLoadModels = vi.fn(async () => [
    { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
    { id: 'o4-mini', label: 'o4-mini' },
  ]);
  const task = { id: 't', title: 'T', description: 'bg', workspacePath: '', status: 'planned', parts: [] } as any;
  const parts = [{ title: 'Part 1', description: 'desc 1', agentId: 'c', model: '', phase: 'coding' as const, dependsOn: '' }];
  render(<TaskPanel {...makeProps({ task, parts, onLoadModels })} />);

  await waitFor(() => expect(onLoadModels).toHaveBeenCalledWith('claude'));
  const modelSelect = screen.getByRole('combobox', { name: '分工1模型' });
  expect(modelSelect).toBeEnabled();
  expect(screen.getByRole('option', { name: 'GPT-5 Codex' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'o4-mini' })).toBeInTheDocument();
});

it('allows dispatching when two parts share the same agent', () => {
  const task = { id: 't', title: 'T', description: 'bg', workspacePath: '', status: 'planned', parts: [] } as any;
  const parts = [
    { title: 'Part 1', description: 'desc 1', agentId: 'c', model: '', phase: 'coding' as const, dependsOn: '' },
    { title: 'Part 2', description: 'desc 2', agentId: 'c', model: 'sonnet', phase: 'review' as const, dependsOn: 'Part 1' },
  ];
  const onStart = vi.fn();
  render(<TaskPanel {...makeProps({ task, parts, onStart })} />);
  const dispatchBtn = screen.getByRole('button', { name: /确认并派发/ });
  expect(dispatchBtn).toBeEnabled();
  fireEvent.click(dispatchBtn);
  expect(onStart).toHaveBeenCalledTimes(1);
});

it('lets a completed task submit the next requirement and retains the draft on failure', async () => {
  const onFollowUp = vi.fn<(taskId: string, note: string, round: number) => Promise<void>>()
    .mockRejectedValueOnce(new Error('追加未保存'))
    .mockResolvedValueOnce(undefined);
  const task = { id: 't', title: 'Example', description: 'Initial work', workspacePath: '', status: 'done', parts: [], round: 2 } as const;
  render(<TaskPanel {...makeProps({ task: { ...task, parts: [] }, onFollowUp })} />);
  const prompt = screen.getByRole('textbox', { name: '追加任务要求' });
  const submit = screen.getByRole('button', { name: '开始下一轮' });
  expect(submit).toBeDisabled();
  fireEvent.change(prompt, { target: { value: ' Add a review ' } });
  fireEvent.click(submit);
  expect(await screen.findByText('追加未保存')).toBeInTheDocument();
  expect(prompt).toHaveValue(' Add a review ');
  fireEvent.keyDown(prompt, { key: 'Enter' });
  await waitFor(() => expect(onFollowUp).toHaveBeenCalledTimes(2));
  expect(onFollowUp).toHaveBeenLastCalledWith('t', 'Add a review', 2);
});

it('reflects live part progress in the overview and task tree', () => {
  const task = {
    id: 't1',
    title: '协同任务',
    description: '完成页面优化',
    workspacePath: 'E:/example workspace/workspace/t1',
    status: 'active',
    parts: [
      { id: 'p1', taskId: 't1', title: '前端重构', description: '重做卡片布局', assignedAgentId: 'c', status: 'pending', resultPath: 'E:/res1.md', doneMarker: 'E:/DONE' },
      { id: 'p2', taskId: 't1', title: '样式验证', description: '检查深浅主题', assignedAgentId: 'o', status: 'pending', resultPath: 'E:/res2.md', doneMarker: 'E:/DONE2', dependsOn: '前端重构' },
    ],
  } as any;
  const progress = [
    { partId: 'p1', status: 'done' as const, tail: '', result: '已完成前端卡片重构与深浅主题适配。', resultPath: 'E:/res1.md' },
    { partId: 'p2', status: 'running' as const, tail: 'checking styles...', resultPath: 'E:/res2.md' },
  ];
  render(<TaskPanel {...makeProps({ task, progress, summary: 'Leader 最终验收通过。' })} />);
  expect(screen.getAllByText('1/2 完成（50%）').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('已完成前端卡片重构与深浅主题适配。')).toBeInTheDocument();
  expect(screen.getByText('Leader 最终验收通过。')).toBeInTheDocument();
  expect(screen.getByText('checking styles...')).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /依赖树/ })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /执行输出/ })).toBeInTheDocument();
});

it('shows the workflow by round and keeps dependencies in a separate view', () => {
  const task = {
    id: 'example', title: '协作示例', description: '本轮检查页面', workspacePath: '', status: 'active',
    round: 2, previousRequirements: ['首轮搭建页面'],
    parts: [
      { id: 'first', taskId: 'example', title: '搭建页面', description: '实现界面', assignedAgentId: 'c', status: 'done', resultPath: '', doneMarker: '' },
      { id: 'second', taskId: 'example', title: '检查页面', description: '校验样式', assignedAgentId: 'o', status: 'pending', resultPath: '', doneMarker: '', round: 2 },
    ],
  } as const;
  const props = makeProps({
    task: { ...task, previousRequirements: [...task.previousRequirements], parts: [...task.parts] },
    progress: [
      { partId: 'first', status: 'done', tail: '', resultPath: '', result: '已搭建基本页面' },
      { partId: 'second', status: 'running', tail: '', resultPath: '' },
    ],
  });
  render(<TaskPanel {...props} />);

  fireEvent.click(screen.getByRole('tab', { name: '流程树' }));
  const flow = within(screen.getByRole('region', { name: '协作流程树' }));
  expect(flow.getByText('本轮检查页面')).toBeVisible();
  expect(flow.getByText('检查页面').closest('li')).toHaveTextContent('运行中');
  expect(flow.queryByText('首轮搭建页面')).not.toBeInTheDocument();
  const previous = flow.getByRole('button', { name: /第 1 轮/ });
  fireEvent.click(previous);
  expect(previous).toHaveAttribute('aria-expanded', 'true');
  expect(flow.getByText('首轮搭建页面')).toBeVisible();
  fireEvent.click(flow.getByText('搭建页面', { selector: 'summary' }));
  expect(flow.getByText('已搭建基本页面')).toBeVisible();

  fireEvent.click(screen.getByRole('tab', { name: /依赖树/ }));
  expect(screen.getByRole('heading', { name: '依赖树' })).toBeVisible();
  expect(screen.queryByRole('region', { name: '协作流程树' })).not.toBeInTheDocument();
});

it('shows the requirement and draft assignments in the workflow before dispatch', () => {
  const task = { id: 'example', title: '协作示例', description: '准备验证报告', workspacePath: '', status: 'planned', parts: [] } as const;
  render(<TaskPanel {...makeProps({
    task: { ...task, parts: [] },
    parts: [{ title: '测试界面', description: '检查布局', agentId: 'c', model: '', phase: 'test', dependsOn: '' }],
  })} />);
  fireEvent.click(screen.getByRole('tab', { name: '流程树' }));
  const flow = within(screen.getByRole('region', { name: '协作流程树' }));
  expect(flow.getByText('准备验证报告')).toBeVisible();
  expect(flow.getByRole('heading', { name: '分工方案' })).toBeVisible();
  expect(flow.getByText('测试界面').closest('li')).toHaveTextContent('待派发');
});

it('shows pause/cancel buttons for active tasks and resume/cancel for paused tasks', () => {
  const onPause = vi.fn();
  const onResume = vi.fn();
  const onCancel = vi.fn();
  const activeTask = { id: 't1', title: 'T', description: 'bg', workspacePath: '', status: 'active', parts: [] } as any;
  const { rerender } = render(<TaskPanel {...makeProps({ task: activeTask, onPause, onResume, onCancel })} />);

  fireEvent.click(screen.getByRole('button', { name: '暂停' }));
  expect(onPause).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: '取消任务' }));
  expect(onCancel).toHaveBeenCalledTimes(1);

  rerender(<TaskPanel {...makeProps({ task: { ...activeTask, status: 'paused' }, onPause, onResume, onCancel })} />);
  fireEvent.click(screen.getByRole('button', { name: '继续' }));
  expect(onResume).toHaveBeenCalledTimes(1);
});
