import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '../src/components/ThemeToggle';

it('toggles from dark to light', () => {
  const onChange = vi.fn();
  render(<ThemeToggle theme="dark" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /theme/i }));
  expect(onChange).toHaveBeenCalledWith('light');
});

it('toggles from light to dark', () => {
  const onChange = vi.fn();
  render(<ThemeToggle theme="light" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: /theme/i }));
  expect(onChange).toHaveBeenCalledWith('dark');
});
