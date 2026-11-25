import { createContext, useContext, type ReactNode } from 'react';
import { translate, type Lang, type StringKey } from './i18n';

export interface I18n {
  lang: Lang;
  t: (key: StringKey) => string;
}

const fallback: I18n = { lang: 'en', t: (key) => translate('en', key) };
const LangContext = createContext<I18n>(fallback);

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value: I18n = { lang, t: (key) => translate(lang, key) };
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(LangContext);
}
