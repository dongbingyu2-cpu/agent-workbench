import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CollapsibleText } from '../src/components/CollapsibleText';

describe('CollapsibleText', () => {
  it('collapses long text and allows expanding and collapsing', () => {
    render(<CollapsibleText text={`${'a'.repeat(1200)} THE END`} />);
    expect(screen.queryByText(/THE END/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开全文' }));
    expect(screen.getByText(/THE END/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText(/THE END/)).not.toBeInTheDocument();
  });

  it('does not show a toggle for short text', () => {
    render(<CollapsibleText text="short" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the latest terminal output when collapsed', () => {
    render(<CollapsibleText terminal text={`BEGIN ${'a'.repeat(1200)} END`} />);
    expect(screen.getByText(/END/)).toBeInTheDocument();
    expect(screen.queryByText(/BEGIN/)).not.toBeInTheDocument();
  });
});
