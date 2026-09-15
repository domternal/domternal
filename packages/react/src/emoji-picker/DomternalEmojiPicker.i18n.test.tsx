import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { DomternalEmojiPicker } from './DomternalEmojiPicker.js';
const items = [
  { name: 'sun', emoji: '☀️', group: 'Objects' },
  { name: 'star', emoji: '⭐', group: 'Symbols', label: 'Custom label', searchAliases: ['kept'] },
  { name: 'custom', emoji: '✅', group: 'My custom group' },
];
let host: HTMLDivElement;
let mount: HTMLDivElement;
let editor: Editor;
let root: Root;
async function update(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
async function flush(): Promise<void> {
  await update(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await update(() => undefined);
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  host = document.createElement('div');
  mount = document.createElement('div');
  const content = document.createElement('div');
  host.append(mount, content);
  document.body.append(host);
  editor = new Editor({
    element: content,
    extensions: [Document, Paragraph, Text],
    content: '<p>Document</p>',
  });
  root = createRoot(mount);
  await act(async () => {
    root.render(<DomternalEmojiPicker editor={editor} emojis={items} />);
    await Promise.resolve();
  });
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    await Promise.resolve();
  });
  editor.destroy();
  host.remove();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});
function input(): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>('.dm-emoji-picker-search input');
  if (!element) throw new Error('Expected search input');
  return element;
}
async function search(value: string): Promise<void> {
  await update(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function event(element: HTMLElement, name: string): void {
  element.dispatchEvent(new Event(name, { bubbles: true }));
}
describe('emoji picker localization', () => {
  it('keeps query, input selection, focus and stable category keys during composition', async () => {
    await update(() => {
      (editor.emit as (event: string, data: unknown) => void)('insertEmoji', {});
    });
    const searchInput = input();
    searchInput.focus();
    await search('sun');
    searchInput.setSelectionRange(1, 2);
    const state = editor.state;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    event(searchInput, 'compositionstart');
    await update(() => {
      editor.i18n.set({
        locale: 'hr',
        messages: {
          'core.emojiPicker.searchLabel': 'Traži emoji',
          'core.emojiPicker.category.objects': 'Predmeti',
          'core.emojiPicker.itemName': ({ name }) => (name === 'sun' ? '<b>Sunce</b>' : name),
        },
      });
    });
    expect(searchInput.getAttribute('aria-label')).toBe('Search emoji');
    event(searchInput, 'compositionend');
    await flush();
    expect(input()).toBe(searchInput);
    expect(searchInput.value).toBe('sun');
    expect(searchInput.selectionStart).toBe(1);
    expect(searchInput.selectionEnd).toBe(2);
    expect(document.activeElement).toBe(searchInput);
    expect(searchInput.getAttribute('aria-label')).toBe('Traži emoji');
    expect(searchInput.lang).toBe('hr');
    expect(host.querySelector('.dm-emoji-picker-tab')?.getAttribute('aria-label')).toBe('Predmeti');
    expect(host.querySelector('.dm-emoji-picker-tab')?.getAttribute('aria-selected')).toBe('true');
    const swatch = host.querySelector<HTMLButtonElement>('.dm-emoji-swatch');
    expect(swatch?.title).toBe('<b>Sunce</b>');
    expect(swatch?.querySelector('b')).toBeNull();
    swatch?.focus();
    await update(() => {
      editor.i18n.set({
        locale: 'hr',
        messages: { 'core.emojiPicker.itemName': ({ name }) => (name === 'sun' ? 'Sunce' : name) },
      });
    });
    expect(host.querySelector('.dm-emoji-swatch')).toBe(swatch);
    expect(document.activeElement).toBe(swatch);
    expect(editor.state).toBe(state);
    expect(transaction).not.toHaveBeenCalled();
    await search('kept');
    expect(host.querySelector<HTMLButtonElement>('.dm-emoji-swatch')?.title).toBe('Custom label');
  });

  it('keeps a translated-only search result alive until the pending click is handled', async () => {
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.emojiPicker.itemName': ({ name }) => (name === 'sun' ? 'Sunce' : name) },
    });
    await update(() => {
      (editor.emit as (event: string, data: unknown) => void)('insertEmoji', {});
    });
    await search('Sunce');
    const swatch = host.querySelector<HTMLButtonElement>('.dm-emoji-swatch');
    if (!swatch) throw new Error('Expected a match by translated display name');
    event(swatch, 'pointerdown');
    await update(() => {
      editor.i18n.set();
    });
    expect(swatch.isConnected).toBe(true);
    await update(() => {
      event(swatch, 'pointerup');
      swatch.click();
    });
    await flush();
    expect(host.querySelector('.dm-emoji-picker')).toBeNull();
  });

  it('returns focus to the search input when the focused translation-only match disappears', async () => {
    editor.i18n.set({
      locale: 'hr',
      messages: { 'core.emojiPicker.itemName': ({ name }) => (name === 'sun' ? 'Sunce' : name) },
    });
    await update(() => {
      (editor.emit as (event: string, data: unknown) => void)('insertEmoji', {});
    });
    await search('Sunce');
    const swatch = host.querySelector<HTMLButtonElement>('.dm-emoji-swatch');
    if (!swatch) throw new Error('Expected translated match');
    swatch.focus();
    await update(() => {
      editor.i18n.set();
    });
    await flush();
    expect(swatch.isConnected).toBe(false);
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe('Sunce');
    expect(host.querySelector('.dm-emoji-picker-empty')?.textContent).toBe('No emoji found');
  });

  it('preserves explicit labels returned by the application search provider', async () => {
    vi.spyOn(editor, 'storage', 'get').mockReturnValue({
      emoji: { searchEmoji: () => [{ ...items[0], label: 'Provider label' }] },
    });
    await update(() => {
      (editor.emit as (event: string, data: unknown) => void)('insertEmoji', {});
    });
    await search('sun');
    expect(host.querySelectorAll('.dm-emoji-swatch')).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>('.dm-emoji-swatch')?.title).toBe('Provider label');
  });
});
