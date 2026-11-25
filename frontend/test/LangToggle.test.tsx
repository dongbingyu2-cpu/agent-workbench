import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LangToggle } from '../src/components/LangToggle';

it('switches zh to en', () => {
  const onChange = vi.fn();
  render(<LangToggle lang="zh" onChange={onChange} />);
  fireEvent.click(screen.getByText('EN'));
  expect(onChange).toHaveBeenCalledWith('en');
});

it('switches en to zh', () => {
  const onChange = vi.fn();
  render(<LangToggle lang="en" onChange={onChange} />);
  fireEvent.click(screen.getByText('中文'));
  expect(onChange).toHaveBeenCalledWith('zh');
});
