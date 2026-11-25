import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SplitPlanDialog } from '../src/components/SplitPlanDialog';

it('calls onConfirm with edited drafts only after Confirm', async () => {
  const onConfirm = vi.fn();
  render(<SplitPlanDialog drafts={[{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }]} onConfirm={onConfirm} onCancel={() => {}} />);
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
  expect(onConfirm).toHaveBeenCalledWith([{ title: 'A', description: 'do a', suggestedAgentId: 'a1' }]);
});
