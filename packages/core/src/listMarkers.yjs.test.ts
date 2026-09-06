/**
 * Unknown list markers in collaborative documents, across real y-prosemirror
 * clients. y-prosemirror builds nodes without attribute validation, so a
 * shared document may hold a marker this version does not know. Rendering
 * must show the default marker without rewriting or deleting anything, and
 * only the explicit normalizeContentAttributes migration may change the shared
 * document, outside every undo history.
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
import { OrderedList } from './nodes/OrderedList.js';
import { BulletList } from './nodes/BulletList.js';

const REMOTE = 'remote';
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

/** A shared document as another client wrote it: an ordered list with an unknown marker, then a paragraph. */
function seed(): Y.Doc {
  const ydoc = new Y.Doc();
  const text = (value: string): Y.XmlText => { const node = new Y.XmlText(); node.insert(0, value); return node; };
  const paragraph = (value: string): Y.XmlElement => { const node = new Y.XmlElement('paragraph'); node.insert(0, [text(value)]); return node; };
  const item = new Y.XmlElement('listItem');
  item.insert(0, [paragraph('A')]);
  const list = new Y.XmlElement('orderedList');
  list.insert(0, [item]);
  ydoc.getXmlFragment('default').insert(0, [list, paragraph('tail')]);
  list.setAttribute('start', 1 as unknown as string);
  list.setAttribute('listStyleType', 'bogus');
  return ydoc;
}

interface Client { ydoc: Y.Doc; editor: Editor; localUpdates: number }
interface Network {
  clients: Client[];
  offline: (client: Client) => void;
  online: (client: Client) => void;
}

/** Clients relay every update to every other online client; an offline client buffers until it reconnects. */
function network(count: number, options: { readOnly?: number[] } = {}): Network {
  const origin = seed();
  const offline = new Set<Y.Doc>();
  const clients: Client[] = [];
  const sync = (): void => {
    for (const from of clients) for (const to of clients) {
      if (from !== to && !offline.has(from.ydoc) && !offline.has(to.ydoc)) Y.applyUpdate(to.ydoc, Y.encodeStateAsUpdate(from.ydoc), REMOTE);
    }
  };
  for (let index = 0; index < count; index++) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(origin), REMOTE);
    const client = { ydoc, editor: undefined as unknown as Editor, localUpdates: 0 };
    ydoc.on('update', (update: Uint8Array, source: unknown) => {
      if (source === REMOTE) return;
      client.localUpdates++;
      if (offline.has(ydoc)) return;
      for (const other of clients) if (other !== client && !offline.has(other.ydoc)) Y.applyUpdate(other.ydoc, update, REMOTE);
    });
    const Sync = Extension.create({
      name: 'testYjsSync',
      addProseMirrorPlugins: () => [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()],
    });
    client.editor = new Editor({
      element: document.createElement('div'),
      extensions: [Document, Paragraph, Text, OrderedList, BulletList, Sync],
      editable: !options.readOnly?.includes(index),
    });
    editors.push(client.editor);
    clients.push(client);
  }
  return {
    clients,
    offline: (client: Client): void => { offline.add(client.ydoc); },
    online: (client: Client): void => { offline.delete(client.ydoc); sync(); },
  };
}

const sharedList = (client: Client): Y.XmlElement => client.ydoc.getXmlFragment('default').get(0) as Y.XmlElement;
const sharedMarker = (client: Client): unknown => sharedList(client).getAttribute('listStyleType');
const stateMarker = (client: Client): unknown => client.editor.state.doc.firstChild?.attrs['listStyleType'];
const undoDepth = (client: Client): number => (yUndoPluginKey.getState(client.editor.state) as { undoManager: Y.UndoManager }).undoManager.undoStack.length;

function expectDefaultRendering(client: Client): void {
  expect(client.editor.view.dom.querySelector('ol')?.hasAttribute('style')).toBe(false);
  expect(client.editor.getHTML()).toBe('<ol><li><p>A</p></li></ol><p>tail</p>');
}

function typeAtEnd(client: Client, text: string): void {
  const { editor } = client;
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).insertText(text));
}

