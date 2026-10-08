/**
 * Image files pasted over a cell selection: the selected cells are cleared and the images land in
 * the first selected cell, in order, as the text of a paste would. The table nodes here are the
 * minimal ones prosemirror-tables needs; extension-table's own paste handler hands such files to
 * this node before it fills cells, which its tests check.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Node, Paragraph, Text } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import { Image } from './Image.js';

const Table = Node.create({
  name: 'table', group: 'block', content: 'tableRow+', tableRole: 'table', isolating: true,
  parseHTML: () => [{ tag: 'table' }], renderHTML: () => ['table', ['tbody', 0]],
});
const TableRow = Node.create({
  name: 'tableRow', content: 'tableCell+', tableRole: 'row',
  parseHTML: () => [{ tag: 'tr' }], renderHTML: () => ['tr', 0],
});
const TableCell = Node.create({
  name: 'tableCell', content: 'block+', tableRole: 'cell', isolating: true,
  addAttributes: () => ({ colspan: { default: 1, rendered: false }, rowspan: { default: 1, rendered: false }, colwidth: { default: null, rendered: false } }),
  parseHTML: () => [{ tag: 'td' }], renderHTML: () => ['td', 0],
});

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  document.body.replaceChildren();
});

const TABLE = '<table><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>';

function mount(): Editor {
  editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Table, TableRow, TableCell,
      Image.configure({ uploadHandler: file => Promise.resolve(`https://cdn.example/${file.name}`) })],
    content: TABLE,
  });
  return editor;
}

const png = (name: string): File => new File([new Uint8Array(8)], name, { type: 'image/png' });

function pasteFiles(target: Editor, files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: { types: ['Files'], files, items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })), getData: () => '' },
  });
  target.view.dom.dispatchEvent(event);
  return event;
}

/** Selects the cells from the one holding `from` to the one holding `to`. */
function selectCells(target: Editor, from: string, to: string): void {
  const cells = new Map<string, number>();
  target.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell') cells.set(node.textContent, pos);
  });
  const anchor = cells.get(from);
  const head = cells.get(to);
  if (anchor === undefined || head === undefined) throw new Error('No such cell');
  target.view.dispatch(target.state.tr.setSelection(CellSelection.create(target.state.doc, anchor, head)));
}

const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

describe('image files pasted over a cell selection', () => {
  it('clears the selected cells and places the image in the first of them', async () => {
    const ed = mount();
    selectCells(ed, 'a', 'b');

    expect(pasteFiles(ed, [png('x.png')]).defaultPrevented).toBe(true);
    await flush();

    expect(ed.getHTML()).toBe('<table><tbody><tr><td><img src="https://cdn.example/x.png"></td><td><p></p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>');
  });

  it('places every file in order in the first selected cell, also for a selection made from its end', async () => {
    const ed = mount();
    selectCells(ed, 'd', 'a');

    pasteFiles(ed, [png('1.png'), png('2.png')]);
    await flush();

    expect(ed.getHTML()).toBe('<table><tbody><tr><td><img src="https://cdn.example/1.png"><img src="https://cdn.example/2.png"></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td></tr></tbody></table>');
  });
});
