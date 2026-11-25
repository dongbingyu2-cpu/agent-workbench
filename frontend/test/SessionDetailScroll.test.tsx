import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionDetail } from '../src/components/SessionDetail';

it('keeps the reading position until the reader returns to the bottom', () => {
  const props = {
    session: { kind: 'codex' as const, id: 'one', title: 'test', project: '', updated: null, msgs: 0 },
    entries: [], loading: false, tab: 'all' as const, connected: true, connecting: false, input: '',
    onTab: vi.fn(), onRetry: vi.fn(), onInput: vi.fn(), onSend: vi.fn(), onInterrupt: vi.fn(),
  };
  const { container, rerender } = render(<SessionDetail {...props} output="" />);
  const panel = container.querySelector<HTMLDivElement>('.conversation')!;
  let height = 1000;
  Object.defineProperties(panel, { clientHeight: { value: 200 }, scrollHeight: { get: () => height } });
  panel.scrollTop = 120;
  fireEvent.scroll(panel);
  height += 200;
  rerender(<SessionDetail {...props} output="first" />);
  expect(panel.scrollTop).toBe(120);
  panel.scrollTop = height - 200;
  fireEvent.scroll(panel);
  height += 200;
  rerender(<SessionDetail {...props} output="first then second" />);
  expect(panel.scrollTop).toBeGreaterThanOrEqual(height - 200);
});
