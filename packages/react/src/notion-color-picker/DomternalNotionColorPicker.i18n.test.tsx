import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Paragraph, Text, TextStyle, NotionColorPicker } from '@domternal/core';
import { DomternalNotionColorPicker } from './DomternalNotionColorPicker.js';
let host: HTMLDivElement;
let mount: HTMLDivElement;
let anchor: HTMLButtonElement;
let editor: Editor;
let root: Root;
async function update(action: () => void): Promise<void> {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  host = document.createElement('div');
  host.className = 'dm-editor';
  mount = document.createElement('div');
  anchor = document.createElement('button');
  host.append(mount, anchor);
  document.body.append(host);
  const content = document.createElement('div');
  host.append(content);
  editor = new Editor({
    element: content,
    extensions: [
      Document,
      Paragraph,
      Text,
      TextStyle,
      NotionColorPicker.configure({ palette: ['blue', 'brand'] }),
    ],
    content: '<p>Keep content</p>',
  });
  root = createRoot(mount);
  await act(async () => {
    root.render(<DomternalNotionColorPicker editor={editor} />);
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
describe('color picker localization', () => {
  it('patches swatches in place and retains focused token, content and open state', async () => {
    await update(() => {
      editor.emit('notionColorOpen', { anchorElement: anchor });
    });
    const panel = host.querySelector('.dm-notion-color-picker');
    const swatch = panel?.querySelector<HTMLButtonElement>(
      '.dm-ncp-swatch--text[data-color="blue"]'
    );
    if (!swatch) throw new Error('Expected blue swatch');
    swatch.focus();
    const state = editor.state;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    await update(() => {
      editor.i18n.set({
        locale: 'hr',
        messages: {
          'core.colorPicker.text': 'Boja teksta',
          'core.colorPicker.blue': 'Plava',
          'core.colorPicker.textSwatch': ({ color }) => `<b>${color}</b> tekst`,
        },
      });
    });
    expect(host.querySelector('.dm-notion-color-picker')).toBe(panel);
    expect(panel?.querySelector('.dm-ncp-swatch--text[data-color="blue"]')).toBe(swatch);
    expect(document.activeElement).toBe(swatch);
    expect(swatch.getAttribute('aria-label')).toBe('<b>Plava</b> tekst');
    expect(swatch.title).toBe('Plava');
    expect(swatch.lang).toBe('hr');
    expect(swatch.querySelector('b')).toBeNull();
    expect(panel?.querySelector('.dm-ncp-label')?.textContent).toBe('Boja teksta');
    expect(panel?.querySelector<HTMLButtonElement>('[data-color="brand"]')?.title).toBe('Brand');
    expect(editor.state).toBe(state);
    expect(transaction).not.toHaveBeenCalled();
    await update(() => {
      editor.i18n.set({ locale: 'hr' });
    });
    expect(swatch.getAttribute('aria-label')).toBe('Blue text');
    expect(swatch.lang).toBe('en');
  });
});
