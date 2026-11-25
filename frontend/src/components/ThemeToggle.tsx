import type { Theme } from '../theme';
import { useI18n } from '../lang';

export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const { t } = useI18n();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-label={t('theme')}
      title={t('theme')}
      onClick={() => onChange(next)}
    >
      <span aria-hidden="true">{theme === 'dark' ? '◐' : '◑'}</span> {t(next)}
    </button>
  );
}
