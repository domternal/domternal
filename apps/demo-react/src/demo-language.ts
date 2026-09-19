import { createContext, useContext } from 'react';
import type { I18nOptions } from '@domternal/core';

/** The demo shell owns language selection for existing and newly mounted editors. */
export const DemoI18nContext = createContext<I18nOptions>({ locale: 'en' });

export function useDemoI18n(): I18nOptions {
  return useContext(DemoI18nContext);
}
