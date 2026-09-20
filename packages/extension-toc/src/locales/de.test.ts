import { describe, expect, it } from 'vitest';
import { I18nService } from '@domternal/core';
import { tocMessages } from '../messages.js';
import { deMessages, deSearchAliases } from './de.js';

const { headingFallback, headingLabel, ...staticMessages } = tocMessages;

describe('German toc language pack', () => {
  it('covers exactly the owned message and searchable catalogs with frozen values', () => {
    const definitions = Object.values(tocMessages);
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
    expect(german.t(tocMessages.insert)).toBe('Inhaltsverzeichnis');
    expect(english.resolve(tocMessages.insert)).toEqual({
      text: 'Table of contents', language: 'en', source: 'default',
    });
    german.set({ locale: 'de' });
    expect(german.resolve(tocMessages.insert)).toEqual({
      text: 'Table of contents', language: 'en', source: 'default',
    });
    english.destroy();
    german.destroy();
  });

  it('preserves authored heading text and formats levels through the service', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages });
    const label = '<b>Résumé & 日本語</b>';
    expect(i18n.resolve(headingFallback, { level: 2 })).toEqual({
      text: 'Überschrift der Ebene 2', language: 'de', source: 'messages',
    });
    expect(i18n.resolve(headingLabel, { label, level: 3 })).toEqual({
      text: `${label} (Überschrift 3)`, language: 'de', source: 'messages',
    });
    i18n.set({ locale: 'de', messages: deMessages, formatters: { number: value => `[${String(value)}]` } });
    expect(i18n.t(headingFallback, { level: 2 })).toBe('Überschrift der Ebene [2]');
    expect(i18n.t(headingLabel, { label, level: 3 })).toBe(`${label} (Überschrift [3])`);
    i18n.destroy();
  });
});
