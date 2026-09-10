/**
 * PasteCleanup and the clipboard's image files. The cleaned content decides, with Core's rule:
 * when cleanup leaves no text of its own, only whitespace, format characters or the alt text it
 * put in place of images it removed, the clipboard's image files are the paste. Without image
 * assets the Image inserts them; with image assets the coordinator prepares them. A paste that
 * cleanup rejects never reaches the files.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { Image } from '../../extension-image/dist/index.js';
import type { ImageOptions } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { PasteOperationResult } from './operations.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const REMOTE = 'https://example.com/cat.png';
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  editors.length = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function png(name = 'shot.png'): File {
  const bytes = Uint8Array.from(atob(PNG_BASE64), character => character.charCodeAt(0));
  const file = new File([bytes], name, { type: 'image/png' });
  // JSDOM File lacks arrayBuffer in some versions; the embedded asset route reads it.
  Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(bytes.buffer), configurable: false, writable: false });
  return file;
}

interface Fixture {
  editor: Editor;
  completed: Mock<(result: PasteOperationResult) => void>;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  host: HTMLElement;
}

function mount(cleanup: PasteCleanupOptions = {}, image: Partial<ImageOptions> | false = { uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) }, extra: NonNullable<EditorOptions['extensions']> = []): Fixture {
  const completed = vi.fn();
  const normalized = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const editor = new Editor({
    element: host,
    content: '<p></p>',
    extensions: [Document, Paragraph, Text, ...(image === false ? [] : [Image.configure(image)]),
      PasteCleanup.configure({ ...cleanup, onPasteResult: completed, onResult: normalized }), ...extra],
  });
  editors.push(editor);
  // jsdom lays out no text: the paste notice is placed against a fixed caret rectangle.
  vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });
  editor.commands.focus('start');
  return { editor, completed, normalized, host };
}

function paste(editor: Editor, clipboard: { html?: string; text?: string; files?: File[] }): ClipboardEvent {
  const files = clipboard.files ?? [];
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [...(clipboard.html === undefined ? [] : ['text/html']), ...(clipboard.text === undefined ? [] : ['text/plain']), ...(files.length > 0 ? ['Files'] : [])],
      files,
      items: [...(clipboard.html === undefined ? [] : [{ kind: 'string', type: 'text/html', getAsFile: () => null }]),
        ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))],
      getData: (type: string) => (type === 'text/html' ? clipboard.html ?? '' : type === 'text/plain' ? clipboard.text ?? '' : ''),
    },
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

async function settled(fixture: Fixture): Promise<PasteOperationResult | undefined> {
  for (let attempt = 0; attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  return fixture.completed.mock.calls.at(-1)?.[0];
}

const images = (editor: Editor): { src: unknown; alt: unknown }[] => {
  const found: { src: unknown; alt: unknown }[] = [];
  editor.state.doc.descendants(node => { if (node.type.name === 'image') found.push({ src: node.attrs['src'], alt: node.attrs['alt'] }); });
  return found;
};
const text = (editor: Editor): string => {
  let value = '';
  editor.state.doc.descendants(node => { if (node.isText) value += node.text ?? ''; });
  return value;
};

describe('PasteCleanup without image assets', () => {
  it.each([
    ['a copied web image with alt text', `<meta charset="utf-8"><img src="${REMOTE}" alt="A cat">`, 'A cat'],
    ['a copied local image with alt text', '<img src="file:///C:/Users/me/cat.png" alt="A cat">', 'A cat'],
    ['a blob image', '<img src="blob:https://example.com/1234">', null],
    ['a meta element only', '<meta charset="utf-8">', null],
    ['white space only', '<p> </p>', null],
    ['a no-break space only', '<p>&nbsp;</p>', null],
    ['zero-width characters only', '<p>\u200b\u200d</p>', null],
  ])('inserts the file for %s, keeping one image\'s alt text', async (_name, html, alt) => {
    const fixture = mount();
    const event = paste(fixture.editor, { html, files: [png()] });
    const result = await settled(fixture);
    expect(event.defaultPrevented).toBe(true);
    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/shot.png', alt }]);
    expect(text(fixture.editor).replace(/[\s\u200b\u200d]/g, '')).toBe('');
    expect(result).toMatchObject({ status: 'untracked', diagnostics: [] });
    expect(fixture.host.querySelector('.dm-paste-feedback:not([hidden])')?.textContent ?? '').toBe('');
  });

  it('still reports what cleanup removed to onResult', async () => {
    const fixture = mount();
    paste(fixture.editor, { html: `<img src="${REMOTE}" alt="A cat">`, files: [png()] });
    await settled(fixture);
    expect(fixture.normalized.mock.calls[0]?.[0].diagnostics.map((diagnostic: { code: string }) => diagnostic.code)).toContain('image-removed');
  });

  it('inserts two files in order without alt text', async () => {
    const fixture = mount();
    paste(fixture.editor, { html: `<img src="${REMOTE}" alt="A">`, files: [png('1.png'), png('2.png')] });
    await settled(fixture);
    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/1.png', alt: null }, { src: 'https://cdn.example/2.png', alt: null }]);
  });

  it('inserts the file for a plain-text clipboard that names it, as a file manager copies it', async () => {
    const fixture = mount();
    paste(fixture.editor, { text: 'shot.png', files: [png()] });
    await settled(fixture);
    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/shot.png', alt: null }]);
    expect(text(fixture.editor)).toBe('');
  });

  it.each([
    ['text next to a removed image', `<p>Caption</p><img src="${REMOTE}" alt="A cat">`, 'CaptionA cat'],
    ['text next to a local image', '<p>Text</p><img src="file:///C:/cat.png" alt="A cat">', 'TextA cat'],
    ['plain text', undefined, 'Hello'],
  ])('keeps the cleaned content of %s and ignores the file', async (_name, html, expected) => {
    const fixture = mount();
    paste(fixture.editor, { ...(html === undefined ? { text: 'Hello' } : { html }), files: [png()] });
    await settled(fixture);
    expect(images(fixture.editor)).toEqual([]);
    expect(text(fixture.editor)).toBe(expected);
  });

  it('never reaches the files of a paste that cleanup rejects', async () => {
    const fixture = mount({ limits: { maxInputLength: 16 } });
    const event = paste(fixture.editor, { html: `<meta charset="utf-8"><img src="${REMOTE}" alt="A cat">`, files: [png()] });
    const result = await settled(fixture);
    expect(event.defaultPrevented).toBe(true);
    expect(images(fixture.editor)).toEqual([]);
    expect(result).toMatchObject({ status: 'rejected' });
  });

  it('pastes the alt text, or nothing, when the Image cannot store the file', async () => {
    const withAlt = mount({}, { allowBase64: false });
    paste(withAlt.editor, { html: `<img src="${REMOTE}" alt="A cat">`, files: [png()] });
    await settled(withAlt);
    expect(images(withAlt.editor)).toEqual([]);
    expect(text(withAlt.editor)).toBe('A cat');

    const without = mount({}, { allowBase64: false });
    paste(without.editor, { html: '<meta charset="utf-8">', files: [png()] });
    await settled(without);
    expect(images(without.editor)).toEqual([]);
    expect(text(without.editor)).toBe('');
  });

  it('pastes the alt text, or nothing, without the Image extension', async () => {
    const fixture = mount({}, false);
    paste(fixture.editor, { html: `<img src="${REMOTE}" alt="A cat">`, files: [png()] });
    await settled(fixture);
    expect(text(fixture.editor)).toBe('A cat');
  });
});

describe('PasteCleanup and dropped image files', () => {
  function drop(editor: Editor, html: string, files: File[]): DragEvent {
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: {
      types: ['text/html', 'Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => (type === 'text/html' ? html : ''), dropEffect: 'none',
    } });
    Object.defineProperty(event, 'clientX', { value: 1 });
    Object.defineProperty(event, 'clientY', { value: 1 });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  it('inserts the dropped file with the alt text cleanup left in place of the one image it removed', async () => {
    const fixture = mount();
    const event = drop(fixture.editor, `<img src="${REMOTE}" alt="A cat">`, [png()]);
    const result = await settled(fixture);
    expect(event.defaultPrevented).toBe(true);
    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/shot.png', alt: 'A cat' }]);
    expect(text(fixture.editor)).toBe('');
    expect(result).toMatchObject({ status: 'untracked', diagnostics: [] });
  });

  it('inserts every dropped file in order over dropped text, without alt text', async () => {
    const fixture = mount();
    drop(fixture.editor, '<p>Dragged text</p>', [png('1.png'), png('2.png')]);
    await settled(fixture);
    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/1.png', alt: null }, { src: 'https://cdn.example/2.png', alt: null }]);
    expect(text(fixture.editor)).toBe('');
  });

  /** Drops files only, as an operating system's file drag carries them: no HTML reaches cleanup. */
  function dropFiles(editor: Editor, files: File[]): DragEvent {
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });
    const event = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: {
      types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: () => '', dropEffect: 'none',
    } });
    Object.defineProperty(event, 'clientX', { value: 1 });
    Object.defineProperty(event, 'clientY', { value: 1 });
    editor.view.dom.dispatchEvent(event);
    return event;
  }

  it('gives a later drop of files alone none of the alt text an earlier drop left in place of an image', async () => {
    const fixture = mount();
    drop(fixture.editor, `<p>See <img src="${REMOTE}" alt="Private caption from the first drop"></p>`, []);
    await settled(fixture);
    expect(text(fixture.editor)).toContain('Private caption from the first drop');
    const first = fixture.completed.mock.calls.length;

    dropFiles(fixture.editor, [png('later.png')]);
    await settled(fixture);

    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/later.png', alt: null }]);
    // The earlier drop's operation is not reported again as replaced by these files.
    expect(fixture.completed.mock.calls.length).toBe(first);
  });

  it('reports a drop whose files replaced HTML that cleanup rejected as untracked, with no blocked notice', async () => {
    const fixture = mount({ limits: { maxInputLength: 64 } });
    drop(fixture.editor, `<p>${'word '.repeat(40)}</p>`, [png()]);
    const result = await settled(fixture);

    expect(images(fixture.editor)).toEqual([{ src: 'https://cdn.example/shot.png', alt: null }]);
    expect(text(fixture.editor)).toBe('');
    expect(result).toMatchObject({ status: 'untracked', diagnostics: [] });
    expect(result).not.toHaveProperty('reason');
    expect(fixture.normalized.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'rejected' });
    expect(document.querySelector('.dm-paste-feedback')?.textContent ?? '').not.toContain('blocked');
  });

  it('still blocks a drop without files whose HTML cleanup rejects', async () => {
    const fixture = mount({ limits: { maxInputLength: 64 } });
    drop(fixture.editor, `<p>${'word '.repeat(40)}</p>`, []);
    const result = await settled(fixture);
    expect(text(fixture.editor)).toBe('');
    expect(result).toMatchObject({ status: 'rejected' });
  });
});

