import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Heading, Paragraph, Text, UniqueID } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import { TableOfContentsBlock } from './TableOfContentsBlock.js';
import { FloatingTocOutline } from './FloatingTocOutline.js';
import type { TocStorage } from './types.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
async function createEditor(content: string, block: AnyExtension = TableOfContentsBlock): Promise<{ editor: Editor; host: HTMLElement }> {
  const host = document.createElement('div');
  host.lang = 'fr';
  const editorHost = document.createElement('div');
  editorHost.className = 'dm-editor';
  host.appendChild(editorHost);
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({
    element: editorHost, extensions: [Document, Paragraph, Text, Heading, UniqueID, TableOfContents,
      FloatingTocOutline.configure({ mobileBreakpoint: 0, hoverInDelay: 0 }), block], content,
  });
  editors.push(editor);
  await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  return { editor, host };
}
function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Expected ${selector}.`);
  return element;
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
  window.history.replaceState(null, '', window.location.pathname);
});

describe('table of contents UI localization', () => {
  it.each(['toc.outline.label', 'toc.heading.fallback'] as const)(
    'keeps reentrant %s copy current in the existing outline and block', async triggerId => {
      const { editor, host } = await createEditor('<h1 id="empty"></h1><div data-type="table-of-contents"></div>');
      const nav = required(host, '.dm-toc-outline');
      const row = required(nav, '.dm-toc-outline-row');
      const link = required(host, '.dm-toc-block-link');
      row.focus();
      const state = editor.state;
      let changed = false;
      editor.i18n.set({ locale: 'hr', resolve: id => {
        if (id !== triggerId || changed) return undefined;
        changed = true;
        editor.i18n.set({ locale: 'de', messages: {
          'toc.outline.label': 'Dokumentübersicht', 'toc.heading.fallback': 'Überschrift',
        } });
        return 'Stale Croatian wording';
      } });
      expect(changed).toBe(true);
      expect(nav.getAttribute('aria-label')).toBe('Dokumentübersicht');
      expect(nav.lang).toBe('de');
      expect(row.textContent).toBe('Überschrift');
      expect(link.textContent).toBe('Überschrift');
      expect(row.lang).toBe('de');
      expect(link.lang).toBe('de');
      expect(document.activeElement).toBe(row);
      expect(editor.state).toBe(state);
    },
  );

  it('settles reentrant empty-state copy without adding document content', async () => {
    const { editor, host } = await createEditor('<div data-type="table-of-contents"></div>');
    const empty = required(host, '.dm-toc-block-empty');
    const state = editor.state;
    let changed = false;
    editor.i18n.set({ locale: 'hr', resolve: id => {
      if (id !== 'toc.block.empty' || changed) return undefined;
      changed = true;
      editor.i18n.set({ locale: 'de', messages: { 'toc.block.empty': 'Überschriften hinzufügen' } });
      return 'Stale Croatian wording';
    } });
    expect(changed).toBe(true);
    expect(empty.textContent).toBe('Überschriften hinzufügen');
    expect(empty.lang).toBe('de');
    expect(editor.state).toBe(state);
  });

  it('patches a focused expanded outline and inline block in place without translating authored headings', async () => {
    const { editor, host } = await createEditor('<h1 id="first">Mon titre</h1><h2 id="second"></h2><div data-type="table-of-contents"></div>');
    const nav = required(host, '.dm-toc-outline');
    const authored = required(nav, '.dm-toc-outline-row[data-toc-anchor="first"]');
    const fallback = required(nav, '.dm-toc-outline-row[data-toc-anchor="second"]');
    const tick = required(nav, '.dm-toc-outline-tick[data-toc-anchor="first"]');
    const link = required(host, '.dm-toc-block-link[data-toc-anchor="second"]');
    const storage = editor.storage['toc'] as TocStorage;
    storage.activeId = 'first';
    storage.subscribers.forEach(subscriber => { subscriber(); });
    authored.focus();
    authored.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const state = editor.state;
    const html = editor.getHTML();
    const content = storage.content;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: {
      'toc.outline.label': '<b>Pregled dokumenta</b>',
      'toc.heading.fallback': ({ level }) => `Naslov razine ${String(level)}`,
      'toc.heading.label': ({ label, level }) => `${label}, razina ${String(level)}`,
    } });
    expect(required(host, '.dm-toc-outline')).toBe(nav);
    expect(nav.getAttribute('aria-label')).toBe('<b>Pregled dokumenta</b>');
    expect(nav.lang).toBe('hr');
    expect(nav.dataset['state']).toBe('expanded');
    expect(required(nav, '.dm-toc-outline-row[data-toc-anchor="first"]')).toBe(authored);
    expect(required(host, '.dm-toc-block-link[data-toc-anchor="second"]')).toBe(link);
    expect(authored.textContent).toBe('Mon titre');
    expect(authored.lang).toBe('fr');
    expect(fallback.textContent).toBe('Naslov razine 2');
    expect(fallback.lang).toBe('hr');
    expect(link.textContent).toBe('Naslov razine 2');
    expect(tick.getAttribute('aria-label')).toBe('Mon titre, razina 1');
    expect(tick.dataset['tocAnchor']).toBe('first');
    expect(nav.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(authored);
    expect(editor.state).toBe(state);
    expect(editor.getHTML()).toBe(html);
    expect(storage.content).toBe(content);
    expect(transaction).not.toHaveBeenCalled();
    const scroll = vi.fn();
    required(editor.view.dom, '#first').scrollIntoView = scroll;
    authored.click();
    expect(scroll).toHaveBeenCalledOnce();
    expect(editor.state).toBe(state);
  });

  it('updates the empty state as safe text without changing serialized content', async () => {
    const { editor, host } = await createEditor('<div data-type="table-of-contents"></div><p>No headings</p>');
    const empty = required(host, '.dm-toc-block-empty');
    const html = editor.getHTML();
    const json = editor.getJSON();
    editor.i18n.set({ locale: 'hr', messages: { 'toc.block.empty': '<b>Dodajte naslove</b>' } });
    expect(required(host, '.dm-toc-block-empty')).toBe(empty);
    expect(empty.textContent).toBe('<b>Dodajte naslove</b>');
    expect(empty.lang).toBe('hr');
    expect(empty.querySelector('b')).toBeNull();
    expect(editor.getHTML()).toBe(html);
    expect(editor.getJSON()).toEqual(json);
    editor.i18n.set({ locale: 'hr', messages: { 'toc.block.empty': '' } });
    expect(empty.textContent).toBe('');
  });

  it.each(['configure', 'extend'] as const)('preserves explicitly owned default-English empty text through %s', async mode => {
    const emptyStateText = 'Add headings to create a table of contents.';
    const block = mode === 'configure'
      ? TableOfContentsBlock.configure({ emptyStateText })
      : TableOfContentsBlock.extend({ addOptions() { return { emptyStateText, HTMLAttributes: {} }; } });
    const { editor, host } = await createEditor('<div data-type="table-of-contents"></div>', block);
    editor.i18n.set({ locale: 'hr', messages: { 'toc.block.empty': 'Dodajte naslove' } });
    expect(required(host, '.dm-toc-block-empty').textContent).toBe(emptyStateText);
  });

  it('localizes insertion presentation and aliases with stable group/action identities', async () => {
    const { editor } = await createEditor('<p></p>');
    editor.i18n.set({ locale: 'hr', messages: {
      'toc.insert.label': 'Sadržaj', 'toc.insert.description': '', 'core.group.advanced': 'Napredno',
    }, searchAliases: { 'toc.insert.label': ['sadržaj'] } });
    expect(editor.floatingMenuItems.find(item => item.name === 'table-of-contents')).toMatchObject({
      label: 'Sadržaj', labelLanguage: 'hr', description: '', descriptionLanguage: 'hr', group: 'Advanced',
      groupLabel: 'Napredno', groupLabelLanguage: 'hr', keywords: ['sadržaj', 'toc', 'outline', 'contents'],
    });
  });

  it('isolates editors and disposes both outline and block locale subscriptions', async () => {
    const first = await createEditor('<div data-type="table-of-contents"></div>');
    const second = await createEditor('<div data-type="table-of-contents"></div>');
    const empty = required(first.host, '.dm-toc-block-empty');
    const nav = required(first.host, '.dm-toc-outline');
    first.editor.i18n.set({ locale: 'hr', messages: { 'toc.block.empty': 'Dodajte naslove', 'toc.outline.label': 'Pregled' } });
    expect(required(second.host, '.dm-toc-block-empty').textContent).toBe('Add headings to create a table of contents.');
    first.editor.destroy();
    first.editor.i18n.set({ locale: 'de' });
    expect(empty.textContent).toBe('Dodajte naslove');
    expect(nav.getAttribute('aria-label')).toBe('Pregled');
    expect(nav.isConnected).toBe(false);
  });
});
