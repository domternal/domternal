import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYDoc, undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { Editor } from '../Editor.js';
import { Extension } from '../Extension.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListLabels } from './ListLabels.js';
import type { AnyExtension, JSONContent } from '../types/index.js';

const extensions: AnyExtension[] = [Document, Paragraph, Text, OrderedList, ListLabels];
const label = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ' '], fallback: 'decimal' };
const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const content: JSONContent = { type: 'doc', content: [{ type: 'orderedList', attrs: { start: 4 }, content: [{ type: 'listItem', content: [paragraph('Outer'),
  { type: 'orderedList', attrs: { start: 0, listLabel: label }, content: [{ type: 'listItem', content: [paragraph('Inner')] }] },
] }] }] };
const editors: Editor[] = []; const documents: Y.Doc[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); documents.splice(0).forEach(document => { document.destroy(); }); });

describe('compound list counters across Yjs clients', () => {
  it('derives updates on both clients without writing presentation or adding undo events', () => {
    const seed = new Editor({ extensions, content }); editors.push(seed);
    const origin = prosemirrorToYDoc(seed.state.doc); documents.push(origin);
    const clients: { document: Y.Doc; editor: Editor; updates: number }[] = [];
    for (let index = 0; index < 2; index++) {
      const document = new Y.Doc(); documents.push(document); Y.applyUpdate(document, Y.encodeStateAsUpdate(origin));
      const Sync = Extension.create({ name: 'testSync', addProseMirrorPlugins: () => [ySyncPlugin(document.getXmlFragment('prosemirror')), yUndoPlugin()] });
      const editor = new Editor({ extensions: [...extensions, Sync] }); editors.push(editor);
      const client = { document, editor, updates: 0 }; clients.push(client);
      document.on('update', (update: Uint8Array, source: unknown) => {
        if (source === 'remote') return;
        client.updates++;
        for (const other of clients) if (other !== client) Y.applyUpdate(other.document, update, 'remote');
      });
    }
    const [first, second] = clients;
    if (first === undefined || second === undefined) throw new Error('Missing clients');
    const marker = (editor: Editor): string | null | undefined => editor.view.dom.querySelector('[data-dm-compound-marker]')?.getAttribute('data-dm-compound-marker');
    expect(clients.map(client => marker(client.editor))).toEqual(['4.0 ', '4.0 ']);
    expect(clients.map(client => client.updates)).toEqual([0, 0]);
    const list = first.editor.state.doc.firstChild;
    if (list === null) throw new Error('Missing root list');
    first.editor.view.dispatch(first.editor.state.tr.setNodeMarkup(0, undefined, { ...list.attrs, start: 7 }));
    expect(clients.map(client => marker(client.editor))).toEqual(['7.0 ', '7.0 ']);
    expect(clients.map(client => client.updates)).toEqual([1, 0]);
    expect(first.document.getXmlFragment('prosemirror').toJSON()).not.toContain('data-dm-compound-marker');
    expect(undo(first.editor.state)).toBe(true);
    expect(clients.map(client => marker(client.editor))).toEqual(['4.0 ', '4.0 ']);
    expect(first.editor.getJSON()).toEqual(second.editor.getJSON());
  });
});
