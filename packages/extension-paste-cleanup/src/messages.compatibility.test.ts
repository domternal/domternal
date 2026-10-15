import { expect, it } from 'vitest';
import { I18nService } from '@domternal/core';
import type { CompleteMessages } from '@domternal/core';
import { deMessages } from './locales/de.js';
import { pasteCleanupMessages } from './messages.js';

it('accepts an existing complete paste catalog and falls back for the additive removal message', () => {
  const { 'pasteCleanup.diagnostic.destinationFormattingRemoved': removed, ...previous } = deMessages;
  const compatible: CompleteMessages<typeof pasteCleanupMessages> = previous;
  expect(removed).toBeDefined();
  expect(compatible['pasteCleanup.diagnostic.destinationFormattingRemoved']).toBeUndefined();
  expect(pasteCleanupMessages.destinationFormattingRemoved.optionalTranslation).toBe(true);
  const i18n = new I18nService({ locale: 'de', messages: compatible });
  expect(i18n.t(pasteCleanupMessages.destinationFormattingRemoved)).toBe(pasteCleanupMessages.destinationFormattingRemoved.defaultValue);
  i18n.set({ locale: 'de', messages: deMessages });
  expect(i18n.t(pasteCleanupMessages.destinationFormattingRemoved)).toBe(removed);
  i18n.destroy();
});
