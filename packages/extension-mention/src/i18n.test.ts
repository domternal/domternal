import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { Mention } from './Mention.js';
import { createMentionSuggestionRenderer } from './mentionSuggestionRenderer.js';
import type { MentionItem, MentionSuggestionProps, MentionTrigger } from './mentionSuggestionPlugin.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(trigger: Partial<MentionTrigger> = {}): Editor {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({
    element: host, extensions: [Document, Paragraph, Text, Mention.configure({ suggestion: {
      char: '@', name: 'user', items: () => [], render: createMentionSuggestionRenderer(), ...trigger,
    } })], content: '<p></p>',
  });
  editors.push(editor);
  return editor;
}
function menuOf(editor: Editor): HTMLElement {
  const menu = editor.view.dom.closest('.dm-editor')?.querySelector<HTMLElement>('.dm-mention-suggestion');
  if (!menu) throw new Error('Expected mention suggestions.');
  return menu;
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mention UI localization', () => {
  it.each(['mention.suggestions.label', 'mention.suggestions.empty'] as const)(
    'settles a reentrant %s translation without fetching again', triggerId => {
      const items = vi.fn(() => []);
      const editor = createEditor({ items });
      editor.view.dispatch(editor.state.tr.insertText('@'));
      const menu = menuOf(editor);
      const empty = menu.querySelector('.dm-mention-suggestion-empty');
      const state = editor.state;
      items.mockClear();
      let changed = false;
      editor.i18n.set({ locale: 'hr', resolve: id => {
        if (id !== triggerId || changed) return undefined;
        changed = true;
        editor.i18n.set({ locale: 'de', messages: {
          'mention.suggestions.label': 'Erwähnungen', 'mention.suggestions.empty': 'Keine Ergebnisse',
        } });
        return 'Stale Croatian wording';
      } });
      expect(changed).toBe(true);
      expect(menu.getAttribute('aria-label')).toBe('Erwähnungen');
      expect(menu.lang).toBe('de');
      expect(empty?.textContent).toBe('Keine Ergebnisse');
      expect(empty?.getAttribute('lang')).toBe('de');
      expect(menuOf(editor)).toBe(menu);
      expect(items).not.toHaveBeenCalled();
      expect(editor.state).toBe(state);
    },
  );

  it('updates an empty menu in place without re-running the source or changing query/document', () => {
    const items = vi.fn(() => []);
    const editor = createEditor({ items });
    editor.view.dispatch(editor.state.tr.insertText('@'));
    const menu = menuOf(editor);
    const empty = menu.querySelector('.dm-mention-suggestion-empty');
    const state = editor.state;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    items.mockClear();
    editor.i18n.set({ locale: 'hr', messages: { 'mention.suggestions.label': 'Spominjanja', 'mention.suggestions.empty': '<b>Nema rezultata</b>' } });
    expect(menuOf(editor)).toBe(menu);
    expect(menu.querySelector('.dm-mention-suggestion-empty')).toBe(empty);
    expect(menu.getAttribute('aria-label')).toBe('Spominjanja');
    expect(menu.lang).toBe('hr');
    expect(empty?.textContent).toBe('<b>Nema rezultata</b>');
    expect(empty?.getAttribute('lang')).toBe('hr');
    expect(menu.querySelector('b')).toBeNull();
    expect(items).not.toHaveBeenCalled();
    expect(editor.state).toBe(state);
    expect(editor.state.doc.textContent).toBe('@');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('retains selected row, focus and pending click while leaving source names unchanged', () => {
    const items = vi.fn(() => [{ id: 'a', label: 'Alice' }, { id: 'b', label: '<b>Branko</b>', labelLanguage: 'hr' }]);
    const editor = createEditor({ items });
    editor.view.dispatch(editor.state.tr.insertText('@'));
    const menu = menuOf(editor);
    const button = menu.querySelectorAll<HTMLButtonElement>('button')[1];
    if (!button) throw new Error('Expected second mention row.');
    button.dispatchEvent(new MouseEvent('mousemove'));
    button.focus();
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const state = editor.state;
    items.mockClear();
    editor.i18n.set({ locale: 'de', messages: { 'mention.suggestions.label': 'Erwähnungen' } });
    expect(menu.querySelectorAll('button')[1]).toBe(button);
    expect(button.classList.contains('dm-mention-suggestion-item--selected')).toBe(true);
    expect(button.getAttribute('aria-selected')).toBe('true');
    expect(button.textContent).toBe('<b>Branko</b>');
    expect(button.lang).toBe('hr');
    expect(menu.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(editor.state).toBe(state);
    expect(items).not.toHaveBeenCalled();
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    expect(editor.state).toBe(state);
    button.click();
    const mention = editor.state.doc.firstChild?.firstChild;
    expect(mention?.attrs).toMatchObject({ id: 'b', label: '<b>Branko</b>', type: 'user' });
    expect(mention?.attrs).not.toHaveProperty('labelLanguage');
  });

  it('delivers one revision update to an existing custom renderer without creating it or fetching again', () => {
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const onExit = vi.fn();
    const render = vi.fn(() => ({ onStart, onUpdate, onExit, onKeyDown: () => false }));
    const result = [{ id: 'a', label: 'Alice' }];
    const items = vi.fn(() => result);
    const editor = createEditor({ items, render });
    editor.view.dispatch(editor.state.tr.insertText('@al'));
    items.mockClear();
    onUpdate.mockClear();
    editor.i18n.set({ locale: 'hr' });
    expect(render).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ items: result, query: 'al', i18n: editor.i18n, localeRevision: editor.i18n.getSnapshot().revision }));
    expect(items).not.toHaveBeenCalled();
    editor.destroy();
    expect(onExit).toHaveBeenCalledOnce();
    editor.i18n.set({ locale: 'de' });
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('uses the current locale when pending async results arrive without a duplicate request', async () => {
    let finish: ((items: MentionItem[]) => void) | undefined;
    const items = vi.fn(() => new Promise<MentionItem[]>(resolve => { finish = resolve; }));
    const editor = createEditor({ items });
    editor.view.dispatch(editor.state.tr.insertText('@'));
    editor.i18n.set({ locale: 'hr', messages: { 'mention.suggestions.empty': 'Nema rezultata' } });
    expect(items).toHaveBeenCalledOnce();
    finish?.([]);
    await vi.waitFor(() => { expect(menuOf(editor).textContent).toBe('Nema rezultata'); });
    expect(items).toHaveBeenCalledOnce();
  });

  it('preserves an outstanding debounce and prevents pending results from reopening a destroyed renderer', async () => {
    vi.useFakeTimers();
    const onStart = vi.fn();
    let finish: ((items: MentionItem[]) => void) | undefined;
    const items = vi.fn(() => new Promise<MentionItem[]>(resolve => { finish = resolve; }));
    const editor = createEditor({ items, debounce: 100, render: () => ({ onStart, onUpdate: vi.fn(), onExit: vi.fn(), onKeyDown: () => false }) });
    editor.view.dispatch(editor.state.tr.insertText('@'));
    await vi.advanceTimersByTimeAsync(50);
    editor.i18n.set({ locale: 'hr' });
    await vi.advanceTimersByTimeAsync(50);
    expect(items).toHaveBeenCalledOnce();
    editor.destroy();
    finish?.([]);
    await Promise.resolve();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('keeps editor instances isolated and legacy standalone renderer props compatible', () => {
    const first = createEditor();
    const second = createEditor();
    first.view.dispatch(first.state.tr.insertText('@'));
    second.view.dispatch(second.state.tr.insertText('@'));
    first.i18n.set({ locale: 'hr', messages: { 'mention.suggestions.empty': 'Nema rezultata' } });
    expect(menuOf(first).textContent).toBe('Nema rezultata');
    expect(menuOf(second).textContent).toBe('No results');
    const renderer = createMentionSuggestionRenderer()();
    const host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    hosts.push(host);
    const props: MentionSuggestionProps = { items: [], query: '', range: { from: 0, to: 1 }, element: host, command: vi.fn(), clientRect: null };
    renderer.onStart(props);
    expect(host.querySelector('.dm-mention-suggestion')?.getAttribute('aria-label')).toBe('Mention suggestions');
    expect(host.textContent).toBe('No results');
    renderer.onExit();
  });
});