describe('PasteCleanup with image assets', () => {
  const embedded = (unresolved: 'reject' | 'omit' = 'reject'): PasteCleanupOptions => ({ imageAssets: { mode: 'embedded', unresolved } });

  it.each([
    ['white space only', '<p> </p>', null],
    ['a no-break space only', '<p>&nbsp;</p>', null],
    ['a meta element only', '<meta charset="utf-8">', null],
    ['a copied web image with alt text', `<meta charset="utf-8"><img src="${REMOTE}" alt="A cat">`, 'A cat'],
  ])('prepares the file for %s, with one image\'s alt text', async (_name, html, alt) => {
    const fixture = mount(embedded(), {});
    paste(fixture.editor, { html, files: [png()] });
    const result = await settled(fixture);
    expect(result).toMatchObject({ status: 'applied' });
    expect(result?.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('image-removed');
    const found = images(fixture.editor);
    expect(found).toHaveLength(1);
    expect(String(found[0]?.src)).toMatch(/^data:image\/png;base64,/);
    expect(found[0]?.alt).toBe(alt);
  });

  it('keeps rejecting an unbound local image reference, file or not', async () => {
    const fixture = mount(embedded('reject'), {});
    paste(fixture.editor, { html: '<img src="file:///C:/Users/me/cat.png" alt="A cat">', files: [png()] });
    const result = await settled(fixture);
    expect(result).toMatchObject({ status: 'rejected', reason: 'assets-unavailable' });
    expect(images(fixture.editor)).toEqual([]);
  });

  it('keeps text of its own and ignores the file', async () => {
    const fixture = mount(embedded(), {});
    paste(fixture.editor, { html: `<p>Caption</p><img src="${REMOTE}" alt="A cat">`, files: [png()] });
    await settled(fixture);
    expect(images(fixture.editor)).toEqual([]);
    expect(text(fixture.editor)).toBe('CaptionA cat');
  });
});
