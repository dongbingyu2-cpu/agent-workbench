import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTheme, applyTheme } from '../src/theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to light when nothing is stored', () => {
    expect(getStoredTheme()).toBe('light');
  });

  it('applies and persists a theme', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('aw-theme')).toBe('light');
    expect(getStoredTheme()).toBe('light');
  });
});
