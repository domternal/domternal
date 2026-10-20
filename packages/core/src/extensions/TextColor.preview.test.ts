import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { TextStyle } from '../marks/TextStyle.js';
import { TextColor } from './TextColor.js';
import type { TextColorPreview, TextColorStorage } from './TextColor.js';

const editors: Editor[] = [];
const previews: TextColorPreview[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const preview of previews.splice(0)) preview.destroy();
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});
function editor(contrast: 'auto' | 'original' = 'auto'): Editor {
  const value = new Editor({ extensions: [Document, Paragraph, Text, TextStyle, TextColor.configure({ contrast })] });
  editors.push(value); return value;
}
function previewDom(): { host: HTMLElement; root: HTMLElement; mark: HTMLElement } {
  const host = document.createElement('div'); host.style.backgroundColor = '#202020';
  const root = document.createElement('div'); root.className = 'ProseMirror'; host.append(root);
  const mark = document.createElement('span'); mark.style.color = '#000000'; mark.textContent = 'Preview'; root.append(mark);
  hosts.push(host); return { host, root, mark };
}
function storage(value: Editor): TextColorStorage { return value.storage['textColor'] as TextColorStorage; }

describe('TextColor isolated preview presentation', () => {
  it('is opt-in and leaves original presentation untouched', () => {
    const { root, mark } = previewDom();
    expect(storage(editor('original')).preview(root, [{ element: mark, color: mark.style.color }])).toBeNull();
    expect(mark.hasAttribute('data-dm-text-contrast')).toBe(false);
  });

  it('paints after attach, follows the theme and removes all private presentation on teardown', async () => {
    const value = editor(); const before = value.getJSON();
    const { host, root, mark } = previewDom();
    const preview = storage(value).preview(root, [{ element: mark, color: mark.style.color }]);
    expect(preview).not.toBeNull(); if (!preview) return; previews.push(preview);
    document.body.append(host); preview.refresh();
    await vi.waitFor(() => { expect(mark.style.getPropertyValue('--dm-readable-color')).not.toBe(''); });
    expect(mark.style.color).toBe('rgb(0, 0, 0)');
    expect(value.getJSON()).toEqual(before);
    host.style.backgroundColor = '#ffffff';
    await vi.waitFor(() => { expect(mark.style.getPropertyValue('--dm-readable-color')).toBe(''); });
    preview.destroy(); preview.destroy();
    host.style.backgroundColor = '#202020'; preview.refresh();
    expect(mark.hasAttribute('data-dm-text-contrast')).toBe(false);
    expect(mark.style.getPropertyValue('--dm-readable-color')).toBe('');
  });

  it('does not register unrelated elements or a color different from the schema-rendered literal', () => {
    const { root, mark } = previewDom();
    const outsider = document.createElement('span'); outsider.style.color = '#000000';
    const preview = storage(editor()).preview(root, [
      { element: outsider, color: outsider.style.color }, { element: mark, color: '#ffffff' },
    ]);
    if (preview) previews.push(preview);
    expect(mark.hasAttribute('data-dm-text-contrast')).toBe(false);
    expect(outsider.hasAttribute('data-dm-text-contrast')).toBe(false);
  });
});
