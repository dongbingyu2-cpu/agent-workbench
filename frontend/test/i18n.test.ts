import { describe, it, expect, beforeEach } from 'vitest';
import { translate, getStoredLang, applyLang, statusKey } from '../src/i18n';

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
  });

  it('translates in both languages', () => {
    expect(translate('en', 'adopt')).toBe('Adopt');
    expect(translate('zh', 'adopt')).toBe('接管');
  });

  it('maps a status to its key', () => {
    expect(statusKey('running')).toBe('status_running');
    expect(translate('zh', statusKey('running'))).toBe('运行中');
  });

  it('defaults to en when nothing is stored and navigator is en', () => {
    expect(getStoredLang()).toBe('en');
  });

  it('persists and applies a language', () => {
    applyLang('zh');
    expect(localStorage.getItem('aw-lang')).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(getStoredLang()).toBe('zh');
  });
});
