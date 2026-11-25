import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionDetail } from '../src/components/SessionDetail';

const props = {
  session: { kind: 'codex' as const, id: 'one', title: 't', project: '', updated: null, msgs: 4 },
  entries: [
    { role: 'user' as const, ts: 0, text: 'first prompt' },
    { role: 'assistant' as const, ts: 0, text: 'answer' },
    { role: 'user' as const, ts: 0, text: 'second prompt' },
    { role: 'user' as const, ts: 0, text: 'third prompt\nmore context' },
  ],
  loading: false,
  tab: 'all' as const,
  connected: true,
  connecting: false,
  input: '',
  onTab: vi.fn(),
  onRetry: vi.fn(),
  onInput: vi.fn(),
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
};

it('shows a preview and expands nearby ticks as the pointer moves', () => {
  render(<SessionDetail {...props} output="" />);
  const rail = screen.getByRole('navigation', { name: '用户对话导航' });
  const [first, second, third] = within(rail).getAllByRole('button');
  fireEvent.mouseEnter(first);
  expect(rail.querySelector('.minimap-preview')).toHaveTextContent('first promptanswer');
  expect(second).toHaveAttribute('data-distance', '1');

  fireEvent.mouseEnter(third);
  expect(rail.querySelector('.minimap-preview')).toHaveTextContent('third promptmore context');
  expect(first).toHaveAttribute('data-distance', '2');
  expect(third).toHaveAttribute('data-distance', '0');
  fireEvent.mouseLeave(rail);
  expect(rail.querySelector('.minimap-preview')).toBeNull();
});

it('previews a keyboard-focused tick, and clicks still jump to the user message', () => {
  const { container } = render(<SessionDetail {...props} output="" />);
  const rail = screen.getByRole('navigation', { name: '用户对话导航' });
  const second = within(rail).getByRole('button', { name: 'second prompt' });
  const scroller = container.querySelector<HTMLDivElement>('.conversation')!;
  const jump = vi.fn();
  scroller.scrollTo = jump;
  fireEvent.focus(second);
  expect(rail.querySelector('.minimap-preview')).toHaveTextContent('second prompt');
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(rail.querySelector('.minimap-preview')).toBeNull();
  fireEvent.click(second);
  expect(jump).toHaveBeenCalledOnce();
});

it('samples long conversations without losing the first or last prompt', () => {
  const entries = Array.from({ length: 120 }, (_, index) => ({ role: 'user' as const, ts: 0, text: `prompt ${index + 1}` }));
  render(<SessionDetail {...props} entries={entries} output="" />);
  const rail = screen.getByRole('navigation', { name: '用户对话导航' });
  const ticks = within(rail).getAllByRole('button');
  expect(ticks.length).toBeLessThan(entries.length);
  expect(ticks[0]).toHaveAccessibleName('prompt 1');
  expect(ticks.at(-1)).toHaveAccessibleName('prompt 120');
});
