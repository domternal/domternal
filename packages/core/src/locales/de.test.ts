import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { I18nService } from '../i18n/I18nService.js';
import { coreMessages } from '../messages/core.js';
import { deMessages, deSearchAliases } from './de.js';

const { colorTextSwatch, colorBackgroundSwatch, emojiItemName, headingLevel, ...staticMessages } = coreMessages;

describe('German core messages', () => {
  it('covers exactly the owned catalog and freezes all shared translation data', () => {
    expect(Object.keys(deMessages).sort()).toEqual(Object.values(coreMessages).map(({ id }) => id).sort());
    expect(Object.isFrozen(deMessages)).toBe(true);
    expect(Object.isFrozen(deSearchAliases)).toBe(true);
    for (const value of Object.values(deMessages)) {
      if (typeof value === 'string') expect(value.trim()).not.toBe('');
    }
    for (const aliases of Object.values(deSearchAliases)) {
      expect(Object.isFrozen(aliases)).toBe(true);
      expect(new Set(aliases).size).toBe(aliases.length);
    }
  });

  it('resolves every static label from the German catalog without falling back', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages });
    try {
      for (const definition of Object.values(staticMessages)) {
        const value = deMessages[definition.id];
        expect(typeof value).toBe('string');
        expect(i18n.resolve({ ...definition })).toEqual({
          text: value, source: 'messages', language: 'de',
        });
      }
    } finally { i18n.destroy(); }
  });

  it('formats heading levels through the application formatter and preserves caller values', () => {
    const i18n = new I18nService({
      locale: 'de-DE', messages: deMessages,
      formatters: { number: (value) => `[${String(value)}]` },
    });
    try {
      expect(i18n.t(headingLevel, { level: 2 })).toBe('Überschrift [2]');
      expect(i18n.t(colorTextSwatch, { color: 'Brand #AABBCC' })).toBe('Textfarbe: Brand #AABBCC');
      expect(i18n.t(colorBackgroundSwatch, { color: 'Brand #AABBCC' })).toBe('Hintergrundfarbe: Brand #AABBCC');
      expect(i18n.t(emojiItemName, { name: 'custom_face' })).toBe('custom face');
    } finally { i18n.destroy(); }
  });

  it('keeps German discovery terms and technical aliases together', () => {
    const i18n = new I18nService({ locale: 'de', messages: deMessages, searchAliases: deSearchAliases });
    try {
      expect(i18n.getSearchAliases(coreMessages.headingLevel)).toEqual(
        expect.arrayContaining(['überschrift', 'ueberschrift', 'titel', 'heading', 'title'])
      );
      expect(i18n.getSearchAliases(coreMessages.bold)).toEqual(['fett', 'fettdruck', 'bold']);
    } finally { i18n.destroy(); }
  });

  it('allows an application override without changing the shared catalog or another editor', () => {
    const first = new I18nService({ locale: 'de', messages: { ...deMessages, 'core.toolbar.bold': 'Fettdruck' } });
    const second = new I18nService({ locale: 'de', messages: deMessages });
    try {
      expect(first.t(coreMessages.bold)).toBe('Fettdruck');
      expect(second.t(coreMessages.bold)).toBe('Fett');
      expect(deMessages['core.toolbar.bold']).toBe('Fett');
      first.set({ locale: 'de' });
      expect(first.resolve(coreMessages.bold)).toEqual({ text: 'Bold', source: 'default', language: 'en' });
    } finally { first.destroy(); second.destroy(); }
  });

  it('switches the actual editor to German and back without changing its document state', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Original English content</p>' });
    try {
      const state = editor.state;
      const transaction = vi.fn();
      editor.on('transaction', transaction);
      editor.i18n.set({ locale: 'de', messages: deMessages, searchAliases: deSearchAliases });
      expect(editor.toolbarItems.find(({ name }) => name === 'bold')).toMatchObject({ label: 'Fett', labelLanguage: 'de' });
      expect(editor.floatingMenuItems.find(({ name }) => name === 'heading-1')).toMatchObject({
        label: 'Überschrift 1', keywords: expect.arrayContaining(['überschrift', 'heading', 'h1']),
      });
      expect(editor.state).toBe(state);
      expect(editor.state.doc.textContent).toBe('Original English content');
      editor.i18n.set({});
      expect(editor.toolbarItems.find(({ name }) => name === 'bold')).toMatchObject({ label: 'Bold', labelLanguage: 'en' });
      expect(editor.state).toBe(state);
      expect(transaction).not.toHaveBeenCalled();
    } finally { editor.destroy(); }
  });
});
