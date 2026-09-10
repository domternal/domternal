/**
 * Inserting image files: pasted, dropped and chosen files take one path. Every accepted file gets
 * a placeholder, the images land in the order the files came however their stores finish, a block
 * image moves out of a textblock's start or end instead of splitting it, and nothing is stored as
 * a data URL when allowBase64 is false and there is no uploadHandler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockquote, BulletList, CodeBlock, Document, Editor, History, ListItem, Paragraph, Text } from '@domternal/core';
import { NodeSelection, TextSelection } from '@domternal/pm/state';
import { Image } from './Image.js';
import type { ImageOptions } from './Image.js';
import { imageUploadPluginKey } from './imageUploadPlugin.js';

let editor: Editor | undefined;
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function mount(options: Partial<ImageOptions> = {}, content = '<p>Hello</p>'): Editor {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, History, BulletList, ListItem, Blockquote, CodeBlock, Image.configure(options)],
    content,
  });
  return editor;
}

const png = (name: string, type = 'image/png', size = 8): File => new File([new Uint8Array(size)], name, { type });

/** A deferred upload per file, settled by the test in any order. */
function uploads(): { handler: (file: File) => Promise<string>; resolve: (name: string, src?: string) => void; reject: (name: string, error: Error) => void; started: string[] } {
  const pending = new Map<string, { resolve: (src: string) => void; reject: (error: Error) => void }>();
  const started: string[] = [];
  return {
    started,
    handler: file => new Promise<string>((resolve, reject) => { started.push(file.name); pending.set(file.name, { resolve, reject }); }),
    resolve: (name, src = `https://cdn.example/${name}`) => { pending.get(name)?.resolve(src); },
    reject: (name, error) => { pending.get(name)?.reject(error); },
  };
}

/** Pastes files with no HTML and no text, as a screenshot or a file copy does. */
function pasteFiles(target: Editor, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: ['Files'], files,
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: () => '',
    },
  });
  target.view.dom.dispatchEvent(event);
  return event;
}

function dropFiles(target: Editor, files: File[], pos: number): DragEvent {
  vi.spyOn(target.view, 'posAtCoords').mockReturnValue({ pos, inside: -1 });
  const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), getData: () => '', dropEffect: 'none' },
  });
  Object.defineProperty(event, 'clientX', { value: 1 });
  Object.defineProperty(event, 'clientY', { value: 1 });
  target.view.dom.dispatchEvent(event);
  return event;
}

function caret(target: Editor, pos: number): void {
  target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, pos)));
}

const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
const placeholders = (target: Editor): number => imageUploadPluginKey.getState(target.state)?.find().length ?? 0;
const html = (target: Editor): string => target.getHTML();

