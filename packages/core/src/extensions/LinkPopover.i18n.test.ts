import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Link } from '../marks/Link.js';
import { LinkPopover } from './LinkPopover.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

function create(): Editor {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, Link, LinkPopover],
    content: '<p>Keep document</p>',
  });
  editors.push(editor);
  return editor;
}

describe('link popover localization', () => {
  it('patches an open popover without replacing controls, losing a draft or moving focus', () => {
    const editor = create();
    const anchor = document.createElement('button');
    document.body.append(anchor);
    hosts.push(anchor);
    editor.emit('linkEdit', { anchorElement: anchor });
    const popover = document.querySelector<HTMLElement>('.dm-link-popover');
    const input = popover?.querySelector<HTMLInputElement>('input');
    const apply = popover?.querySelector<HTMLButtonElement>('.dm-link-popover-apply');
    const remove = popover?.querySelector<HTMLButtonElement>('.dm-link-popover-remove');
    if (!input || !apply || !remove) throw new Error('Link popover controls missing');
    input.value = 'https://example.com/draft';
    input.focus();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const state = editor.state;
    const onTransaction = vi.fn();
    editor.on('transaction', onTransaction);
    editor.i18n.set({
      locale: 'hr',
      messages: {
        'core.linkPopover.urlPlaceholder': 'Unesite adresu',
        'core.linkPopover.urlLabel': 'Adresa',
        'core.linkPopover.apply': '<img src=x> Primijeni',
      },
    });
    expect(popover?.getAttribute('data-show')).toBe('');
    expect(popover?.querySelector('input')).toBe(input);
    expect(popover?.querySelector('.dm-link-popover-apply')).toBe(apply);
    expect(input.value).toBe('https://example.com/draft');
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe('Unesite adresu');
    expect(input.getAttribute('aria-label')).toBe('Adresa');
    expect(input.lang).toBe('hr');
    expect(apply.title).toBe('<img src=x> Primijeni');
    expect(apply.getAttribute('aria-label')).toBe('<img src=x> Primijeni');
    expect(apply.lang).toBe('hr');
    expect(apply.querySelector('img')).toBeNull();
    expect(remove.title).toBe('Remove link');
    expect(remove.lang).toBe('en');
    expect(editor.state).toBe(state);
    expect(onTransaction).not.toHaveBeenCalled();
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    editor.i18n.set({ locale: 'hr', messages: { 'core.linkPopover.apply': 'Spremi' } });
    expect(apply.title).toBe('Spremi');
    expect(input.value).toBe('https://example.com/draft');
  });

  it('unsubscribes a removed plugin view and initializes labels when mounted again', () => {
    const editor = create();
    const plugins = editor.state.plugins;
    const plugin = plugins.find((entry) => entry.spec.view);
    if (!plugin) throw new Error('Link popover plugin missing');
    const input = document.querySelector<HTMLInputElement>('.dm-link-popover-input');
    editor.view.updateState(
      editor.state.reconfigure({ plugins: plugins.filter((entry) => entry !== plugin) })
    );
    editor.i18n.set({ locale: 'hr', messages: { 'core.linkPopover.urlLabel': 'Adresa' } });
    expect(input?.getAttribute('aria-label')).toBe('URL');
    expect(input?.isConnected).toBe(false);
    editor.view.updateState(editor.state.reconfigure({ plugins }));
    expect(document.querySelector('.dm-link-popover-input')).toBe(input);
    expect(input?.getAttribute('aria-label')).toBe('Adresa');
  });
});
