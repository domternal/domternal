import type { I18nOptions } from '@domternal/core';
import * as coreGerman from '@domternal/core/locales/de';
import * as blockControlsGerman from '@domternal/extension-block-controls/locales/de';
import * as detailsGerman from '@domternal/extension-details/locales/de';
import * as emojiGerman from '@domternal/extension-emoji/locales/de';
import * as imageGerman from '@domternal/extension-image/locales/de';
import * as mathGerman from '@domternal/extension-math/locales/de';
import * as mentionGerman from '@domternal/extension-mention/locales/de';
import * as tableGerman from '@domternal/extension-table/locales/de';
import * as tocGerman from '@domternal/extension-toc/locales/de';

export type DemoLanguage = 'en' | 'de';

/** Stable options let every demo editor share the selected UI language. */
export const DEMO_I18N: Readonly<Record<DemoLanguage, I18nOptions>> = Object.freeze({
  en: Object.freeze({ locale: 'en' }),
  de: Object.freeze({
    locale: 'de',
    messages: Object.freeze({
      ...coreGerman.deMessages,
      ...blockControlsGerman.deMessages,
      ...detailsGerman.deMessages,
      ...emojiGerman.deMessages,
      ...imageGerman.deMessages,
      ...mathGerman.deMessages,
      ...mentionGerman.deMessages,
      ...tableGerman.deMessages,
      ...tocGerman.deMessages,
    }),
    searchAliases: Object.freeze({
      ...coreGerman.deSearchAliases,
      ...blockControlsGerman.deSearchAliases,
      ...detailsGerman.deSearchAliases,
      ...emojiGerman.deSearchAliases,
      ...imageGerman.deSearchAliases,
      ...mathGerman.deSearchAliases,
      ...mentionGerman.deSearchAliases,
      ...tableGerman.deSearchAliases,
      ...tocGerman.deSearchAliases,
    }),
  }),
});
