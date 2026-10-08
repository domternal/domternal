/**
 * SmartPaste and the paste placement a node registers through @domternal/core/clipboard, as
 * Details does for its summary: the blocks go where the placement puts pasted blocks, in one
 * transaction with what the placement added.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Extension, Heading, Paragraph, Text } from '@domternal/core';
import { registerClipboardPastePlacement } from '@domternal/core/clipboard';
import type { Fragment } from '@domternal/pm/model';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { SmartPaste } from './SmartPaste.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

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

function paste(editor: Editor, html: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['text/html'], files: [], items: [], getData: (type: string) => (type === 'text/html' ? html : '') },
  });
  editor.view.dom.dispatchEvent(event);
}

describe('SmartPaste with a registered paste placement', () => {
  it('inserts the blocks where the placement puts them, in one transaction', () => {
    placed.length = 0;
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, Heading, PlaceAtEnd, SmartPaste],
      content: '<p>first</p><p>last</p>',
    });
    editors.push(editor);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    let changes = 0;
    editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes++; });

    paste(editor, '<h2>x</h2><p>y</p>');

    expect(placed.map(content => content.toString())).toEqual(['<heading("x"), paragraph("y")>']);
    expect(editor.state.doc.toString()).toBe('doc(paragraph("first"), paragraph("last"), heading("x"), paragraph("y"))');
    expect(changes).toBe(1);
  });
});
