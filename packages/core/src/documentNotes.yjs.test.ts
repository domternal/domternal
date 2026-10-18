import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { prosemirrorToYDoc, undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { StarterKit } from './extensions/StarterKit.js';
import { DocumentNotes } from './extensions/DocumentNotes.js';
import { getDocumentNotes } from './utils/documentNotes.js';

const editors: Editor[] = []; const documents: Y.Doc[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); for (const doc of documents.splice(0)) doc.destroy(); });
interface Client { editor: Editor; ydoc: Y.Doc; sent: number }
function pair(): [Client, Client] {
  const source = new Editor({ extensions: [StarterKit.configure({ trailingNode: false }), DocumentNotes], content: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Text' }, { type: 'documentNoteReference', attrs: { noteId: 'shared', kind: 'footnote' } }] },
    { type: 'documentNote', attrs: { noteId: 'shared', kind: 'footnote' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shared note' }] }] },
  ] } });
  const seed = prosemirrorToYDoc(source.state.doc); const update = Y.encodeStateAsUpdate(seed); seed.destroy(); source.destroy();
  const clients: Client[] = [];
  for (let index = 0; index < 2; index++) {
    const ydoc = new Y.Doc(); documents.push(ydoc); Y.applyUpdate(ydoc, update);
    const client = { ydoc, sent: 0 } as Client;
    ydoc.on('update', (next: Uint8Array, origin: unknown) => { if (origin === 'remote') return; client.sent++; for (const other of clients) if (other !== client) Y.applyUpdate(other.ydoc, next, 'remote'); });
    const Sync = Extension.create({ name: 'noteSync', addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('prosemirror')), yUndoPlugin()] });
    client.editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit.configure({ trailingNode: false, history: false }), DocumentNotes, Sync] });
    editors.push(client.editor); clients.push(client);
  }
  return clients as [Client, Client];
}

describe('document notes in the actual shared document', () => {
  it('renders both peers without generating synchronization writes and shares editable body changes', () => {
    const [first, second] = pair();
    expect(first.sent).toBe(0); expect(second.sent).toBe(0);
    expect(first.editor.view.dom.querySelector('sup')?.textContent).toBe('1');
    first.editor.commands.focusDocumentNote({ noteId: 'shared' }); first.editor.commands.insertText('Edited ');
    expect(second.editor.state.doc.textContent).toContain('Edited Shared note');
    expect(second.sent).toBe(0);
    expect(getDocumentNotes(second.editor.state.doc)?.references[0]?.body?.node.textContent).toBe('Edited Shared note');
    expect(undo(first.editor.state)).toBe(true);
    expect(second.editor.state.doc.textContent).toContain('Shared note'); expect(second.editor.state.doc.textContent).not.toContain('Edited');
  });
  it('shares reference insertion and body insertion atomically and restores both through Yjs undo', () => {
    const [first, second] = pair();
    first.editor.view.dispatch(first.editor.state.tr.setSelection(TextSelection.create(first.editor.state.doc, 1)));
    expect(first.editor.commands.insertDocumentNote({ noteId: 'new', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New body' }] }] })).toBe(true);
    const snapshot = getDocumentNotes(second.editor.state.doc)!;
    expect(snapshot.bodies).toHaveLength(2); expect(snapshot.references).toHaveLength(2);
    expect(snapshot.references.find(reference => reference.noteId === 'new')?.body?.node.textContent).toBe('New body');
    expect(undo(first.editor.state)).toBe(true);
    expect(getDocumentNotes(second.editor.state.doc)?.bodies).toHaveLength(1);
    expect(getDocumentNotes(second.editor.state.doc)?.references).toHaveLength(1);
  });
  it('keeps conflicting remote body identities visible and does not repair shared state on render', () => {
    const [first, second] = pair();
    const body = first.editor.state.doc.lastChild!;
    first.editor.view.dispatch(first.editor.state.tr.insert(first.editor.state.doc.content.size, body));
    for (const client of [first, second]) {
      const notes = getDocumentNotes(client.editor.state.doc)!;
      expect(notes.bodies).toHaveLength(2); expect(notes.bodies.every(note => note.duplicate)).toBe(true);
      expect(notes.references[0]?.body).toBeUndefined(); expect(client.editor.view.dom.textContent).toContain('More than one note');
    }
    expect(second.sent).toBe(0);
  });
});