describe('unknown list markers across Yjs clients', () => {
  it.each([2, 3])('%i clients render the default marker without deleting or rewriting the shared list', count => {
    const { clients } = network(count);
    for (const client of clients) {
      expect(stateMarker(client)).toBe('bogus');
      expectDefaultRendering(client);
      expect(client.ydoc.getXmlFragment('default').length).toBe(2);
      expect(sharedMarker(client)).toBe('bogus');
      expect(client.localUpdates).toBe(0);
    }
  });

  it('keeps the shared marker through unrelated edits and accepts a new unknown value from a remote client', () => {
    const { clients } = network(3);
    const [a, b, c] = clients as [Client, Client, Client];
    typeAtEnd(b, '!');
    for (const client of clients) {
      expect(client.editor.getText()).toBe('A\n\ntail!');
      expect(sharedMarker(client)).toBe('bogus');
      expect(stateMarker(client)).toBe('bogus');
    }
    expect(a.localUpdates + c.localUpdates).toBe(0);
    sharedList(c).setAttribute('listStyleType', 'weird');
    for (const client of clients) {
      expect(stateMarker(client)).toBe('weird');
      expect(client.editor.view.dom.querySelector('ol')?.hasAttribute('style')).toBe(false);
    }
    expect(a.localUpdates + b.localUpdates).toBe(1);
  });

  it('a migration on one client converges everywhere, stays out of the undo stack and survives undo', () => {
    const { clients } = network(3);
    const [a, b] = clients as [Client, Client, Client];
    typeAtEnd(a, '!');
    const depth = undoDepth(a);
    expect(depth).toBe(1);
    expect(a.editor.commands.normalizeContentAttributes()).toBe(true);
    for (const client of clients) {
      expect(sharedMarker(client)).toBeUndefined();
      expect(stateMarker(client)).toBeNull();
      expect(client.ydoc.getXmlFragment('default').length).toBe(2);
    }
    expect(undoDepth(a)).toBe(depth);
    expect(b.editor.can().normalizeContentAttributes()).toBe(false);
    expect(b.editor.commands.normalizeContentAttributes()).toBe(false);
    expect(undo(a.editor.state)).toBe(true);
    for (const client of clients) {
      expect(client.editor.getText()).toBe('A\n\ntail');
      expect(sharedMarker(client)).toBeUndefined();
      expect(stateMarker(client)).toBeNull();
    }
  });

  it('offline migrations on two clients merge into one unstyled list', () => {
    const net = network(2);
    const [a, b] = net.clients as [Client, Client];
    net.offline(a);
    net.offline(b);
    expect(a.editor.commands.normalizeContentAttributes()).toBe(true);
    expect(b.editor.commands.normalizeContentAttributes()).toBe(true);
    net.online(a);
    net.online(b);
    for (const client of net.clients) {
      expect(client.ydoc.getXmlFragment('default').length).toBe(2);
      expect(client.editor.getText()).toBe('A\n\ntail');
      expect(sharedMarker(client)).toBeUndefined();
      expect(stateMarker(client)).toBeNull();
    }
  });

  it('an explicit marker chosen concurrently wins over the migration', () => {
    const net = network(2);
    const [a, b] = net.clients as [Client, Client];
    net.offline(a);
    expect(a.editor.commands.normalizeContentAttributes()).toBe(true);
    b.editor.view.dispatch(b.editor.state.tr.setNodeAttribute(0, 'listStyleType', 'decimal'));
    net.online(a);
    for (const client of net.clients) {
      expect(sharedMarker(client)).toBe('decimal');
      expect(stateMarker(client)).toBe('decimal');
    }
    expect(b.editor.can().normalizeContentAttributes()).toBe(false);
  });

  it('a read-only client renders the default, refuses to migrate and converges on a writer migration', () => {
    const { clients } = network(2, { readOnly: [1] });
    const [writer, viewer] = clients as [Client, Client];
    expect(viewer.editor.isEditable).toBe(false);
    expectDefaultRendering(viewer);
    expect(viewer.editor.can().normalizeContentAttributes()).toBe(false);
    expect(viewer.editor.commands.normalizeContentAttributes()).toBe(false);
    expect(viewer.localUpdates).toBe(0);
    expect(sharedMarker(writer)).toBe('bogus');
    expect(writer.editor.commands.normalizeContentAttributes()).toBe(true);
    expect(stateMarker(viewer)).toBeNull();
    expect(sharedMarker(viewer)).toBeUndefined();
    expect(viewer.localUpdates).toBe(0);
    expectDefaultRendering(viewer);
  });
});
