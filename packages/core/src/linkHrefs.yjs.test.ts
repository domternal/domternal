/**
 * Link hrefs across real y-prosemirror clients configured with different
 * protocols. y-prosemirror binds marks without attribute validation, so a
 * shared document holds whatever href a collaborator wrote, even one that is
 * not a string. Every client must render such a link as text and refuse to
 * open it, without rewriting the shared document, and only the explicit
 * normalizeContentAttributes migration may remove it, outside every undo
 * history.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { Link } from './marks/Link.js';
import { linkClickPluginKey } from './marks/helpers/linkClickPlugin.js';

const REMOTE = 'remote';
const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  vi.restoreAllMocks();
});

/** A shared paragraph whose words carry the given link hrefs, as other clients wrote them. */
function seed(hrefs: unknown[]): Y.Doc {
  const ydoc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  ydoc.getXmlFragment('default').insert(0, [paragraph]);
  const text = new Y.XmlText();
  paragraph.insert(0, [text]);
  // Integrated first, so each insert lands at the current end.
  hrefs.forEach((href, index) => {
    text.insert(text.length, `w${String(index)}`, { link: { href, target: null, rel: null, title: null, class: null } });
    // Without attributes, Yjs would extend the link over the space.
    text.insert(text.length, ' ', { link: null });
  });
  return ydoc;
}

interface Client { ydoc: Y.Doc; editor: Editor; localUpdates: number }

function network(configs: { protocols?: string[]; readOnly?: boolean }[], hrefs: unknown[]): Client[] {
  const origin = seed(hrefs);
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
      extensions: [Document, Paragraph, Text, config.protocols ? Link.configure({ protocols: config.protocols }) : Link, Sync],
      editable: config.readOnly !== true,
    });
    editors.push(client.editor);
    clients.push(client);
  }
  return clients;
}

/** The hrefs of the shared document's links, in order. */
function sharedHrefs(client: Client): unknown[] {
  const text = (client.ydoc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
  return text.toDelta().flatMap((part: { attributes?: { link?: { href: unknown } } }) => (part.attributes?.link ? [part.attributes.link.href] : []));
}

const stateHrefs = (client: Client): unknown[] => {
  const found: unknown[] = [];
  client.editor.state.doc.descendants(node => { for (const mark of node.marks) found.push(mark.attrs['href']); });
  return found;
};

function clickEach(client: Client): boolean[] {
  const { view } = client.editor;
  const plugin = view.state.plugins.find(candidate => candidate.spec.key === linkClickPluginKey);
  return Array.from(view.dom.querySelectorAll('p > a, p > span')).map(target => {
    const event = new MouseEvent('click', { button: 0, bubbles: true });
    Object.defineProperty(event, 'target', { value: target });
    return (plugin?.props.handleClick as (view: unknown, pos: number, event: MouseEvent) => boolean)(view, 0, event);
  });
}

function typeAtEnd(client: Client, text: string): void {
  const { editor } = client;
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).insertText(text));
}

describe('link hrefs across Yjs clients with different protocols', () => {
  it('each client renders the links its configuration allows, and text for the others, without rewriting the shared links (I3)', () => {
    const [wide, narrow] = network([{ protocols: ['https:', 'ftp:'] }, {}], ['ftp://files.example/f', 'https://ok.example/']);
    expect(stateHrefs(narrow!)).toEqual(['ftp://files.example/f', 'https://ok.example/']);
    expect(wide!.editor.getHTML()).toBe('<p><a href="ftp://files.example/f">w0</a> <a href="https://ok.example/">w1</a> </p>');
    expect(narrow!.editor.getHTML()).toBe('<p><span>w0</span> <a href="https://ok.example/">w1</a> </p>');
    expect(wide!.localUpdates + narrow!.localUpdates).toBe(0);
    expect(sharedHrefs(narrow!)).toEqual(['ftp://files.example/f', 'https://ok.example/']);
  });

  it('neutralizes a remote script href and an href that is not a string on every client until the migration (I4)', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const clients = network([{}, { protocols: ['https:', 'ftp:'] }, { readOnly: true }], ['javascript:alert(1)', ['javascript:alert(1)'], 'https://ok.example/']);
    for (const client of clients) {
      expect(client.editor.getHTML()).toBe('<p><span>w0</span> <span>w1</span> <a href="https://ok.example/">w2</a> </p>');
      expect(client.editor.view.dom.querySelectorAll('a[href^="javascript"]')).toHaveLength(0);
    }
    expect(clickEach(clients[0]!)).toEqual([false, false, true]);
    expect(open.mock.calls).toEqual([['https://ok.example/', '_blank', 'noopener,noreferrer']]);
    typeAtEnd(clients[0]!, '!');
    expect(sharedHrefs(clients[2]!)).toEqual(['javascript:alert(1)', ['javascript:alert(1)'], 'https://ok.example/']);
  });

  it('removes the links for everyone when one writer migrates, and undo on another client cannot restore them (I5)', () => {
    const [writer, other, reader] = network([{}, {}, { readOnly: true }], ['javascript:alert(1)', 'https://ok.example/']);
    typeAtEnd(other!, 'x');
    expect(reader!.editor.commands.normalizeContentAttributes()).toBe(false);
    expect(writer!.editor.commands.normalizeContentAttributes()).toBe(true);
    for (const client of [writer!, other!, reader!]) {
      expect(sharedHrefs(client)).toEqual(['https://ok.example/']);
      expect(stateHrefs(client)).toEqual(['https://ok.example/']);
    }
    undo(other!.editor.state);
    undo(writer!.editor.state);
    for (const client of [writer!, other!, reader!]) expect(sharedHrefs(client)).toEqual(['https://ok.example/']);
    expect(writer!.editor.can().normalizeContentAttributes()).toBe(false);
  });

  it('keeps a link a collaborator with wider protocols wrote when that client migrates', () => {
    const [wide, narrow] = network([{ protocols: ['https:', 'ftp:'] }, {}], ['ftp://files.example/f', 'vbscript:x']);
    expect(wide!.editor.commands.normalizeContentAttributes()).toBe(true);
    expect(sharedHrefs(narrow!)).toEqual(['ftp://files.example/f']);
  });
});
