import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { NodeSelection } from '@domternal/pm/state';
import { Image } from './Image.js';
import { imageMessages } from './messages.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(content = '<p>Hello</p>'): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({ element: host, extensions: [Document, Paragraph, Text, Image], content });
  editors.push(editor);
  return editor;
}
function emit(editor: Editor, event: string, anchor?: HTMLElement): void {
  (editor.emit as (name: string, payload: unknown) => void)(event, { anchorElement: anchor });
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
});

describe('image UI localization', () => {
  it('localizes actions and search aliases while keeping stable command values', () => {
    const editor = createEditor();
    const original = editor.toolbarItems.find(item => item.name === 'imageFloatLeft');
    editor.i18n.set({ locale: 'hr', messages: {
      'image.toolbar.insert': 'Umetni sliku',
      'image.float.left': 'Lijevo',
      'image.insert.label': 'Slika',
      'image.insert.description': 'Dodaj sliku',
      'core.group.media': 'Mediji',
    }, searchAliases: { 'image.insert.label': ['fotografija'] } });
    expect(editor.toolbarItems.find(item => item.name === 'image')).toMatchObject({ label: 'Umetni sliku' });
    const item = editor.toolbarItems.find(item => item.name === 'imageFloatLeft');
    expect(item).toMatchObject({ name: 'imageFloatLeft', label: 'Lijevo', labelLanguage: 'hr', command: 'setImageFloat', commandArgs: ['left'] });
    expect(item?.type === 'button' && item.isActive).toEqual(original?.type === 'button' && original.isActive);
    expect(editor.floatingMenuItems.find(value => value.name === 'image')).toMatchObject({
      name: 'image', label: 'Slika', labelLanguage: 'hr', description: 'Dodaj sliku', descriptionLanguage: 'hr',
      group: 'Media', groupLabel: 'Mediji', groupLabelLanguage: 'hr', keywords: ['fotografija', 'image', 'img'],
    });
    expect(editor.i18n.resolve(imageMessages.delete)).toMatchObject({ text: 'Delete', language: 'en' });
  });

  it('updates an open alt editor without replacing its draft, focus, selection or document', () => {
    const editor = createEditor('<img src="/photo.png" alt="Original alt" title="Original title">');
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    emit(editor, 'editImage');
    const popover = document.querySelector<HTMLElement>('.dm-image-popover');
    const input = popover?.querySelector<HTMLInputElement>('.dm-image-popover-alt-input');
    const apply = popover?.querySelector<HTMLButtonElement>('.dm-image-popover-apply');
    if (!popover || !input || !apply) throw new Error('Expected an open image editor.');
    input.value = 'Unsaved <b>draft</b>';
    input.setSelectionRange(3, 10);
    input.focus();
    const state = editor.state;
    const html = editor.getHTML();
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: {
      'image.popover.altLabel': 'Opis slike',
      'image.popover.altPlaceholder': '<b>Neobvezni opis</b>',
      'image.popover.saveAlt': 'Spremi opis',
    } });
    expect(popover.hasAttribute('data-show')).toBe(true);
    expect(popover.querySelector('.dm-image-popover-alt-input')).toBe(input);
    expect(input.value).toBe('Unsaved <b>draft</b>');
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 10]);
    expect(document.activeElement).toBe(input);
    expect(input.placeholder).toBe('<b>Neobvezni opis</b>');
    expect(input.getAttribute('aria-label')).toBe('Opis slike');
    expect(input.lang).toBe('hr');
    expect(apply.title).toBe('Spremi opis');
    expect(popover.querySelector('b')).toBeNull();
    expect(editor.state).toBe(state);
    expect(editor.getHTML()).toBe(html);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps each insertion popover isolated and cleans up its subscription', () => {
    const first = createEditor();
    const second = createEditor();
    const popovers = Array.from(document.querySelectorAll<HTMLElement>('.dm-image-popover'));
    emit(first, 'insertImage', first.view.dom);
    const input = popovers[0]?.querySelector<HTMLInputElement>('.dm-image-popover-input');
    if (!input) throw new Error('Expected URL input.');
    input.value = '/unsaved.png';
    first.i18n.set({ locale: 'hr', messages: { 'image.popover.urlLabel': 'Adresa slike', 'image.popover.insert': 'Umetni' } });
    expect(input.value).toBe('/unsaved.png');
    expect(popovers[0]?.querySelector('.dm-image-popover-apply')?.getAttribute('aria-label')).toBe('Umetni');
    expect(popovers[1]?.querySelector('.dm-image-popover-input')?.getAttribute('aria-label')).toBe('Image URL');
    first.destroy();
    expect(popovers[0]?.isConnected).toBe(false);
    expect(popovers[1]?.isConnected).toBe(true);
    second.i18n.set({ locale: 'de', messages: { 'image.popover.urlLabel': 'Bildadresse' } });
    expect(input.getAttribute('aria-label')).toBe('Adresa slike');
    expect(popovers[1]?.querySelector('.dm-image-popover-input')?.getAttribute('aria-label')).toBe('Bildadresse');
  });
});