describe('image files: order and uploads', () => {
  it('inserts every pasted file in clipboard order, however the uploads finish', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler });
    caret(ed, 6);

    const event = pasteFiles(ed, [png('1.png'), png('2.png'), png('3.png')]);

    expect(event.defaultPrevented).toBe(true);
    expect(upload.started).toEqual(['1.png', '2.png', '3.png']);
    expect(placeholders(ed)).toBe(3);
    upload.resolve('3.png');
    upload.resolve('1.png');
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/1.png">');
    upload.resolve('2.png');
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/1.png"><img src="https://cdn.example/2.png"><img src="https://cdn.example/3.png">');
    expect(placeholders(ed)).toBe(0);
  });

  it('skips a failed upload, reports it, and keeps the others in order', async () => {
    const upload = uploads();
    const onUploadError = vi.fn();
    const ed = mount({ uploadHandler: upload.handler, onUploadError });
    caret(ed, 6);
    const files = [png('1.png'), png('2.png'), png('3.png')];

    pasteFiles(ed, files);
    upload.resolve('3.png');
    const failure = new Error('network');
    upload.reject('2.png', failure);
    upload.resolve('1.png');
    await flush();

    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/1.png"><img src="https://cdn.example/3.png">');
    expect(onUploadError).toHaveBeenCalledExactlyOnceWith(failure, files[1]);
    expect(placeholders(ed)).toBe(0);
  });

  it('calls onUploadStart for every accepted file when uploading, and never without an uploadHandler', async () => {
    const upload = uploads();
    const onUploadStart = vi.fn();
    const ed = mount({ uploadHandler: upload.handler, onUploadStart, maxFileSize: 32 });
    const files = [png('1.png'), png('big.png', 'image/png', 64), png('doc.pdf', 'application/pdf')];
    pasteFiles(ed, files);
    expect(onUploadStart).toHaveBeenCalledExactlyOnceWith(files[0]);

    const reader = mount({ onUploadStart });
    onUploadStart.mockClear();
    pasteFiles(reader, [png('a.png')]);
    await vi.waitFor(() => { expect(reader.getHTML()).toContain('data:image/png;base64,'); });
    expect(onUploadStart).not.toHaveBeenCalled();
  });

  it('reads every pasted file as a data URL behind a placeholder, in order, without an uploadHandler', async () => {
    const ed = mount();
    caret(ed, 6);

    pasteFiles(ed, [png('a.png'), png('b.gif', 'image/gif')]);

    expect(placeholders(ed)).toBe(2);
    await vi.waitFor(() => { expect(ed.view.dom.querySelectorAll('img')).toHaveLength(2); });
    const sources = Array.from(ed.view.dom.querySelectorAll('img'), img => img.getAttribute('src'));
    expect(sources[0]).toMatch(/^data:image\/png;base64,/);
    expect(sources[1]).toMatch(/^data:image\/gif;base64,/);
    expect(ed.state.doc.childCount).toBe(3);
  });

  it('reports a file that cannot be read to onUploadError and inserts nothing for it', async () => {
    const onUploadError = vi.fn();
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      queueMicrotask(() => { this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>); });
    });
    const ed = mount({ onUploadError });
    const file = png('broken.png');

    pasteFiles(ed, [file]);
    await flush();

    expect(onUploadError).toHaveBeenCalledExactlyOnceWith(expect.any(Error), file);
    expect(ed.view.dom.querySelectorAll('img')).toHaveLength(0);
    expect(placeholders(ed)).toBe(0);
  });

  it('refuses a source the uploadHandler returns that setImage would refuse', async () => {
    const onUploadError = vi.fn();
    const ed = mount({ uploadHandler: () => Promise.resolve('javascript:alert(1)'), onUploadError });
    const file = png('a.png');

    pasteFiles(ed, [file]);
    await flush();

    expect(ed.view.dom.querySelectorAll('img')).toHaveLength(0);
    expect(onUploadError).toHaveBeenCalledExactlyOnceWith(expect.any(RangeError), file);
  });

  it('drops the image of a placeholder the user deleted, without an error', async () => {
    const upload = uploads();
    const onUploadError = vi.fn();
    const ed = mount({ uploadHandler: upload.handler, onUploadError }, '<p>Hello</p><p>World</p>');
    caret(ed, 3);
    pasteFiles(ed, [png('a.png')]);
    ed.view.dispatch(ed.state.tr.delete(1, 6));

    upload.resolve('a.png');
    await flush();

    expect(ed.view.dom.querySelectorAll('img')).toHaveLength(0);
    expect(onUploadError).not.toHaveBeenCalled();
  });

  it('inserts nothing and does not throw when the editor is destroyed during an upload', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler });
    pasteFiles(ed, [png('a.png')]);
    ed.destroy();

    upload.resolve('a.png');
    await expect(flush()).resolves.toBeUndefined();
  });

  it('makes an image that lands more than half a second after the paste its own undo step, as the history groups by time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const upload = uploads();
      const ed = mount({ uploadHandler: upload.handler }, '<p>Hello</p>');
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, 6)));
      pasteFiles(ed, [png('a.png'), png('b.png')]);
      upload.resolve('a.png');
      await flush();
      vi.setSystemTime(Date.now() + 600);
      upload.resolve('b.png');
      await flush();
      expect(html(ed)).toBe('<img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png">');

      // The later image is one step; the replaced text and the first image are the next.
      expect(ed.commands.undo()).toBe(true);
      expect(html(ed)).toBe('<img src="https://cdn.example/a.png">');
      expect(ed.commands.undo()).toBe(true);
      expect(html(ed)).toBe('<p>Hello</p>');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the text a paste replaced deleted until undone when every upload fails', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<p>Hello</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1, 6)));
    pasteFiles(ed, [png('a.png')]);
    upload.reject('a.png', new Error('network'));
    await flush();
    expect(html(ed)).toBe('<p></p>');
    expect(ed.commands.undo()).toBe(true);
    expect(html(ed)).toBe('<p>Hello</p>');
  });

  it('undoes the images of one paste together, back to the text before it', async () => {
    const ed = mount();
    caret(ed, 6);
    pasteFiles(ed, [png('a.png'), png('b.png')]);
    await vi.waitFor(() => { expect(ed.view.dom.querySelectorAll('img')).toHaveLength(2); });

    expect(ed.commands.undo()).toBe(true);

    expect(html(ed)).toBe('<p>Hello</p>');
  });
});

