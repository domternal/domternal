/**
 * Pasting cells into a table: a pasted cell that spans rows up to the table's right edge used
 * to throw prosemirror-tables' "No cell with offset" and insert nothing. Every paste now leaves
 * a valid table, selects exactly the pasted cells and undoes in one step.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, History, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { CellSelection, TableMap } from '@domternal/pm/tables';
import { Table, TableRow, TableCell, TableHeader } from './index.js';

const extensions = [Document, Paragraph, Text, History, Table, TableRow, TableCell, TableHeader];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); document.body.replaceChildren(); });

const grid = (width: number, height: number): string => {
  let letter = 0;
  const rows = Array.from({ length: height }, () => `<tr>${Array.from({ length: width }, () => `<td><p>${String.fromCharCode(97 + letter++)}</p></td>`).join('')}</tr>`);
  return `<table><tbody>${rows.join('')}</tbody></table>`;
};
const TARGETS: [string, string, number, number][] = [
  ['1x1', grid(1, 1), 0, 0],
  ['2x2 at 0,0', grid(2, 2), 0, 0], ['2x2 at 0,1', grid(2, 2), 0, 1], ['2x2 at 1,0', grid(2, 2), 1, 0], ['2x2 at 1,1', grid(2, 2), 1, 1],
  ['3x3 at 0,0', grid(3, 3), 0, 0], ['3x3 at 0,1', grid(3, 3), 0, 1], ['3x3 at 1,1', grid(3, 3), 1, 1], ['3x3 at 2,2', grid(3, 3), 2, 2],
];
/** Clipboard HTML, the pasted area's width and height, and the spans of the X cell. */
const PASTES: [string, string, number, number, [number, number]][] = [
  ['a 2x2 cell', '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>', 2, 2, [2, 2]],
  ['a cell spanning 2 rows', '<table><tbody><tr><td rowspan="2"><p>X</p></td></tr></tbody></table>', 1, 2, [1, 2]],
  ['a cell spanning 2 columns', '<table><tbody><tr><td colspan="2"><p>X</p></td></tr></tbody></table>', 2, 1, [2, 1]],
  ['a cell spanning 3 columns', '<table><tbody><tr><td colspan="3"><p>X</p></td></tr></tbody></table>', 3, 1, [3, 1]],
  ['2 rows: a 2x2 cell and a cell, then a cell', '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td><td><p>Y</p></td></tr><tr><td><p>Z</p></td></tr></tbody></table>', 3, 2, [2, 2]],
  ['a 2x2 header cell', '<table><tbody><tr><th colspan="2" rowspan="2"><p>X</p></th></tr></tbody></table>', 2, 2, [2, 2]],
  ['a 2x3 cell', '<table><tbody><tr><td colspan="2" rowspan="3"><p>X</p></td></tr></tbody></table>', 2, 3, [2, 3]],
  ['an internal copy of a 2x2 cell', '<table data-pm-slice="1 1 -2 &quot;table&quot; []"><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>', 2, 2, [2, 2]],
];

function mount(content: string): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions, content });
  editors.push(editor);
  return editor;
}

function tableOf(editor: Editor): { table: PMNode; start: number } {
  let found: { table: PMNode; start: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === 'table') found = { table: node, start: pos + 1 };
    return !found;
  });
  if (!found) throw new Error('No table');
  return found;
}

/** The offset of the cell at a row and column, from the start of the table's content. */
function cellOffset(map: TableMap, row: number, col: number): number {
  const offset = map.map[row * map.width + col];
  if (offset === undefined) throw new Error(`No cell at ${String(row)},${String(col)}`);
  return offset;
}

/** Puts the caret into the cell at a row and column. */
function caretAt(editor: Editor, row: number, col: number): void {
  const { table, start } = tableOf(editor);
  const cell = cellOffset(TableMap.get(table), row, col);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + cell + 2)));
}

function paste(editor: Editor, html: string): boolean {
  return editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
}

function cellAt(editor: Editor, text: string): { node: PMNode; rect: { left: number; top: number; right: number; bottom: number } } {
  const { table, start } = tableOf(editor);
  const map = TableMap.get(table);
  let result: { node: PMNode; rect: { left: number; top: number; right: number; bottom: number } } | undefined;
  table.descendants((node, pos) => {
    if (!result && node.type.spec['tableRole'] !== undefined && String(node.type.spec['tableRole']).includes('cell') && node.textContent === text) {
      result = { node, rect: map.findCell(pos) };
    }
    return !result;
  });
  void start;
  if (!result) throw new Error(`No cell ${text}`);
  return result;
}

