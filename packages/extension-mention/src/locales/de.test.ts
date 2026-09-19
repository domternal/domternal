import { describe, expect, it } from 'vitest';
import { I18nService } from '@domternal/core';
import { mentionMessages } from '../messages.js';
import { deMessages, deSearchAliases } from './de.js';

const staticMessages = mentionMessages;

describe('German mention language pack', () => {
  it('covers exactly the owned message and searchable catalogs with frozen values', () => {
    const definitions = Object.values(mentionMessages);
    expect(Object.keys(deMessages).sort()).toEqual(definitions.map(definition => definition.id).sort());
    expect(Object.keys(deSearchAliases).sort()).toEqual(definitions
      .filter(definition => (definition.technicalAliases?.length ?? 0) > 0 || (definition.searchAliases?.length ?? 0) > 0)
      .map(definition => definition.id).sort());
    expect(Object.isFrozen(deMessages)).toBe(true);
    expect(Object.isFrozen(deSearchAliases)).toBe(true);
    for (const aliases of Object.values(deSearchAliases)) expect(Object.isFrozen(aliases)).toBe(true);
    expect(Reflect.set(deMessages, 'unexpected.message', 'Unexpected')).toBe(false);
    expect(Reflect.set(deSearchAliases, 'unexpected.message', ['Unexpected'])).toBe(false);
  });

  it('resolves every static message as German and retains technical search aliases', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages, searchAliases: deSearchAliases });
    const aliasesById = new Map<string, readonly string[]>(Object.entries(deSearchAliases));
    for (const definition of Object.values(staticMessages)) {
      const text = deMessages[definition.id];
      expect(typeof text).toBe('string');
      if (typeof text !== 'string') throw new Error('Expected a static German message');
      expect(text.trim().length).toBeGreaterThan(0);
      expect(i18n.resolve({ ...definition })).toEqual({ text, language: 'de', source: 'messages' });
      const aliases = aliasesById.get(definition.id);
      if (aliases) {
        expect(i18n.getSearchAliases({ ...definition })).toEqual([...new Set([
          ...aliases, ...(definition.technicalAliases ?? []),
        ])]);
      }
    }
    i18n.destroy();
  });

  it('requires explicit opt in and leaves other editor services in English', () => {
    const english = new I18nService();
    const german = new I18nService({ locale: 'de', messages: deMessages });
    expect(german.t(mentionMessages.suggestions)).toBe('Erwähnungsvorschläge');
    expect(english.resolve(mentionMessages.suggestions)).toEqual({
      text: 'Mention suggestions', language: 'en', source: 'default',
    });
    german.set({ locale: 'de' });
    expect(german.resolve(mentionMessages.suggestions)).toEqual({
      text: 'Mention suggestions', language: 'en', source: 'default',
    });
    english.destroy();
    german.destroy();
  });
});