describe('image files: placement', () => {
  it.each([
    ['at the start of a paragraph', '<p>Hello</p>', 1, '<img src="https://cdn.example/a.png"><p>Hello</p>'],
    ['in the middle of a paragraph', '<p>Hello</p>', 3, '<p>He</p><img src="https://cdn.example/a.png"><p>llo</p>'],
    ['at the end of a paragraph', '<p>Hello</p>', 6, '<p>Hello</p><img src="https://cdn.example/a.png">'],
    ['in an empty paragraph between others', '<p>A</p><p></p><p>B</p>', 4, '<p>A</p><img src="https://cdn.example/a.png"><p>B</p>'],
    ['at the end of a list item', '<ul><li><p>Item</p></li></ul>', 7, '<ul><li><p>Item</p><img src="https://cdn.example/a.png"></li></ul>'],
    ['at the end of a quoted paragraph', '<blockquote><p>Quote</p></blockquote>', 7, '<blockquote><p>Quote</p><img src="https://cdn.example/a.png"></blockquote>'],
  ])('places a block image %s without empty paragraphs', async (_name, content, pos, expected) => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, content);
    caret(ed, pos);

    pasteFiles(ed, [png('a.png')]);
    await flush();

    expect(html(ed)).toBe(expected);
  });

  it('places two images of one paste after each other at the start of a paragraph', async () => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) });
    caret(ed, 1);
    pasteFiles(ed, [png('a.png'), png('b.png')]);
    await flush();
    expect(html(ed)).toBe('<img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png"><p>Hello</p>');
  });

  it('places inline images at the caret, in order', async () => {
    const ed = mount({ inline: true, uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) });
    caret(ed, 3);
    pasteFiles(ed, [png('a.png'), png('b.png')]);
    await flush();
    expect(html(ed)).toBe('<p>He<img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png">llo</p>');
  });

  it('replaces the selected text, and a selected image, with the pasted images', async () => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, '<p>Hello world</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6, 12)));
    pasteFiles(ed, [png('a.png')]);
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/a.png">');

    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, 7)));
    pasteFiles(ed, [png('b.png')]);
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/b.png">');
  });
});