describe('pasting cells', () => {
  for (const [target, content, row, col] of TARGETS) {
    for (const [name, html, width, height, spans] of PASTES) {
      it(`pastes ${name} into a ${target}`, () => {
        const editor = mount(content);
        const before = editor.state.doc;
        caretAt(editor, row, col);

        expect(paste(editor, html)).toBe(true);

        const { table, start } = tableOf(editor);
        const map = TableMap.get(table);
        expect(map.problems ?? null).toBeNull();
        const x = cellAt(editor, 'X');
        expect([x.node.attrs['colspan'], x.node.attrs['rowspan']]).toEqual(spans);
        expect(x.rect).toMatchObject({ left: col, top: row });
        expect(map.width).toBeGreaterThanOrEqual(col + width);
        expect(map.height).toBeGreaterThanOrEqual(row + height);
        // The selection covers exactly the pasted area.
        const selection = editor.state.selection;
        expect(selection).toBeInstanceOf(CellSelection);
        const rect = map.rectBetween((selection as CellSelection).$anchorCell.pos - start, (selection as CellSelection).$headCell.pos - start);
        expect(rect).toEqual({ left: col, top: row, right: col + width, bottom: row + height });
        // Cells outside the pasted area keep their text.
        const original = before.child(0);
        const originalMap = TableMap.get(original);
        for (const offset of new Set(originalMap.map)) {
          const at = originalMap.findCell(offset);
          const inside = at.left >= col && at.left < col + width && at.top >= row && at.top < row + height;
          if (!inside) expect(editor.getText()).toContain(original.nodeAt(offset)?.textContent);
        }

        expect(editor.commands.undo()).toBe(true);
        expect(editor.state.doc.eq(before)).toBe(true);
      });
    }
  }

  it('pastes into a cell selection, clipped to it, without throwing', () => {
    const editor = mount(grid(3, 3));
    const { table, start } = tableOf(editor);
    const map = TableMap.get(table);
    const cell = (row: number, col: number): number => start + cellOffset(map, row, col);
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cell(1, 1), cell(2, 2))));

    expect(paste(editor, '<table><tbody><tr><td colspan="2" rowspan="3"><p>X</p></td></tr></tbody></table>')).toBe(true);

    const after = tableOf(editor);
    expect(TableMap.get(after.table).problems ?? null).toBeNull();
    // Clipped at the bottom of the selection, the cell keeps the two rows it still covers.
    expect([cellAt(editor, 'X').node.attrs['colspan'], cellAt(editor, 'X').node.attrs['rowspan']]).toEqual([2, 2]);
    expect(cellAt(editor, 'X').rect).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
  });

  it('pastes over a merged target cell, splitting it as needed', () => {
    const editor = mount('<table><tbody><tr><td colspan="2"><p>ab</p></td><td><p>c</p></td></tr><tr><td><p>d</p></td><td><p>e</p></td><td><p>f</p></td></tr></tbody></table>');
    caretAt(editor, 1, 1);

    expect(paste(editor, '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>')).toBe(true);

    expect(TableMap.get(tableOf(editor).table).problems ?? null).toBeNull();
    expect(cellAt(editor, 'X').rect).toEqual({ left: 1, top: 1, right: 3, bottom: 3 });
    expect(editor.getText()).toContain('ab');
  });

  it('pastes into the inner table of a nested table only', () => {
    const editor = mount(`<table><tbody><tr><td>${grid(2, 2)}</td><td><p>outer</p></td></tr></tbody></table>`);
    let inner = 0;
    editor.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'b') inner = pos; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inner)));

    expect(paste(editor, '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>')).toBe(true);

    const outer = tableOf(editor).table;
    expect(TableMap.get(outer).width).toBe(2);
    expect(outer.child(0).child(1).textContent).toBe('outer');
    const nested = outer.child(0).child(0).child(0);
    expect(nested.type.name).toBe('table');
    expect(TableMap.get(nested).problems ?? null).toBeNull();
    expect(TableMap.get(nested).width).toBe(3);
  });

  it('pastes nothing in a read-only editor', () => {
    const editor = mount(grid(2, 2));
    caretAt(editor, 0, 0);
    editor.setEditable(false);
    const before = editor.state.doc;
    editor.view.dom.dispatchEvent(Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
      clipboardData: { getData: (type: string) => (type === 'text/html' ? PASTES[0]?.[1] ?? '' : ''), types: ['text/html'], files: [], items: [] },
    }));
    expect(editor.state.doc).toBe(before);
  });
});
