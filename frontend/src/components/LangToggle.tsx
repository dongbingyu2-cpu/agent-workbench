import type { Lang } from '../i18n';
import { useI18n } from '../lang';

export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useI18n();
  const next: Lang = lang === 'zh' ? 'en' : 'zh';
  return (
    <button type="button" className="btn btn-ghost" aria-label={t('switchLanguage')} onClick={() => onChange(next)}>
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
