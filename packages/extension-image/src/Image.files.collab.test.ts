/**
 * Image files in a shared document. y-prosemirror applies every remote change as one replace of
 * the whole document, so a placeholder of a file that is still being read or uploaded must keep
 * its place through such a replace when the content around it did not change, and the image then
 * reaches every client. Only a change that removes the content on both sides of the placeholder
 * drops its image, as a local deletion does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { ySyncPlugin } from 'y-prosemirror';
import { Document, Editor, Extension, History, Paragraph, Text } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { Image } from './Image.js';
import type { ImageOptions } from './Image.js';
import { imageUploadPluginKey } from './imageUploadPlugin.js';

const REMOTE = 'remote';
const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => { if (!editor.isDestroyed) editor.destroy(); });
  document.body.replaceChildren();
});

interface Client { ydoc: Y.Doc; editor: Editor }

/** Two clients that relay every local Yjs update to each other, as a provider does. */
function network(options: Partial<ImageOptions> = {}): [Client, Client] {
  const clients: Client[] = [];
  for (let index = 0; index < 2; index++) {
    const ydoc = new Y.Doc();
    const sync = Extension.create({ name: 'sync', addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('default'))] });
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, Image.configure(options), sync],
    });
    editors.push(editor);
    const client: Client = { ydoc, editor };
    ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      for (const other of clients) if (other !== client) Y.applyUpdate(other.ydoc, update, REMOTE);
    });
    clients.push(client);
  }
  return clients as [Client, Client];
}

const png = (name: string): File => new File([new Uint8Array(8)], name, { type: 'image/png' });

function pasteFiles(target: Editor, files: File[]): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), getData: () => '' },
  });
  target.view.dom.dispatchEvent(event);
}

/** A deferred upload per file, settled by the test. */
function uploads(): { handler: (file: File) => Promise<string>; resolve: (name: string) => void } {
  const pending = new Map<string, (src: string) => void>();
  return {
    handler: file => new Promise<string>(resolve => { pending.set(file.name, resolve); }),
    resolve: name => { pending.get(name)?.(`https://cdn.example/${name}`); },
  };
}

/** The position just after the first text node with this text. */
function after(editor: Editor, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.isText && node.text === text) found = pos + node.nodeSize;
  });
  if (found === undefined) throw new Error(`No text ${text}`);
  return found;
}

function start(editor: Editor, text: string): number {
  return after(editor, text) - text.length;
}

const html = (client: Client): string => client.editor.getHTML().replace(/base64,[^"]*/g, 'base64,...');
const placeholders = (editor: Editor): number => imageUploadPluginKey.getState(editor.state)?.find().length ?? 0;
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

describe('image files in a shared document', () => {
  it('inserts a pasted file read as a data URL although another client typed while it was read', async () => {
    const [a, b] = network();
    a.editor.commands.setContent('<p>alpha</p><p>beta</p>');
    a.editor.view.dispatch(a.editor.state.tr.setSelection(TextSelection.create(a.editor.state.doc, after(a.editor, 'alpha'))));

    pasteFiles(a.editor, [png('shot.png')]);
    b.editor.view.dispatch(b.editor.state.tr.insertText('!', after(b.editor, 'beta')));

    await vi.waitFor(() => { expect(html(a)).toBe('<p>alpha</p><img src="data:image/png;base64,..."><p>beta!</p>'); });
    expect(html(b)).toBe(html(a));
    expect(placeholders(a.editor)).toBe(0);
  });

  it('inserts an uploaded file at its place after remote edits before and after that place', async () => {
    const upload = uploads();
    const [a, b] = network({ uploadHandler: upload.handler });
    a.editor.commands.setContent('<p>alpha</p><p>beta</p>');
    a.editor.view.dispatch(a.editor.state.tr.setSelection(TextSelection.create(a.editor.state.doc, after(a.editor, 'alpha'))));

    pasteFiles(a.editor, [png('a.png'), png('b.png')]);
    // A remote edit in the paragraph that holds the placeholders, before them, and one after them.
    b.editor.view.dispatch(b.editor.state.tr.insertText('Say ', start(b.editor, 'alpha')));
    b.editor.view.dispatch(b.editor.state.tr.insertText('!', after(b.editor, 'beta')));
    upload.resolve('b.png');
    upload.resolve('a.png');
    await settle();

    expect(html(a)).toBe('<p>Say alpha</p><img src="https://cdn.example/a.png"><img src="https://cdn.example/b.png"><p>beta!</p>');
    expect(html(b)).toBe(html(a));
    expect(placeholders(a.editor)).toBe(0);
  });

  it('drops the image when another client deleted the text around its place, as a local deletion does', async () => {
    const upload = uploads();
    const onUploadError = vi.fn();
    const [a, b] = network({ uploadHandler: upload.handler, onUploadError });
    a.editor.commands.setContent('<p>alpha</p><p>beta</p>');
    a.editor.view.dispatch(a.editor.state.tr.setSelection(TextSelection.create(a.editor.state.doc, start(a.editor, 'alpha') + 2)));

    pasteFiles(a.editor, [png('a.png')]);
    b.editor.view.dispatch(b.editor.state.tr.delete(start(b.editor, 'alpha'), after(b.editor, 'alpha')));
    upload.resolve('a.png');
    await settle();

    expect(html(a)).toBe('<p></p><p>beta</p>');
    expect(html(b)).toBe(html(a));
    expect(onUploadError).not.toHaveBeenCalled();
    expect(placeholders(a.editor)).toBe(0);
  });
});

describe('image files: what removes a placeholder', () => {
  function mount(options: Partial<ImageOptions>, content: string): Editor {
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, History, Image.configure(options)],
      content,
    });
    editors.push(editor);
    return editor;
  }

  it('keeps a placeholder when the text just before or after it is deleted, and drops it when a deletion spans it', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<p>Hello</p><p>World</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6)));
    pasteFiles(ed, [png('a.png')]);
    // Backspace right after pasting a screenshot deletes the character before the placeholder.
    ed.view.dispatch(ed.state.tr.delete(5, 6));
    upload.resolve('a.png');
    await settle();
    expect(ed.getHTML()).toBe('<p>Hell</p><img src="https://cdn.example/a.png"><p>World</p>');

    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2)));
    pasteFiles(ed, [png('b.png')]);
    ed.view.dispatch(ed.state.tr.delete(1, 4));
    upload.resolve('b.png');
    await settle();
    expect(ed.getHTML()).toBe('<p>l</p><img src="https://cdn.example/a.png"><p>World</p>');
    expect(placeholders(ed)).toBe(0);
  });

  it('drops a placeholder whose document another transaction replaced, such as setContent, even with equal text before it', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<p>Title</p><p>First document</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6)));
    pasteFiles(ed, [png('a.png')]);

    ed.commands.setContent('<p>Title</p><p>Second document</p>');
    upload.resolve('a.png');
    await settle();

    expect(ed.getHTML()).toBe('<p>Title</p><p>Second document</p>');
    expect(placeholders(ed)).toBe(0);
  });

  it('drops a placeholder that a replace of the whole document from another source removes, however equal the content', async () => {
    const upload = uploads();
    const ed = mount({ uploadHandler: upload.handler }, '<p>Hello</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 6)));
    pasteFiles(ed, [png('a.png')]);

    const { doc } = ed.state;
    ed.view.dispatch(ed.state.tr.replace(0, doc.content.size, new Slice(Fragment.from(doc.content), 0, 0)));
    upload.resolve('a.png');
    await settle();

    expect(ed.getHTML()).toBe('<p>Hello</p>');
  });
});