describe('image files: drop', () => {
  it('inserts every dropped file in order at the drop position', async () => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, '<p>A</p><p>B</p>');

    const event = dropFiles(ed, [png('1.png'), png('2.png')], 3);
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(html(ed)).toBe('<p>A</p><img src="https://cdn.example/1.png"><img src="https://cdn.example/2.png"><p>B</p>');
  });

  it('keeps the drop position through an edit made before the upload finishes', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<p>A</p><p>B</p>');
    dropFiles(ed, [png('1.png')], 3);
    ed.view.dispatch(ed.state.tr.insertText('New ', 1));

    upload.resolve('1.png');
    await flush();

    expect(html(ed)).toBe('<p>New A</p><img src="https://cdn.example/1.png"><p>B</p>');
  });

  it('reads every dropped file without an uploadHandler', async () => {
    const ed = mount({}, '<p>A</p>');
    dropFiles(ed, [png('1.png'), png('2.png')], 3);
    await vi.waitFor(() => { expect(ed.view.dom.querySelectorAll('img')).toHaveLength(2); });
  });
});

describe('image files: allowBase64 false without an uploadHandler', () => {
  it('stores no file from a paste or drop, and takes the event so the browser inserts nothing either', async () => {
    const readFile = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const ed = mount({ allowBase64: false });
    const before = ed.getHTML();

    expect(pasteFiles(ed, [png('a.png')]).defaultPrevented).toBe(true);
    expect(dropFiles(ed, [png('b.png')], 1).defaultPrevented).toBe(true);
    await flush();

    expect(readFile).not.toHaveBeenCalled();
    expect(ed.getHTML()).toBe(before);
    expect(JSON.stringify(ed.getJSON())).not.toContain('data:');
  });

  it('hides the popover file button, and shows it with an uploadHandler or allowBase64', () => {
    const browse = (target: Editor): HTMLButtonElement | null => {
      // jsdom lays out no text, so the popover is anchored to a fixed caret rectangle.
      vi.spyOn(target.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
      (target as unknown as { emit: (event: string, data: object) => void }).emit('insertImage', {});
      return document.querySelector<HTMLButtonElement>('.dm-image-popover-browse');
    };
    expect(browse(mount({ allowBase64: false }))?.hidden).toBe(true);
    editor?.destroy();
    expect(browse(mount({ allowBase64: false, uploadHandler: () => Promise.resolve('https://cdn.example/a.png') }))?.hidden).toBe(false);
    editor?.destroy();
    expect(browse(mount())?.hidden).toBe(false);
  });
});

describe('image files: accepted types and sizes', () => {
  it('skips a file of a type or size the configuration refuses, and inserts the others', async () => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`), allowedMimeTypes: ['image/png'], maxFileSize: 16 });
    caret(ed, 6);
    pasteFiles(ed, [png('big.png', 'image/png', 32), png('a.gif', 'image/gif'), png('ok.png')]);
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/ok.png">');
  });

  it('leaves a paste whose files it refuses all to the default handling', () => {
    const ed = mount({ allowedMimeTypes: ['image/png'] });
    const event = pasteFiles(ed, [png('a.gif', 'image/gif')]);
    expect(placeholders(ed)).toBe(0);
    void event;
  });
});

describe('image files: the popover file button', () => {
  it('inserts a chosen file through the same path, behind a placeholder', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler });
    caret(ed, 6);
    // The browse button opens a file input; capture it instead of a native file dialog.
    const inputs: HTMLInputElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { inputs.push(this); });
    vi.spyOn(ed.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    (ed as unknown as { emit: (event: string, data: object) => void }).emit('insertImage', {});
    document.querySelector<HTMLButtonElement>('.dm-image-popover-browse')?.click();
    const input = inputs.find(element => element.type === 'file');
    if (!input) throw new Error('No file input');
    Object.defineProperty(input, 'files', { value: [png('chosen.png')] });
    input.dispatchEvent(new Event('change'));

    expect(placeholders(ed)).toBe(1);
    upload.resolve('chosen.png');
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/chosen.png">');
  });
});

describe('image files: what is not taken', () => {
  function pasteWith(target: Editor, items: { kind: string; type: string; getAsFile: () => File | null }[], text = ''): ClipboardEvent {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { types: text === '' ? ['Files'] : ['text/plain', 'Files'], files: [], items, getData: (type: string) => (type === 'text/plain' ? text : '') },
    });
    target.view.dom.dispatchEvent(event);
    return event;
  }

  it('leaves a paste of text without files, of non-image files and of empty file items alone', () => {
    const ed = mount();
    caret(ed, 6);
    pasteWith(ed, [], ' world');
    expect(ed.getHTML()).toBe('<p>Hello world</p>');
    pasteWith(ed, [{ kind: 'file', type: 'application/pdf', getAsFile: () => png('a.pdf', 'application/pdf') }]);
    pasteWith(ed, [{ kind: 'file', type: 'image/png', getAsFile: () => null }, { kind: 'string', type: 'text/plain', getAsFile: () => null }]);
    expect(placeholders(ed)).toBe(0);
    expect(ed.getHTML()).toBe('<p>Hello world</p>');
  });

  it('takes a file of any size when maxFileSize is 0', async () => {
    const ed = mount({ maxFileSize: 0, uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) });
    caret(ed, 6);
    pasteFiles(ed, [png('huge.png', 'image/png', 4096)]);
    await flush();
    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/huge.png">');
  });

  it('takes a drop of image files it refuses, so the browser does not open them, and inserts nothing', () => {
    const ed = mount({ allowedMimeTypes: ['image/png'] });
    const before = ed.getHTML();
    const event = dropFiles(ed, [png('a.gif', 'image/gif')], 1);
    expect(event.defaultPrevented).toBe(true);
    expect(placeholders(ed)).toBe(0);
    expect(ed.getHTML()).toBe(before);
  });

  it('leaves a drop without image files to the default handling', () => {
    const ed = mount();
    const event = dropFiles(ed, [png('a.pdf', 'application/pdf')], 1);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('image files: host callbacks that fail', () => {
  function mountReporting(options: Partial<ImageOptions>): { ed: Editor; errors: { error: Error; context: string }[] } {
    const errors: { error: Error; context: string }[] = [];
    editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, History, Image.configure(options)],
      content: '<p>Hello</p>',
      onError: ({ error, context }) => { errors.push({ error, context }); },
    });
    caret(editor, 6);
    return { ed: editor, errors };
  }

  it('places the other images and removes the placeholder when onUploadError throws, and reports the error', async () => {
    const upload = uploads();
    const failure = new Error('host bug');
    const { ed, errors } = mountReporting({ uploadHandler: upload.handler, onUploadError: () => { throw failure; } });

    pasteFiles(ed, [png('a.png'), png('b.png')]);
    upload.resolve('b.png');
    await flush();
    upload.reject('a.png', new Error('network'));
    await flush();

    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/b.png">');
    expect(placeholders(ed)).toBe(0);
    expect(errors).toEqual([{ error: failure, context: 'Image.onUploadError' }]);
  });

  it('still uploads and places the files when onUploadStart throws, and reports the error', async () => {
    const upload = uploads();
    const failure = new Error('host bug');
    const { ed, errors } = mountReporting({ uploadHandler: upload.handler, onUploadStart: () => { throw failure; } });

    pasteFiles(ed, [png('a.png'), png('b.png')]);
    expect(upload.started).toEqual(['a.png', 'b.png']);
    upload.resolve('a.png');
    upload.resolve('b.png');
    await flush();

    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png">');
    expect(errors).toEqual([{ error: failure, context: 'Image.onUploadStart' }, { error: failure, context: 'Image.onUploadStart' }]);
  });

  it('places the source an uploadHandler returns without a promise, as await would read it', async () => {
    const { ed } = mountReporting({ uploadHandler: (() => 'https://cdn.example/sync.png') as unknown as ImageOptions['uploadHandler'] });

    pasteFiles(ed, [png('a.png')]);
    await flush();

    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/sync.png">');
    expect(placeholders(ed)).toBe(0);
  });

  it('reports an uploadHandler that returns no source, or throws before returning, and removes its placeholder', async () => {
    const onUploadError = vi.fn();
    const thrown = new Error('not signed in');
    const files = [png('none.png'), png('throws.png'), png('ok.png')];
    const { ed } = mountReporting({
      onUploadError,
      uploadHandler: ((file: File) => {
        if (file.name === 'none.png') return undefined;
        if (file.name === 'throws.png') throw thrown;
        return Promise.resolve(`https://cdn.example/${file.name}`);
      }) as unknown as ImageOptions['uploadHandler'],
    });

    pasteFiles(ed, files);
    await flush();

    expect(html(ed)).toBe('<p>Hello</p><img src="https://cdn.example/ok.png">');
    expect(onUploadError).toHaveBeenCalledTimes(2);
    expect(onUploadError).toHaveBeenCalledWith(expect.any(RangeError), files[0]);
    expect(onUploadError).toHaveBeenCalledWith(thrown, files[1]);
    expect(placeholders(ed)).toBe(0);
  });
});

