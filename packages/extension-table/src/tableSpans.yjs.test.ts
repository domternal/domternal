/**
 * Table spans across real y-prosemirror clients. y-prosemirror builds nodes without attribute
 * validation, so a shared document holds whatever span a client wrote, including an older
 * client or a crafted update. A table that holds a span loading would replace must not be
 * rewritten by prosemirror-tables' fixTables on the next edit, which would delete cells,
 * multiply columns or make clients disagree; it waits for normalizeContentAttributes, and then
 * fixTables repairs its structure as usual.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { Document, Editor, Extension, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { TableMap } from '@domternal/pm/tables';
import { Table, TableRow, TableCell, TableHeader } from './index.js';

const REMOTE = 'remote';
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); });

/** A shared 2x2 table whose first cell holds the span under test. */
function seed(attribute: 'colspan' | 'rowspan', value: unknown): Y.Doc {
  const ydoc = new Y.Doc();
  const paragraph = (value: string): Y.XmlElement => {
    const text = new Y.XmlText();
    text.insert(0, value);
    const element = new Y.XmlElement('paragraph');
    element.insert(0, [text]);
    return element;
  };
  const cell = (text: string): Y.XmlElement => {
    const element = new Y.XmlElement('tableCell');
    element.insert(0, [paragraph(text)]);
    return element;
  };
  const row = (...cells: Y.XmlElement[]): Y.XmlElement => {
    const element = new Y.XmlElement('tableRow');
    element.insert(0, cells);
    return element;
  };
  const first = cell('a');
  const table = new Y.XmlElement('table');
  table.insert(0, [row(first, cell('b')), row(cell('c'), cell('d'))]);
  ydoc.getXmlFragment('default').insert(0, [table, paragraph('tail')]);
  first.setAttribute(attribute, value as string);
  return ydoc;
}

interface Client { ydoc: Y.Doc; editor: Editor; localUpdates: number }

function network(count: number, attribute: 'colspan' | 'rowspan', value: unknown): Client[] {
  const origin = seed(attribute, value);
  const clients: Client[] = [];
  for (let index = 0; index < count; index++) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(origin), REMOTE);
    const client: Client = { ydoc, editor: undefined as unknown as Editor, localUpdates: 0 };
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
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader, Sync],
    });
    editors.push(client.editor);
    clients.push(client);
  }
  return clients;
}

/** Two clients' documents are equal; each editor has its own schema, so compare their JSON. */
const same = (a: Client, b: Client): boolean => JSON.stringify(a.editor.getJSON()) === JSON.stringify(b.editor.getJSON());

const cells = (doc: PMNode): string[] => {
  const found: string[] = [];
  doc.descendants(node => { if (node.type.name === 'tableCell') found.push(node.textContent); });
  return found;
};
const sharedCells = (client: Client): number =>
  (client.ydoc.getXmlFragment('default').get(0) as Y.XmlElement).toArray()
    .reduce((sum, row) => sum + (row as Y.XmlElement).length, 0);
const firstSpan = (client: Client, attribute: string): unknown =>
  (((client.ydoc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement).getAttribute(attribute);

/** Types into the last cell, the edit that runs fixTables on the table. */
function typeInLastCell(client: Client, text: string): void {
  const { editor } = client;
  let end = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') end = pos + node.nodeSize - 2; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)).insertText(text));
}

const CRAFTED: [string, 'colspan' | 'rowspan', unknown][] = [
  ['colspan -1', 'colspan', -1], ['colspan "2"', 'colspan', '2'], ['colspan 1.5', 'colspan', 1.5],
  ['colspan "abc"', 'colspan', 'abc'], ['colspan 0', 'colspan', 0], ['rowspan -1', 'rowspan', -1],
  ['rowspan "2"', 'rowspan', '2'], ['rowspan 1.5', 'rowspan', 1.5], ['colspan 1e6', 'colspan', 1e6],
];

describe('table spans across Yjs clients', () => {
  it.each(CRAFTED)('an edit next to %s keeps every cell, rewrites nothing and keeps clients equal', (_name, attribute, value) => {
    const [a, b] = network(2, attribute, value);
    if (!a || !b) throw new Error('Expected two clients');
    expect(cells(a.editor.state.doc)).toEqual(['a', 'b', 'c', 'd']);
    expect(a.localUpdates + b.localUpdates).toBe(0);

    typeInLastCell(a, '!');

    expect(cells(a.editor.state.doc)).toEqual(['a', 'b', 'c', 'd!']);
    expect(cells(b.editor.state.doc)).toEqual(['a', 'b', 'c', 'd!']);
    expect(same(a, b)).toBe(true);
    expect(sharedCells(a)).toBe(4);
    expect(sharedCells(b)).toBe(4);
    expect(firstSpan(a, attribute)).toEqual(value);
    // Only the typed character reached the shared document.
    expect(a.localUpdates).toBe(1);
    expect(b.localUpdates).toBe(0);
  });

  it('draws a huge stored colspan with at most 1,000 columns', () => {
    const [a] = network(1, 'colspan', 1e6);
    expect(a?.editor.view.dom.querySelectorAll('col').length).toBeLessThanOrEqual(1001);
  });

  it.each(CRAFTED)('normalizeContentAttributes repairs %s for every client, then fixTables fixes the structure', (_name, attribute, value) => {
    const [a, b] = network(2, attribute, value);
    if (!a || !b) throw new Error('Expected two clients');

    expect(a.editor.commands.normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(true);
    typeInLastCell(b, '!');

    for (const client of [a, b]) {
      const span = client.editor.state.doc.firstChild?.firstChild?.firstChild?.attrs[attribute];
      expect(Number.isSafeInteger(span) && (span as number) >= 1 && (span as number) <= 1000).toBe(true);
      expect(cells(client.editor.state.doc).join('')).toContain('abcd!');
      const table = client.editor.state.doc.firstChild;
      if (!table) throw new Error('No table');
      expect(TableMap.get(table).problems ?? null).toBeNull();
    }
    expect(same(a, b)).toBe(true);
  });

  it('keeps fixing the structure of a table with only supported spans', () => {
    const [a, b] = network(2, 'colspan', 3);
    if (!a || !b) throw new Error('Expected two clients');

    typeInLastCell(a, '!');

    // A span wider than the row asks for padding cells, as in 1.2.0.
    const table = a.editor.state.doc.firstChild;
    if (!table) throw new Error('No table');
    expect(TableMap.get(table).problems ?? null).toBeNull();
    expect(same(a, b)).toBe(true);
  });
});
