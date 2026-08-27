import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Bold,
  BulletList,
  Document,
  Editor,
  ListItem,
  Node,
  Paragraph,
  Text,
} from '@domternal/core';
import { Image } from './Image.js';

const table = Node.create({
  name: 'table', group: 'block', content: 'tableRow+', isolating: true,
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: () => ['table', ['tbody', 0]],
});
const tableRow = Node.create({
  name: 'tableRow', content: 'tableCell+',
  parseHTML: () => [{ tag: 'tr' }],
  renderHTML: () => ['tr', 0],
});
const tableCell = Node.create({
  name: 'tableCell', content: 'block+', isolating: true,
  parseHTML: () => [{ tag: 'td' }],
  renderHTML: () => ['td', 0],
});

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  vi.restoreAllMocks();
});

function mount(uploadHandler: ((file: File) => Promise<string>) | null): Editor {
  editor = new Editor({
    extensions: [
      Document, Text, Paragraph, Bold, BulletList, ListItem,
      table, tableRow, tableCell, Image.configure({ uploadHandler }),
    ],
    content: '<p></p>',
  });
  editor.commands.selectAll();
  return editor;
}

function pasteWithImage(target: Editor, html: string, text = ''): File {
  const file = new File(['image bytes'], 'clipboard.png', { type: 'image/png' });
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '',
    },
  });
  target.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  return file;
}

describe.each(['base64', 'upload'] as const)('image paste ownership in %s mode', mode => {
  it.each([
    {
      kind: 'formatted paragraphs',
      html: '<p>Before <strong>formatted</strong> after</p><img src="/embedded.png" alt="Embedded">',
    },
    {
      kind: 'lists',
      html: '<ul><li><p>First</p></li><li><p>Second</p><img src="/embedded.png" alt="Embedded"></li></ul>',
    },
    {
      kind: 'tables',
      html: '<table><tbody><tr><td><p>Cell</p><img src="/embedded.png" alt="Embedded"></td><td><p>Other cell</p></td></tr></tbody></table>',
    },
  ])('preserves $kind when clipboard files accompany rich content', ({ html }) => {
    const upload = vi.fn(() => new Promise<string>(() => undefined));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);

    pasteWithImage(instance, html);

    expect(upload).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(instance.getHTML()).toBe(html);
    expect(instance.view.dom.querySelectorAll('img')).toHaveLength(1);
    expect(() => { instance.state.doc.check(); }).not.toThrow();
  });

  it('preserves plain text when a file accompanies it', () => {
    const upload = vi.fn(() => new Promise<string>(() => undefined));
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(() => undefined);
    const instance = mount(mode === 'upload' ? upload : null);

    pasteWithImage(instance, '', 'Clipboard text');

    expect(upload).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(instance.getHTML()).toBe('<p>Clipboard text</p>');
  });

  it.each([
    { kind: 'a screenshot without HTML', html: '' },
    {
      kind: 'an image with alt text and empty wrappers',
      html: '<img src="/copied.png" alt="Descriptive image"><p> \u00a0 </p>',
    },
  ])('keeps file insertion for $kind', async ({ html }) => {
    const upload = vi.fn().mockResolvedValue('/uploaded.png');
    const instance = mount(mode === 'upload' ? upload : null);

    const file = pasteWithImage(instance, html);

    await vi.waitFor(() => {
      const images = instance.view.dom.querySelectorAll('img');
      expect(images).toHaveLength(1);
      expect(images[0]?.getAttribute('src')).toMatch(
        mode === 'upload' ? /^\/uploaded\.png$/ : /^data:image\/png;base64,/,
      );
    });
    if (mode === 'upload') expect(upload).toHaveBeenCalledExactlyOnceWith(file);
    else expect(upload).not.toHaveBeenCalled();
  });
});
