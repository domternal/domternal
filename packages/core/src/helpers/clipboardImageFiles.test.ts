/**
 * When a paste's image files are the paste: the rule every paste handler asks, and the handoff to
 * the view's image destination.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOMParser, Slice } from '@domternal/pm/model';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Node } from '../Node.js';
import { pasteClipboardImageFiles, pasteHasOwnText, registerClipboardImageDestination, setClipboardPasteBehavior } from '../clipboard.js';
import type { ClipboardImageDestinationPolicy, ClipboardImageFileInsertion } from '../clipboard.js';

const Photo = Node.create({
  name: 'photo', group: 'block', atom: true,
  addAttributes: () => ({ src: { default: null }, alt: { default: null } }),
  parseHTML: () => [{ tag: 'img', getAttrs: element => ({ src: element.getAttribute('src'), alt: element.getAttribute('alt') }) }],
  renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
});

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(): Editor {
  editor = new Editor({ extensions: [Document, Paragraph, Text, Photo], content: '<p></p>' });
  return editor;
}

const png = (name = 'image.png', type = 'image/png'): File => new File(['bytes'], name, { type });

interface Item { kind: string; type: string; getAsFile: () => File | null }
interface Clipboard { html?: string; text?: string; files?: File[]; items?: Item[] | null }

function pasteEvent({ html, text, files = [], items }: Clipboard): ClipboardEvent {
  const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
  const types = [...(html === undefined ? [] : ['text/html']), ...(text === undefined ? [] : ['text/plain']), ...(files.length > 0 ? ['Files'] : [])];
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types, files,
      items: items === null ? undefined : items ?? files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => (type === 'text/html' ? html ?? '' : type === 'text/plain' ? text ?? '' : ''),
    },
  });
  return event;
}

/** The slice ProseMirror parses from pasted HTML. */
function sliceOf(ed: Editor, html: string): Slice {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return DOMParser.fromSchema(ed.schema).parseSlice(holder);
}

function textSlice(ed: Editor, text: string): Slice {
  return sliceOf(ed, `<p>${text}</p>`);
}

const policy: ClipboardImageDestinationPolicy = {
  nodeTypeName: 'photo', sourceAttribute: 'src', inline: false, allowEmbedded: true,
  allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: 'test:1',
};

describe('pasteHasOwnText', () => {
  it.each([
    ['an empty slice', ''],
    ['ASCII spaces and line breaks', ' \n\t '],
    ['a no-break space', ' '],
    ['a byte order mark', '﻿'],
    ['an ideographic space', '　'],
    ['a zero-width space', '​'],
    ['a zero-width non-joiner and joiner', '‌‍'],
    ['a word joiner', '⁠'],
    ['a soft hyphen', '­'],
    ['direction marks', '‎‏'],
    ['a bidi override and isolate', '‮⁦⁩'],
  ])('finds no text of its own in %s', (_name, text) => {
    const ed = mount();
    expect(pasteHasOwnText(pasteEvent({ html: `<p>${text}</p>` }), text === '' ? Slice.empty : textSlice(ed, text))).toBe(false);
  });

  it.each([
    ['a letter', 'a'], ['a digit', '1'], ['an emoji', '\u{1F600}'], ['a braille blank', '⠀'], ['punctuation', '.'],
  ])('finds text of its own in %s', (_name, text) => {
    const ed = mount();
    expect(pasteHasOwnText(pasteEvent({ html: `<p>${text}</p>` }), textSlice(ed, text))).toBe(true);
  });

  it('does not count alt attributes, only text nodes', () => {
    const ed = mount();
    expect(pasteHasOwnText(pasteEvent({ html: '' }), sliceOf(ed, '<img src="https://example.com/a.png" alt="A picture">'))).toBe(false);
  });

  it('does not count alt text left in place of removed images', () => {
    const ed = mount();
    const event = pasteEvent({ html: '<p>A B</p>' });
    expect(pasteHasOwnText(event, textSlice(ed, 'A B'), { imageStandIns: ['A', 'B'] })).toBe(false);
    expect(pasteHasOwnText(event, textSlice(ed, 'A B extra'), { imageStandIns: ['A', 'B'] })).toBe(true);
    expect(pasteHasOwnText(event, textSlice(ed, 'B A'), { imageStandIns: ['A', 'B'] })).toBe(true);
    expect(pasteHasOwnText(event, textSlice(ed, 'A'), { imageStandIns: ['A', ''] })).toBe(false);
    expect(pasteHasOwnText(event, textSlice(ed, 'A'), { imageStandIns: [] })).toBe(true);
  });

  it('treats a plain-text clipboard that names its image files as a file copy', () => {
    const ed = mount();
    const one = [png('photo.png')];
    const two = [png('a.png'), png('b.png')];
    expect(pasteHasOwnText(pasteEvent({ text: 'photo.png', files: one }), textSlice(ed, 'photo.png'))).toBe(false);
    expect(pasteHasOwnText(pasteEvent({ text: 'a.png\r\nb.png\n', files: two }), textSlice(ed, 'a.png b.png'))).toBe(false);
    // Another line, a path, another order, HTML or no file keeps the text.
    expect(pasteHasOwnText(pasteEvent({ text: 'a.png\nb.png\nc', files: two }), textSlice(ed, 'a.png b.png c'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ text: '/home/me/photo.png', files: one }), textSlice(ed, '/home/me/photo.png'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ text: 'b.png\na.png', files: two }), textSlice(ed, 'b.png a.png'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ html: '<p>photo.png</p>', text: 'photo.png', files: one }), textSlice(ed, 'photo.png'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ text: 'photo.png' }), textSlice(ed, 'photo.png'))).toBe(true);
  });
});

