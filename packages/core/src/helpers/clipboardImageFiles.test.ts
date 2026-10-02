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
import { dropClipboardImageFiles, pasteClipboardImageFiles, pasteHasOwnText, registerClipboardImageDestination, setClipboardPasteBehavior } from '../clipboard.js';
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
    // Another line, another order, HTML or no file keeps the text.
    expect(pasteHasOwnText(pasteEvent({ text: 'a.png\nb.png\nc', files: two }), textSlice(ed, 'a.png b.png c'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ text: 'b.png\na.png', files: two }), textSlice(ed, 'b.png a.png'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ html: '<p>photo.png</p>', text: 'photo.png', files: one }), textSlice(ed, 'photo.png'))).toBe(true);
    expect(pasteHasOwnText(pasteEvent({ text: 'photo.png' }), textSlice(ed, 'photo.png'))).toBe(true);
  });
});

describe('pasteHasOwnText with names a file manager writes', () => {
  it('matches a name written in another Unicode normalization form, as macOS writes accented names', () => {
    const ed = mount();
    const nfc = 'Capture d\u2019\u00e9cran caf\u00e9.png';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(pasteHasOwnText(pasteEvent({ text: nfd, files: [png(nfc)] }), textSlice(ed, nfd))).toBe(false);
    expect(pasteHasOwnText(pasteEvent({ text: nfc, files: [png(nfd)] }), textSlice(ed, nfc))).toBe(false);
  });

  it('matches a path or file URL by the name at its end', () => {
    const ed = mount();
    const one = [png('f0.png')];
    for (const text of ['/Users/me/Desktop/f0.png', 'C:\\Users\\me\\f0.png', 'file:///home/me/f0.png']) {
      expect(pasteHasOwnText(pasteEvent({ text, files: one }), textSlice(ed, text)), text).toBe(false);
    }
    const accented = [png('caf\u00e9 1.png')];
    expect(pasteHasOwnText(pasteEvent({ text: 'file:///home/me/caf%C3%A9%201.png', files: accented }), textSlice(ed, 'x'))).toBe(false);
  });

  it('keeps text whose name only resembles the file, or a path to another name', () => {
    const ed = mount();
    const one = [png('f0.png')];
    for (const text of ['/Users/me/f0.png.txt', '/Users/me/other.png', 'see f0.png', 'file:///home/me/%E0%A4%A.png', 'f0',
      'https://example.com/f0.png', 'docs/f0.png']) {
      expect(pasteHasOwnText(pasteEvent({ text, files: one }), textSlice(ed, text)), text).toBe(true);
    }
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

describe('dropClipboardImageFiles', () => {
  function drop(files: File[], html = ''): DragEvent {
    const event = new Event('drop', { cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: {
      types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => (type === 'text/html' ? html : ''),
    } });
    Object.defineProperty(event, 'clientX', { value: 3 });
    Object.defineProperty(event, 'clientY', { value: 4 });
    return event;
  }

  it('hands every dropped image file to the destination at the drop position, text or not', () => {
    const insert = vi.fn(() => true);
    const ed = mount();
    registerClipboardImageDestination(ed.view, () => policy, insert);
    const at = vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const files = [png('a.png'), png('b.png')];

    expect(dropClipboardImageFiles(ed.view, drop(files, '<p>Dragged text</p>'), sliceOf(ed, '<p>Dragged text</p>'))).toBe(true);

    expect(at).toHaveBeenCalledWith({ left: 3, top: 4 });
    expect(insert).toHaveBeenCalledExactlyOnceWith({ files, position: 1 });
  });

  it('gives one dropped file the alt text of the one image, or of the one stand-in, the drop held', () => {
    const insert = vi.fn(() => true);
    const ed = mount();
    registerClipboardImageDestination(ed.view, () => policy, insert);
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const file = png();
    const html = '<img src="https://example.com/a.png" alt="A cat">';

    dropClipboardImageFiles(ed.view, drop([file], html), sliceOf(ed, html));
    expect(insert).toHaveBeenLastCalledWith({ files: [file], position: 1, alt: 'A cat' });
    dropClipboardImageFiles(ed.view, drop([file]), textSlice(ed, 'A cat'), { imageStandIns: ['A cat'] });
    expect(insert).toHaveBeenLastCalledWith({ files: [file], position: 1, alt: 'A cat' });
  });

  it('hands over no file when a handler removed text the drop held, which a picture of the dragged selection can show', () => {
    const insert = vi.fn(() => true);
    const ed = mount();
    registerClipboardImageDestination(ed.view, () => policy, insert);
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    expect(dropClipboardImageFiles(ed.view, drop([png()], '<p>x</p>'), Slice.empty, { removedText: true })).toBe(false);
    expect(insert).not.toHaveBeenCalled();
    expect(dropClipboardImageFiles(ed.view, drop([png()], '<p>x</p>'), Slice.empty, { removedText: false })).toBe(true);
  });

  it('returns false without image files, a destination, a position, or when the destination declines or throws', () => {
    const ed = mount();
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    expect(dropClipboardImageFiles(ed.view, drop([png()]), Slice.empty)).toBe(false);
    const dispose = registerClipboardImageDestination(ed.view, () => policy, () => false);
    expect(dropClipboardImageFiles(ed.view, drop([]), Slice.empty)).toBe(false);
    expect(dropClipboardImageFiles(ed.view, drop([png()]), Slice.empty)).toBe(false);
    dispose();
    const throwing = registerClipboardImageDestination(ed.view, () => policy, () => { throw new Error('failed'); });
    expect(dropClipboardImageFiles(ed.view, drop([png()]), Slice.empty)).toBe(false);
    throwing();
    registerClipboardImageDestination(ed.view, () => policy, () => true);
    vi.spyOn(ed.view, 'posAtCoords').mockReturnValue(null);
    expect(dropClipboardImageFiles(ed.view, drop([png()]), Slice.empty)).toBe(false);
  });
});

describe('the picture an Office application adds of its selection', () => {
  // Word's raw clipboard HTML as Chrome carries it, with Word's picture of the selection as an image/png file, here
  // for selections without text of their own: two empty paragraphs, an empty table cell, spaces. The links Word
  // writes to its local temporary files are left out.
  const word = (body: string, head = '<meta name=ProgId content=Word.Document>\r\n<meta name=Generator content="Microsoft Word 15">'): string =>
    '<html xmlns:o="urn:schemas-microsoft-com:office:office"\r\nxmlns:w="urn:schemas-microsoft-com:office:word"\r\n'
    + `xmlns="http://www.w3.org/TR/REC-html40">\r\n\r\n<head>\r\n<meta http-equiv=Content-Type content="text/html; charset=utf-8">\r\n${head}\r\n</head>\r\n\r\n`
    + `<body lang=en-HR style='tab-interval:36.0pt;word-wrap:break-word'>\r\n<!--StartFragment-->${body}<!--EndFragment-->\r\n</body>\r\n\r\n</html>`;
  const EMPTY = '\r\n\r\n<p class=MsoNormal><o:p>&nbsp;</o:p></p>\r\n\r\n<p class=MsoNormal><o:p>&nbsp;</o:p></p>\r\n\r\n';
  const CELL = "\r\n\r\n<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'>\r\n <tr>\r\n"
    + "  <td width=200 valign=top style='width:150.25pt;border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'>\r\n"
    + "  <p class=MsoNormal style='margin-bottom:0cm;line-height:normal'><o:p>&nbsp;</o:p></p>\r\n  </td>\r\n </tr>\r\n</table>\r\n\r\n";
  const SPACES = '\r\n<p class=MsoNormal>&nbsp;&nbsp;<o:p></o:p></p>\r\n';
  // A picture Word places: its VML shape in a conditional comment and the downlevel image Chrome and Firefox carry.
  const PICTURE = "\r\n<p class=MsoNormal><!--[if gte vml 1]><v:shape id=\"Picture_x0020_1\" style='width:120pt;height:80pt'>"
    + '<v:imagedata src="clip_image001.png" o:title=""/></v:shape><![endif]--><![if !vml]><img width=160 height=107\r\nsrc="clip_image002.png" v:shapes="Picture_x0020_1"><![endif]><o:p></o:p></p>\r\n';
  const VML = "\r\n<p class=MsoNormal><!--[if gte vml 1]><v:shape id=\"Picture_x0020_1\" style='width:120pt;height:80pt'>"
    + '<v:imagedata src="clip_image001.png" o:title=""/></v:shape><![endif]--><o:p></o:p></p>\r\n';

  it.each([['two empty paragraphs', EMPTY], ['an empty table cell', CELL], ['spaces', SPACES]])('keeps the content of a Word copy of %s, whose file is Word\'s picture of it', (_name, body) => {
    const ed = mount();
    const html = word(body);
    expect(pasteHasOwnText(pasteEvent({ html, text: '\r\n', files: [png()] }), sliceOf(ed, html))).toBe(true);
  });

  it('reads an Excel copy the same way, by its ProgId or its namespace', () => {
    const ed = mount();
    const excel = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head></head><body><table><tr><td></td></tr></table></body></html>';
    for (const html of [excel, '<html><head><meta name=ProgId content=Excel.Sheet></head><body><table><tr><td></td></tr></table></body></html>']) {
      expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), sliceOf(ed, html)), html).toBe(true);
    }
  });

  it.each([['an image Word places', PICTURE], ['a VML picture alone', VML]])('still pastes the files of a Word copy that holds %s, which is the paste', (_name, body) => {
    const ed = mount();
    const html = word(body);
    expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), sliceOf(ed, html))).toBe(false);
  });

  it('still pastes the files of HTML no Word or Excel document wrote, as a copied image or a screenshot', () => {
    for (const html of ['<meta charset="utf-8"><p></p>', '<html><head><meta name=ProgId content=PowerPoint.Slide></head><body><p></p></body></html>',
      // The namespace named in text, not declared on an element.
      '<p>urn:schemas-microsoft-com:office:word</p>']) {
      expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), Slice.empty), html).toBe(false);
    }
  });

  it('takes text a handler removed, such as Word\'s hidden text, as the content\'s own, so the picture that can show it is not the paste', () => {
    const insert = vi.fn(() => true);
    const ed = mount();
    registerClipboardImageDestination(ed.view, () => policy, insert);
    // A copy that places an image, whose hidden text and image a handler left out: the slice holds nothing.
    for (const html of [word(PICTURE), '<p><img src="https://example.com/a.png"></p>']) {
      expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), Slice.empty), html).toBe(false);
      expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), Slice.empty, { removedText: true }), html).toBe(true);
      expect(pasteHasOwnText(pasteEvent({ html, files: [png()] }), textSlice(ed, 'A cat'), { imageStandIns: ['A cat'], removedText: true }), html).toBe(true);
      expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html, files: [png()] }), Slice.empty, { removedText: true }), html).toBe(false);
    }
    expect(insert).not.toHaveBeenCalled();
    expect(pasteHasOwnText(pasteEvent({ html: word(PICTURE), files: [png()] }), Slice.empty, { removedText: false })).toBe(false);
  });

  it('hands no file to the destination for a Word copy without text of its own, and the content stays the paste', () => {
    const insert = vi.fn(() => true);
    const ed = mount();
    registerClipboardImageDestination(ed.view, () => policy, insert);
    const html = word(EMPTY);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html, text: '\r\n\r\n', files: [png('image.png')] }), sliceOf(ed, html))).toBe(false);
    expect(insert).not.toHaveBeenCalled();
    const picture = word(PICTURE);
    expect(pasteClipboardImageFiles(ed.view, pasteEvent({ html: picture, files: [png('image.png')] }), sliceOf(ed, picture))).toBe(true);
    expect(insert).toHaveBeenCalledOnce();
  });
});
