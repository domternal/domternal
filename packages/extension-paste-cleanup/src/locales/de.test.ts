import { describe, expect, it } from 'vitest';
import { I18nService } from '@domternal/core';
import { pasteCleanupMessages } from '../messages.js';
import { deMessages, deSearchAliases } from './de.js';

describe('German paste cleanup language pack', () => {
  it('covers exactly the owned messages with frozen values and no insertion aliases', () => {
    expect(Object.keys(deMessages).sort()).toEqual(Object.values(pasteCleanupMessages)
      .map(definition => definition.id).sort());
    expect(Object.keys(deSearchAliases)).toEqual([]);
    expect(Object.isFrozen(deMessages)).toBe(true);
    expect(Object.isFrozen(deSearchAliases)).toBe(true);
    expect(Reflect.set(deMessages, 'unexpected.message', 'Unexpected')).toBe(false);
    expect(Reflect.set(deSearchAliases, 'unexpected.message', ['Unexpected'])).toBe(false);
  });

  it('resolves every feedback and diagnostic message as German', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages, searchAliases: deSearchAliases });
    for (const definition of Object.values(pasteCleanupMessages)) {
      const text = deMessages[definition.id];
      expect(typeof text).toBe('string');
      if (typeof text !== 'string') throw new Error('Expected a static German message');
      expect(text.trim().length).toBeGreaterThan(0);
      expect(i18n.resolve({ ...definition })).toEqual({ text, language: 'de', source: 'messages' });
    }
    i18n.destroy();
  });

  it('requires explicit opt in and preserves English fallback independently', () => {
    const english = new I18nService();
    const german = new I18nService({ locale: 'de', messages: deMessages });
    expect(german.t(pasteCleanupMessages.label)).toBe('Hinweis zum Einfügen');
    expect(english.resolve(pasteCleanupMessages.label)).toEqual({
      text: 'Paste notice', language: 'en', source: 'default',
    });
    german.set({ locale: 'de' });
    expect(german.resolve(pasteCleanupMessages.label)).toEqual({
      text: 'Paste notice', language: 'en', source: 'default',
    });
    english.destroy();
    german.destroy();
  });
});