describe('pasteClipboardImageFiles', () => {
  function withDestination(insertFiles?: (insertion: ClipboardImageFileInsertion) => boolean): { ed: Editor; dispose: () => void } {
    const ed = mount();
    const dispose = registerClipboardImageDestination(ed.view, () => policy, insertFiles);
    return { ed, dispose };
  }

  it('hands every image file in clipboard order to the destination when the content has no text', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const files = [png('a.png'), png('b.gif', 'image/gif')];

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html: '<meta charset="utf-8">', files }), Slice.empty)).toBe(true);

    expect(insert).toHaveBeenCalledExactlyOnceWith({ files });
  });

  it('gives one file the alt text of the one image the content held', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const file = png();
    const html = '<meta charset="utf-8"><img src="https://example.com/a.png" alt="A cat">';

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html, files: [file] }), sliceOf(ed, html))).toBe(true);

    expect(insert).toHaveBeenCalledExactlyOnceWith({ files: [file], alt: 'A cat' });
  });

  it.each([
    ['two images', '<img src="https://example.com/a.png" alt="A"><img src="https://example.com/b.png" alt="B">', undefined, 1],
    ['an image without alt', '<img src="https://example.com/a.png">', undefined, 1],
    ['an image with an empty alt', '<img src="https://example.com/a.png" alt="">', undefined, 1],
    ['one image and two files', '<img src="https://example.com/a.png" alt="A">', undefined, 2],
  ])('gives no alt text for %s', (_name, html, _alt, count) => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const files = Array.from({ length: count }, (_, index) => png(`${String(index)}.png`));
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html, files }), sliceOf(ed, html))).toBe(true);
    expect(insert).toHaveBeenCalledExactlyOnceWith({ files });
  });

  it('gives one file the alt text a handler left in place of the one image it removed', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const file = png();

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html: '<p>A cat</p>', files: [file] }), textSlice(ed, 'A cat'), { imageStandIns: ['A cat'] })).toBe(true);
    expect(insert).toHaveBeenLastCalledWith({ files: [file], alt: 'A cat' });

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html: '<p>A B</p>', files: [file] }), textSlice(ed, 'A B'), { imageStandIns: ['A', 'B'] })).toBe(true);
    expect(insert).toHaveBeenLastCalledWith({ files: [file] });
  });

  it('keeps the content, and hands over nothing, when it has text of its own', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const html = '<p>Caption</p><img src="https://example.com/a.png" alt="A">';

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html, files: [png()] }), sliceOf(ed, html))).toBe(false);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ text: 'Hello', files: [png()] }), textSlice(ed, 'Hello'))).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns false without an image file, and ignores other files', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html: '' }), Slice.empty)).toBe(false);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ files: [new File(['%PDF'], 'a.pdf', { type: 'application/pdf' })] }), Slice.empty)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('reads file items once, skips a null file and repeats, and takes the item type for an untyped file', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const file = png();
    const untyped = new File(['bytes'], 'screenshot', { type: '' });
    const getAsFile = vi.fn(() => file);
    const items: Item[] = [
      { kind: 'file', type: 'image/png', getAsFile },
      { kind: 'file', type: 'image/png', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => file },
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => untyped },
    ];

    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ items, files: [file] }), Slice.empty)).toBe(true);

    expect(getAsFile).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledExactlyOnceWith({ files: [file, untyped] });
  });

  it('reads files when the clipboard has no items', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const file = png();
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ files: [file], items: null }), Slice.empty)).toBe(true);
    expect(insert).toHaveBeenCalledExactlyOnceWith({ files: [file] });
  });

  it('leaves the files alone when a handler already took the paste\'s assets', () => {
    const insert = vi.fn(() => true);
    const { ed } = withDestination(insert);
    const event = pasteEvent({ files: [png()] });
    setClipboardPasteBehavior(ed.view, event, { assetsAlreadyHandled: true });
    expect(pasteClipboardImageFiles(ed.view, event, Slice.empty)).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('returns false without a destination, with one that inserts no files, when it declines or throws', () => {
    const ed = mount();
    const event = pasteEvent({ files: [png()] });
    expect(pasteClipboardImageFiles(ed.view, event, Slice.empty)).toBe(false);
    const disposeReader = registerClipboardImageDestination(ed.view, () => policy);
    expect(pasteClipboardImageFiles(ed.view, event, Slice.empty)).toBe(false);
    disposeReader();
    const disposeDecline = registerClipboardImageDestination(ed.view, () => policy, () => false);
    expect(pasteClipboardImageFiles(ed.view, event, Slice.empty)).toBe(false);
    disposeDecline();
    registerClipboardImageDestination(ed.view, () => policy, () => { throw new Error('insertion failed'); });
    expect(pasteClipboardImageFiles(ed.view, event, Slice.empty)).toBe(false);
  });

  it('asks only the latest destination, and an earlier one again once the latest is disposed', () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => true);
    const { ed } = withDestination(older);
    const dispose = registerClipboardImageDestination(ed.view, () => ({ ...policy, policyVersion: 'newer' }), newer);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ files: [png()] }), Slice.empty)).toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();
    dispose();
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ files: [png()] }), Slice.empty)).toBe(true);
    expect(older).toHaveBeenCalledTimes(1);
  });

  it('gives way when the latest destination inserts no files, even if an earlier one would', () => {
    const older = vi.fn(() => true);
    const { ed } = withDestination(older);
    registerClipboardImageDestination(ed.view, () => policy);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ files: [png()] }), Slice.empty)).toBe(false);
    expect(older).not.toHaveBeenCalled();
  });
});