describe('image files: a chosen file goes where setImage puts an image', () => {
  function popover(target: Editor): void {
    vi.spyOn(target.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
    (target as unknown as { emit: (event: string, data: object) => void }).emit('insertImage', {});
  }

  /** Chooses a file through the popover's browse button; returns the file inputs it opened. */
  function choose(target: Editor, file: File): HTMLInputElement[] {
    const inputs: HTMLInputElement[] = [];
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { inputs.push(this); });
    popover(target);
    document.querySelector<HTMLButtonElement>('.dm-image-popover-browse')?.click();
    for (const input of inputs) {
      Object.defineProperty(input, 'files', { value: [file] });
      input.dispatchEvent(new Event('change'));
    }
    click.mockRestore();
    return inputs;
  }

  /** Inserts an address through the popover's URL field, which runs setImage. */
  function applyUrl(target: Editor, src: string): void {
    popover(target);
    const input = document.querySelector<HTMLInputElement>('.dm-image-popover-input');
    if (!input) throw new Error('No URL field');
    input.value = src;
    document.querySelector<HTMLButtonElement>('.dm-image-popover-apply')?.click();
  }

  const src = 'https://cdn.example/chosen.png';

  it.each([
    ['at the end of a list item\'s label', '<ul><li><p>item</p></li><li><p>two</p></li></ul>', 7,
      '<ul><li><p>item</p></li></ul><img src="https://cdn.example/chosen.png"><p></p><ul><li><p>two</p></li></ul>'],
    ['in an empty list item', '<ul><li><p>item</p></li><li><p></p></li></ul>', 11,
      '<ul><li><p>item</p></li></ul><img src="https://cdn.example/chosen.png"><p></p>'],
    ['in the middle of a paragraph', '<p>Hello</p>', 3, '<p>He</p><img src="https://cdn.example/chosen.png"><p>llo</p>'],
  ])('places an uploaded chosen file %s as the URL field does', async (_name, content, pos, expected) => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, content);
    caret(ed, pos);
    expect(choose(ed, png('chosen.png'))).toHaveLength(1);
    upload.resolve('chosen.png', src);
    await flush();
    expect(html(ed)).toBe(expected);
    ed.destroy();

    const byUrl = mount({}, content);
    caret(byUrl, pos);
    applyUrl(byUrl, src);
    expect(html(byUrl)).toBe(expected);
  });

  it('places a chosen file read as a data URL after a list item\'s label at the top level', async () => {
    const ed = mount({}, '<ul><li><p>item</p></li><li><p>two</p></li></ul>');
    caret(ed, 7);
    choose(ed, png('chosen.png'));
    // A widget at a textblock's end brings ProseMirror's separator image, so wait for the document's.
    await vi.waitFor(() => { expect(html(ed)).toContain('<img'); });
    expect(html(ed).replace(/base64,[^"]*/, 'base64,...')).toBe('<ul><li><p>item</p></li></ul><img src="data:image/png;base64,..."><p></p><ul><li><p>two</p></li></ul>');
  });

  it('keeps the caret the user moved while the chosen file was stored', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<ul><li><p>item</p></li></ul><p>other</p>');
    caret(ed, 7);
    choose(ed, png('chosen.png'));
    caret(ed, 12);
    upload.resolve('chosen.png', src);
    await flush();
    expect(html(ed)).toBe('<ul><li><p>item</p></li></ul><img src="https://cdn.example/chosen.png"><p></p><p>other</p>');
    expect(ed.state.selection.$from.parent.textContent).toBe('other');
  });

  it('opens no file dialog in a code block, where the URL field inserts nothing either', () => {
    const ed = mount({ uploadHandler: () => Promise.resolve(src) }, '<pre><code>let a = 1;</code></pre>');
    caret(ed, 5);
    const before = html(ed);
    expect(choose(ed, png('chosen.png'))).toHaveLength(0);
    applyUrl(ed, src);
    expect(html(ed)).toBe(before);
    expect(placeholders(ed)).toBe(0);
  });
});

