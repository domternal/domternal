/**
 * Pasted image files and the paste placement a node registers through @domternal/core/clipboard,
 * as Details does for its summary: a block image goes where the placement puts pasted blocks, in
 * the transaction that adds its placeholder. An inline image, a drop and files the image node does
 * not store leave the placement alone.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Extension, History, Paragraph, Text } from '@domternal/core';
import { registerClipboardPastePlacement } from '@domternal/core/clipboard';
import type { Fragment } from '@domternal/pm/model';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { Image } from './Image.js';
import type { ImageOptions } from './Image.js';

let editor: Editor | undefined;
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const placed: Fragment[] = [];

/** Places pasted content in a new paragraph at the end of the document. */
const PlaceAtEnd = Extension.create({
  name: 'placeAtEnd',
  addProseMirrorPlugins() {
    return [new Plugin({
      view: view => ({
        destroy: registerClipboardPastePlacement(view, (target: EditorView, content: Fragment) => {
          placed.push(content);
          const paragraph = target.state.schema.nodes['paragraph'];
          if (paragraph === undefined) return undefined;
          const tr = target.state.tr;
          const end = tr.doc.content.size;
          tr.insert(end, paragraph.create());
          return tr.setSelection(TextSelection.create(tr.doc, end + 1));
        }),
      }),
    })];
  },
});

function mount(options: Partial<ImageOptions> = {}): Editor {
  placed.length = 0;
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, History, PlaceAtEnd, Image.configure(options)],
    content: '<p>first</p><p>last</p>',
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
  return editor;
}

function pasteFiles(target: Editor, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), getData: () => '' },
  });
  target.view.dom.dispatchEvent(event);
  return event;
}

const png = (name: string, type = 'image/png'): File => new File([new Uint8Array(8)], name, { type });

describe('pasted image files and a registered paste placement', () => {
  it('puts a block image where the placement puts pasted blocks', async () => {
    const target = mount({ uploadHandler: () => Promise.resolve('https://cdn.example/a.png') });
    pasteFiles(target, [png('a.png')]);
    expect(placed).toHaveLength(1);
    expect(placed[0]?.firstChild?.type.name).toBe('image');
    await vi.waitFor(() => { expect(target.state.doc.toString()).toContain('image'); });
    expect(target.state.doc.toString()).toBe('doc(paragraph("first"), paragraph("last"), image)');
  });

  it('leaves the placement alone for an inline image, which goes at the caret', async () => {
    const target = mount({ inline: true, uploadHandler: () => Promise.resolve('https://cdn.example/a.png') });
    pasteFiles(target, [png('a.png')]);
    await vi.waitFor(() => { expect(target.state.doc.toString()).toContain('image'); });
    expect(placed).toHaveLength(0);
    expect(target.state.doc.toString()).toBe('doc(paragraph("fi", image, "rst"), paragraph("last"))');
  });

  it('leaves the document as it was for files the image node does not store', () => {
    for (const [options, file] of [[{ allowBase64: false }, png('a.png')], [{}, png('a.bmp', 'image/bmp')]] as const) {
      const target = mount(options);
      const before = target.state.doc;
      pasteFiles(target, [file]);
      expect(placed, file.name).toHaveLength(0);
      expect(target.state.doc.eq(before), file.name).toBe(true);
      target.destroy();
    }
  });
});
