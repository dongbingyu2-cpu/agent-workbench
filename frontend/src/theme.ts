export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'aw-theme';

export function getStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme;
  }
}