describe('image files: next to a code block', () => {
  it('places a file pasted or dropped inside a code block after the block instead of splitting the code', async () => {
    const ed = mount({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, '<pre><code>let a = 1;</code></pre><p>after</p>');
    caret(ed, 5);
    pasteFiles(ed, [png('a.png'), png('b.png')]);
    await flush();
    expect(html(ed)).toBe('<pre><code>let a = 1;</code></pre><img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png"><p>after</p>');

    dropFiles(ed, [png('c.png')], 3);
    await flush();
    expect(html(ed)).toBe('<pre><code>let a = 1;</code></pre><img src="https://cdn.example/c.png"><img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png"><p>after</p>');
  });
});

describe('image files: how many one paste or drop inserts', () => {
  const names = (count: number): File[] => Array.from({ length: count }, (_, index) => png(`${String(index + 1)}.png`));
  const sources = (target: Editor): string[] => {
    const found: string[] = [];
    target.state.doc.descendants(node => { if (node.type.name === 'image') found.push(String(node.attrs['src']).split('/').pop() ?? ''); });
    return found;
  };

  it('inserts the first 10 files of a paste by default, in order, and leaves the others out', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler });
    caret(ed, 6);
    pasteFiles(ed, names(12));
    expect(upload.started).toEqual(names(10).map(file => file.name));
    for (const name of upload.started) upload.resolve(name);
    await flush();
    expect(sources(ed)).toEqual(names(10).map(file => file.name));
    expect(placeholders(ed)).toBe(0);
  });

  it('reads at most maxFiles files as data URLs, and counts only files it accepts', async () => {
    const ed = mount({ maxFiles: 2, allowedMimeTypes: ['image/png'] });
    caret(ed, 6);
    pasteFiles(ed, [png('a.gif', 'image/gif'), png('1.png'), png('2.png'), png('3.png')]);
    await vi.waitFor(() => { expect(ed.getHTML().match(/<img/g)).toHaveLength(2); });
    await flush();
    expect(ed.getHTML().match(/<img/g)).toHaveLength(2);
  });

  it('applies maxFiles to a drop, and inserts every file with maxFiles 0', async () => {
    const limited = mount({ maxFiles: 1, uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, '<p>A</p>');
    dropFiles(limited, names(3), 3);
    await flush();
    expect(sources(limited)).toEqual(['1.png']);
    limited.destroy();

    const unlimited = mount({ maxFiles: 0, uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) });
    caret(unlimited, 6);
    pasteFiles(unlimited, names(25));
    await flush();
    expect(sources(unlimited)).toHaveLength(25);
  });
});
