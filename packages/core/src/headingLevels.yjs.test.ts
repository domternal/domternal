/**
 * Heading levels across real y-prosemirror clients configured with different
 * levels. y-prosemirror builds nodes without attribute validation, so a
 * shared document holds whatever level a collaborator wrote. A client whose
 * configuration lacks that level must render the nearest configured level
 * without rewriting the shared document, and only the explicit
 * normalizeContentAttributes migration may change it, outside every undo
 * history.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { undo, ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { Heading } from './nodes/Heading.js';

const REMOTE = 'remote';
const SIX = [1, 2, 3, 4, 5, 6];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

/** A shared document as a six-level client wrote it: a level five heading, then a paragraph. */
function seed(level: unknown): Y.Doc {
  const ydoc = new Y.Doc();
  const text = (value: string): Y.XmlText => { const node = new Y.XmlText(); node.insert(0, value); return node; };
  const heading = new Y.XmlElement('heading');
  heading.insert(0, [text('Title')]);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [text('tail')]);
  ydoc.getXmlFragment('default').insert(0, [heading, paragraph]);
  heading.setAttribute('level', level as string);
  return ydoc;
}

interface Client { ydoc: Y.Doc; editor: Editor; localUpdates: number }

/** Every client relays its updates to the others; each has its own heading levels and editability. */
function network(configs: { levels?: number[]; readOnly?: boolean }[], level: unknown = 5): Client[] {
  const origin = seed(level);
  const clients: Client[] = [];
  for (const config of configs) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(origin), REMOTE);
    const client = { ydoc, editor: undefined as unknown as Editor, localUpdates: 0 };
    ydoc.on('update', (update: Uint8Array, source: unknown) => {
      if (source === REMOTE) return;
      client.localUpdates++;
      for (const other of clients) if (other !== client) Y.applyUpdate(other.ydoc, update, REMOTE);
    });
    const Sync = Extension.create({
      name: 'testYjsSync',
      addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()],
    });
    client.editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, config.levels ? Heading.configure({ levels: config.levels }) : Heading, Sync],
      editable: config.readOnly !== true,
    });
    editors.push(client.editor);
    clients.push(client);
  }
  return clients;
}

const sharedLevel = (client: Client): unknown => (client.ydoc.getXmlFragment('default').get(0) as Y.XmlElement).getAttribute('level');
const stateLevel = (client: Client): unknown => client.editor.state.doc.firstChild?.attrs['level'];
const undoDepth = (client: Client): number => (yUndoPluginKey.getState(client.editor.state) as { undoManager: Y.UndoManager }).undoManager.undoStack.length;

function typeAtEnd(client: Client, text: string): void {
  const { editor } = client;
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).insertText(text));
}

describe('heading levels across Yjs clients with different configurations', () => {
  it('each client renders the level its configuration allows without rewriting the shared heading', () => {
    const [six, four] = network([{ levels: SIX }, {}]) as [Client, Client];
    expect(six.editor.getHTML()).toBe('<h5>Title</h5><p>tail</p>');
    expect(four.editor.getHTML()).toBe('<h4>Title</h4><p>tail</p>');
    expect(four.editor.view.dom.querySelector('h4')?.textContent).toBe('Title');
    for (const client of [six, four]) {
      expect(stateLevel(client)).toBe(5);
      expect(sharedLevel(client)).toBe(5);
      expect(client.localUpdates).toBe(0);
    }
    expect(six.editor.can().normalizeContentAttributes()).toBe(false);
    expect(four.editor.can().normalizeContentAttributes()).toBe(true);
  });

  it('keeps the shared level through unrelated edits on the client that lacks it', () => {
    const [six, four] = network([{ levels: SIX }, {}]) as [Client, Client];
    typeAtEnd(four, '!');
    for (const client of [six, four]) {
      expect(client.editor.getText()).toBe('Title\n\ntail!');
      expect(sharedLevel(client)).toBe(5);
      expect(stateLevel(client)).toBe(5);
    }
    expect(six.localUpdates).toBe(0);
  });

  it('a migration on the client that lacks the level converges everywhere, stays out of the undo stack and survives undo', () => {
    const [six, four] = network([{ levels: SIX }, {}]) as [Client, Client];
    typeAtEnd(four, '!');
    const depth = undoDepth(four);
    expect(depth).toBe(1);
    expect(four.editor.commands.normalizeContentAttributes()).toBe(true);
    for (const client of [six, four]) {
      expect(sharedLevel(client)).toBe(4);
      expect(stateLevel(client)).toBe(4);
      expect(client.editor.getHTML()).toBe('<h4>Title</h4><p>tail!</p>');
    }
    expect(undoDepth(four)).toBe(depth);
    expect(undo(four.editor.state)).toBe(true);
    for (const client of [six, four]) {
      expect(client.editor.getText()).toBe('Title\n\ntail');
      expect(sharedLevel(client)).toBe(4);
    }
    expect(four.editor.can().normalizeContentAttributes()).toBe(false);
  });

  it('a value that is not a level binds, renders at the first configured level and migrates on any client', () => {
    const [six, four] = network([{ levels: SIX }, { levels: [2, 3] }], 'bogus') as [Client, Client];
    expect(stateLevel(six)).toBe('bogus');
    expect(six.editor.getHTML()).toBe('<h1>Title</h1><p>tail</p>');
    expect(four.editor.getHTML()).toBe('<h2>Title</h2><p>tail</p>');
    expect(six.editor.commands.normalizeContentAttributes()).toBe(true);
    for (const client of [six, four]) expect(sharedLevel(client)).toBe(1);
    expect(four.editor.getHTML()).toBe('<h2>Title</h2><p>tail</p>');
  });

  it('a read-only client renders the configured level, refuses to migrate and converges on a writer migration', () => {
    const [writer, viewer] = network([{}, { readOnly: true }]) as [Client, Client];
    expect(viewer.editor.isEditable).toBe(false);
    expect(viewer.editor.getHTML()).toBe('<h4>Title</h4><p>tail</p>');
    expect(viewer.editor.can().normalizeContentAttributes()).toBe(false);
    expect(viewer.editor.commands.normalizeContentAttributes()).toBe(false);
    expect(viewer.localUpdates).toBe(0);
    expect(writer.editor.commands.normalizeContentAttributes()).toBe(true);
    expect(stateLevel(viewer)).toBe(4);
    expect(sharedLevel(viewer)).toBe(4);
    expect(viewer.localUpdates).toBe(0);
  });
});
