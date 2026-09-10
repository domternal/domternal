/**
 * Which pastes insert the clipboard's image files, without PasteCleanup: the files are the paste
 * when the pasted content has no text of its own (Core's rule), and one file keeps the alt text of
 * the one image the content held. Content with text of its own keeps the paste, since Office and
 * Google Docs put a picture of the copied selection next to it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Link, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Image } from './Image.js';
import type { ImageOptions } from './Image.js';

let editor: Editor | undefined;
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const upload = (file: File): Promise<string> => Promise.resolve(`https://cdn.example/${file.name}`);

function mount(options: Partial<ImageOptions> = { uploadHandler: upload }): Editor {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Link, Image.configure(options)],
    content: '<p>Start</p>',
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)));
  return editor;
}

const png = (name = 'shot.png', type = 'image/png'): File => new File([new Uint8Array(8)], name, { type });

function paste(target: Editor, clipboard: { html?: string; text?: string; files?: File[] }): ClipboardEvent {
  const files = clipboard.files ?? [];
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [...(clipboard.html === undefined ? [] : ['text/html']), ...(clipboard.text === undefined ? [] : ['text/plain']), ...(files.length > 0 ? ['Files'] : [])],
      files,
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => (type === 'text/html' ? clipboard.html ?? '' : type === 'text/plain' ? clipboard.text ?? '' : ''),
    },
  });
  target.view.dom.dispatchEvent(event);
  return event;
}

const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
const images = (target: Editor): { src: unknown; alt: unknown }[] => {
  const found: { src: unknown; alt: unknown }[] = [];
  target.state.doc.descendants(node => { if (node.type.name === 'image') found.push({ src: node.attrs['src'], alt: node.attrs['alt'] }); });
  return found;
};

describe('pasting image files without PasteCleanup', () => {
  it.each([
    ['a file-manager copy that names the file', { text: 'shot.png' }],
    ['white space', { text: '  \n ' }],
    ['HTML holding only white space', { html: '<p> </p>' }],
    ['HTML holding only a no-break space', { html: '<p>&nbsp;</p>' }],
    ['HTML holding only a zero-width space', { html: '<p>\u200b</p>' }],
    ['HTML holding only a zero-width joiner and a soft hyphen', { html: '<p>\u200d\u00ad</p>' }],
    ['HTML holding only a meta element', { html: '<meta charset="utf-8">' }],
    ['HTML holding only a data image', { html: '<img src="data:image/png;base64,iVBORw0KGgo=">' }],
    ['HTML holding only a blob image', { html: '<img src="blob:https://example.com/123">' }],
    ['HTML holding two images and no text', { html: '<img src="https://example.com/a.png"><img src="https://example.com/b.png">' }],
  ])('inserts the file for %s', async (_name, clipboard) => {
    const ed = mount();
    const event = paste(ed, { ...clipboard, files: [png()] });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(images(ed)).toEqual([{ src: 'https://cdn.example/shot.png', alt: null }]);
    expect(ed.getText()).toBe('Start');
  });

  it.each([
    ['a copied web image', '<meta charset="utf-8"><img src="https://example.com/cat.png" alt="A cat">'],
    ['a copied local image', '<img src="file:///C:/Users/me/cat.png" alt="A cat">'],
  ])('keeps the alt text of %s on the file it inserts', async (_name, html) => {
    const ed = mount();
    paste(ed, { html, files: [png()] });
    await settle();
    expect(images(ed)).toEqual([{ src: 'https://cdn.example/shot.png', alt: 'A cat' }]);
  });

  it('inserts the file, not a link, for a copied image whose text is its address', async () => {
    const ed = mount();
    paste(ed, { html: '<img src="https://example.com/cat.png">', text: 'https://example.com/cat.png', files: [png()] });
    await settle();
    expect(images(ed)).toEqual([{ src: 'https://cdn.example/shot.png', alt: null }]);
    expect(ed.getHTML()).not.toContain('<a ');
  });

  it.each([
    ['plain text', { text: 'Hello' }, 'StartHello'],
    ['a file name with a path', { text: '/home/me/shot.png' }, 'Start/home/me/shot.png'],
    ['HTML text', { html: '<p>Hello</p>' }, 'StartHello'],
    ['a figure with a caption', { html: '<figure><img src="https://example.com/a.png"><figcaption>Caption</figcaption></figure>' }, 'Start\n\nCaption'],
    ['a braille blank, which is a character', { html: '<p>\u2800</p>' }, 'Start\u2800'],
  ])('keeps the paste of %s and ignores the file', async (_name, clipboard, text) => {
    const ed = mount();
    paste(ed, { ...clipboard, files: [png()] });
    await settle();
    expect(images(ed).filter(image => image.src === 'https://cdn.example/shot.png')).toEqual([]);
    expect(ed.getText()).toBe(text);
  });

  it('keeps text next to a local image the Image refuses as an image without a source, and ignores the file', async () => {
    const ed = mount();
    paste(ed, { html: '<p>Text</p><img src="file:///C:/cat.png" alt="A cat">', files: [png()] });
    await settle();
    expect(ed.getText()).toContain('Text');
    expect(images(ed)).toEqual([{ src: null, alt: 'A cat' }]);
  });

  it('inserts two files in order, without alt text', async () => {
    const ed = mount();
    paste(ed, { html: '<img src="https://example.com/a.png" alt="A">', files: [png('1.png'), png('2.png')] });
    await settle();
    expect(images(ed)).toEqual([{ src: 'https://cdn.example/1.png', alt: null }, { src: 'https://cdn.example/2.png', alt: null }]);
  });

  it('leaves a paste of a non-image file and of image files the configuration refuses to its content', async () => {
    const ed = mount({ uploadHandler: upload, allowedMimeTypes: ['image/png'] });
    paste(ed, { html: '<p>Doc</p>', files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] });
    paste(ed, { html: '<img src="https://example.com/a.gif" alt="gif">', files: [png('a.gif', 'image/gif')] });
    await settle();
    expect(ed.getText()).toContain('Doc');
    expect(images(ed)).toEqual([{ src: 'https://example.com/a.gif', alt: 'gif' }]);
  });
});

describe('pasting image files with allowBase64 false and no uploadHandler', () => {
  it('stores nothing and takes a paste of files alone', async () => {
    const ed = mount({ allowBase64: false });
    const event = paste(ed, { files: [png()] });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(images(ed)).toEqual([]);
    expect(ed.getHTML()).toBe('<p>Start</p>');
  });

  it('pastes the content next to the files as if there were none', async () => {
    const ed = mount({ allowBase64: false });
    paste(ed, { text: 'Hello', files: [png()] });
    await settle();
    expect(ed.getText()).toBe('StartHello');
    expect(JSON.stringify(ed.getJSON())).not.toContain('data:');
  });
});

describe('dropping image files', () => {
  it('gives one dropped file the alt text of the one image the drop held', async () => {
    const ed = mount();
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const file = png();
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/html', 'Files'], files: [file], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        getData: (type: string) => (type === 'text/html' ? '<img src="https://example.com/cat.png" alt="A cat">' : ''), dropEffect: 'none' },
    });
    ed.view.dom.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(images(ed)).toEqual([{ src: 'https://cdn.example/shot.png', alt: 'A cat' }]);
  });
});

describe('a read-only editor', () => {
  it('pastes no file', async () => {
    const ed = mount();
    ed.setEditable(false);
    paste(ed, { files: [png()] });
    await settle();
    expect(images(ed)).toEqual([]);
  });
});
