import { describe, expect, it } from 'vitest';
import { I18nService } from '@domternal/core';
import { blockControlsMessages } from '../messages.js';
import { deMessages, deSearchAliases } from './de.js';

const { heading, backgroundSwatch, textSwatch, ...staticMessages } = blockControlsMessages;

describe('German block-controls language pack', () => {
  it('covers exactly the owned message and searchable catalogs with frozen values', () => {
    const definitions = Object.values(blockControlsMessages);
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
    expect(german.t(blockControlsMessages.addBlock)).toBe('Block darunter hinzufügen');
    expect(english.resolve(blockControlsMessages.addBlock)).toEqual({
      text: 'Add block below', language: 'en', source: 'default',
    });
    german.set({ locale: 'de' });
    expect(german.resolve(blockControlsMessages.addBlock)).toEqual({
      text: 'Add block below', language: 'en', source: 'default',
    });
    english.destroy();
    german.destroy();
  });

  it('formats heading levels through the service and preserves caller color values', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages });
    expect(i18n.resolve(heading, { level: 2 })).toEqual({
      text: 'Überschrift 2', language: 'de', source: 'messages',
    });
    const color = '<b>Brand blue</b> / var(--brand)';
    expect(i18n.t(backgroundSwatch, { color })).toBe(`Hintergrundfarbe: ${color}`);
    expect(i18n.t(textSwatch, { color })).toBe(`Textfarbe: ${color}`);
    i18n.set({ locale: 'de', messages: deMessages, formatters: { number: value => `[${String(value)}]` } });
    expect(i18n.t(heading, { level: 3 })).toBe('Überschrift [3]');
    i18n.destroy();
  });
});
