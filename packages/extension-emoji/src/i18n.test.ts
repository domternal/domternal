import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Paragraph, Text, I18nService } from '@domternal/core';
import { Emoji } from './Emoji.js';
import type { EmojiItem } from './emojis.js';
import { createEmojiSuggestionRenderer } from './suggestionRenderer.js';
import type { SuggestionProps } from './suggestionPlugin.js';

const items: EmojiItem[] = [
  {
    emoji: '☀️',
    name: 'sun',
    shortcodes: ['sunny'],
    tags: ['weather'],
    group: 'Objects',
    searchAliases: ['zvijezda'],
  },
  {
    emoji: '⭐',
    name: 'star',
    shortcodes: ['star'],
    tags: ['night'],
    group: 'Objects',
    label: 'Custom star',
  },
];
const editors: Editor[] = [];
const dispose: (() => void)[] = [];
afterEach(() => {
  dispose.splice(0).forEach((callback) => {
    callback();
  });
  editors.splice(0).forEach((editor) => {
    editor.destroy();
  });
  document.querySelectorAll('.dm-emoji-suggestion').forEach((element) => {
    element.remove();
  });
});

describe('emoji localization', () => {
  it('preserves active autocomplete identity and does not rerun a custom query provider', () => {
    const renderer = createEmojiSuggestionRenderer()();
    const getItems = vi.fn(() => items);
    const editor = new Editor({
      extensions: [
        Document,
        Paragraph,
        Text,
        Emoji.configure({ emojis: items, suggestion: { items: getItems, render: () => renderer } }),
      ],
    });
    editors.push(editor);
    editor.view.dispatch(editor.state.tr.insertText(':s', 1));
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    const selected = document.querySelector<HTMLElement>('.dm-emoji-suggestion-item--selected');
    const first = document.querySelector<HTMLElement>('.dm-emoji-suggestion-item');
    const state = editor.state;
    getItems.mockClear();
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({
      locale: 'hr',
      messages: {
        'emoji.insert': 'Umetni emoji',
        'emoji.suggestion.label': 'Emoji prijedlozi',
        'core.emojiPicker.itemName': ({ name }) => `<b>${name === 'sun' ? 'Sunce' : name}</b>`,
      },
    });
    expect(editor.toolbarItems.find((item) => item.name === 'emoji')).toMatchObject({
      label: 'Umetni emoji',
      labelLanguage: 'hr',
    });
    expect(document.querySelector('.dm-emoji-suggestion-item--selected')).toBe(selected);
    expect(document.querySelector('.dm-emoji-suggestion-item')).toBe(first);
    expect(first?.querySelector('.dm-emoji-suggestion-name')?.textContent).toBe('<b>Sunce</b>');
    expect(first?.querySelector('b')).toBeNull();
    expect(selected?.querySelector('.dm-emoji-suggestion-name')?.textContent).toBe('Custom star');
    expect(document.querySelector('.dm-emoji-suggestion')?.getAttribute('aria-label')).toBe(
      'Emoji prijedlozi'
    );
    expect(getItems).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(editor.state).toBe(state);
    renderer.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(editor.getJSON().content?.[0]?.content?.[0]?.attrs?.['name']).toBe('star');
  });

  it('matches translated display names and explicit aliases without changing technical identities', () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, Emoji.configure({ emojis: items })],
    });
    editors.push(editor);
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.emojiPicker.itemName': ({ name }) => (name === 'sun' ? 'Sunce' : name) },
    });
    const storage = editor.storage['emoji'] as {
      searchEmoji: (query: string) => EmojiItem[];
      addFrequentlyUsed: (name: string) => void;
      getFrequentlyUsed: () => string[];
    };
    expect(storage.searchEmoji('sunny')[0]).toBe(items[0]);
    expect(storage.searchEmoji('Sunce')[0]).toBe(items[0]);
    expect(storage.searchEmoji('zvijezda')[0]).toBe(items[0]);
    expect(storage.searchEmoji('Custom star')[0]).toBe(items[1]);
    storage.addFrequentlyUsed('sun');
    editor.i18n.set();
    expect(storage.getFrequentlyUsed()).toEqual(['sun']);
    expect(items[0]?.shortcodes).toEqual(['sunny']);
  });

  it('supports standalone renderer context and cleans up its locale subscription', () => {
    const i18n = new I18nService();
    dispose.push(() => {
      i18n.destroy();
    });
    const renderer = createEmojiSuggestionRenderer()();
    dispose.push(() => {
      renderer.onExit();
    });
    const element = document.createElement('div');
    const props: SuggestionProps = {
      i18n,
      element,
      items: [],
      query: 'missing',
      range: { from: 1, to: 8 },
      command: () => undefined,
      clientRect: null,
    };
    renderer.onStart(props);
    const empty = document.querySelector<HTMLElement>('.dm-emoji-suggestion-empty');
    i18n.set({
      locale: 'hr',
      messages: { 'emoji.suggestion.empty': '<img src=x> Nema rezultata' },
    });
    expect(empty?.textContent).toBe('<img src=x> Nema rezultata');
    expect(empty?.lang).toBe('hr');
    expect(empty?.querySelector('img')).toBeNull();
    renderer.onExit();
    i18n.set();
    expect(empty?.textContent).toBe('<img src=x> Nema rezultata');
  });
});
