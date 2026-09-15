import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { Details } from './Details.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({
    element: host, extensions: [Document, Paragraph, Text, Details],
    content: '<details><summary>My heading</summary><div data-details-content><p>My content</p></div></details>',
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
});

describe('details UI localization', () => {
  it('updates toggle accessibility in place while preserving open state, focus and semantic content', () => {
    const editor = createEditor();
    const node = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]');
    const toggle = node?.querySelector<HTMLButtonElement>('button');
    if (!node || !toggle) throw new Error('Expected details controls.');
    toggle.click();
    toggle.focus();
    const state = editor.state;
    const html = editor.getHTML();
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: { 'details.toggle.label': '<b>Proširi detalje</b>' } });
    expect(editor.view.dom.querySelector('[data-type="details"]')).toBe(node);
    expect(node.querySelector('button')).toBe(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('<b>Proširi detalje</b>');
    expect(toggle.lang).toBe('hr');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(node.classList.contains('is-open')).toBe(true);
    expect(document.activeElement).toBe(toggle);
    expect(node.querySelector('b')).toBeNull();
    expect(editor.getHTML()).toBe(html);
    expect(editor.state).toBe(state);
    expect(transaction).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe('My headingMy content');
  });

  it('localizes actions and aliases without changing command or group identities', () => {
    const editor = createEditor();
    editor.i18n.set({ locale: 'hr', messages: {
      'details.toolbar.toggle': 'Detalji', 'details.insert.label': 'Sklopivi blok',
      'details.insert.description': '', 'core.group.advanced': 'Napredno',
    }, searchAliases: { 'details.insert.label': ['sklopivo'] } });
    expect(editor.toolbarItems.find(item => item.name === 'details')).toMatchObject({ label: 'Detalji', labelLanguage: 'hr', command: 'toggleDetails', group: 'insert' });
    expect(editor.floatingMenuItems.find(item => item.name === 'details')).toMatchObject({
      label: 'Sklopivi blok', labelLanguage: 'hr', description: '', descriptionLanguage: 'hr',
      group: 'Advanced', groupLabel: 'Napredno', groupLabelLanguage: 'hr', command: 'toggleDetails',
      keywords: ['sklopivo', 'toggle', 'collapse', 'details', 'accordion'],
    });
  });

  it('isolates editors and removes node view subscriptions during teardown', () => {
    const first = createEditor();
    const second = createEditor();
    const toggle = first.view.dom.querySelector('button');
    first.i18n.set({ locale: 'hr', messages: { 'details.toggle.label': 'Proširi' } });
    expect(second.view.dom.querySelector('button')?.getAttribute('aria-label')).toBe('Toggle details');
    first.destroy();
    first.i18n.set({ locale: 'de', messages: { 'details.toggle.label': 'Erweitern' } });
    expect(toggle?.getAttribute('aria-label')).toBe('Proširi');
  });
});
