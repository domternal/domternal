import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import { TextSelection } from '@domternal/pm/state';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';
import { deleteTableWhenAllCellsSelected } from './deleteTableWhenAllCellsSelected.js';

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

function findCellPositions(editor: Editor): { first: number; last: number } {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      positions.push(pos);
    }
  });
  return { first: positions[0] ?? 0, last: positions[positions.length - 1] ?? 0 };
}

function selectAllCells(editor: Editor): void {
  const { first, last } = findCellPositions(editor);
  const selection = CellSelection.create(editor.state.doc, first, last);
  editor.view.dispatch(editor.state.tr.setSelection(selection as unknown as typeof editor.state.tr.selection));
}

describe('deleteTableWhenAllCellsSelected', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('returns false when selection is not a CellSelection', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Plain text</p>',
    });
    const result = deleteTableWhenAllCellsSelected({ state: editor.state });
    expect(result).toBe(false);
  });

  it('returns false when cursor is in a paragraph (TextSelection)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
    });
    // Create a TextSelection inside the paragraph
    const $pos = editor.state.doc.resolve(1);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));
    const result = deleteTableWhenAllCellsSelected({ state: editor.state });
    expect(result).toBe(false);
  });

  it('returns true when all cells are selected (no dispatch)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
    });
    selectAllCells(editor);
    const result = deleteTableWhenAllCellsSelected({ state: editor.state });
    expect(result).toBe(true);
  });

  it('returns false when only one cell is selected (partial selection)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>',
    });
    // Select only the first cell (anchor == head)
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') positions.push(pos);
    });
    const firstCellPos = positions[0] ?? 0;
    const selection = CellSelection.create(editor.state.doc, firstCellPos, firstCellPos);
    editor.view.dispatch(editor.state.tr.setSelection(selection as unknown as typeof editor.state.tr.selection));

    const result = deleteTableWhenAllCellsSelected({ state: editor.state });
    expect(result).toBe(false);
  });

  it('deletes the entire table when dispatch is provided and all cells selected', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Before</p><table><tr><td><p>A</p></td><td><p>B</p></td></tr></table><p>After</p>',
    });
    selectAllCells(editor);

    const dispatched: any[] = [];
    const result = deleteTableWhenAllCellsSelected({
      state: editor.state,
      dispatch: (tr) => { dispatched.push(tr); },
    });

    expect(result).toBe(true);
    expect(dispatched.length).toBe(1);

    // Apply the transaction to verify
    const tr = dispatched[0];
    const newDoc = tr.doc;
    let hasTable = false;
    newDoc.descendants((node: any) => {
      if (node.type.name === 'table') hasTable = true;
    });
    expect(hasTable).toBe(false);
  });

  it('sets cursor to where the table was after deletion', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Before</p><table><tr><td><p>A</p></td></tr></table><p>After</p>',
    });
    selectAllCells(editor);

    let capturedTr: any = null;
    deleteTableWhenAllCellsSelected({
      state: editor.state,
      dispatch: (tr) => { capturedTr = tr; },
    });

    expect(capturedTr).toBeTruthy();
    expect(capturedTr.selection).toBeInstanceOf(TextSelection);
  });

  it('handles table with multiple rows - deletes all when all cells selected', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
    });
    selectAllCells(editor);

    let dispatched = false;
    const result = deleteTableWhenAllCellsSelected({
      state: editor.state,
      dispatch: () => { dispatched = true; },
    });

    expect(result).toBe(true);
    expect(dispatched).toBe(true);
  });

  it('handles table with header row', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
    });
    selectAllCells(editor);

    const result = deleteTableWhenAllCellsSelected({ state: editor.state });
    expect(result).toBe(true);
  });

  it('returns true without dispatch - validates but does not modify', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>A</p></td></tr></table>',
    });
    selectAllCells(editor);

    const beforeDoc = editor.state.doc;
    const result = deleteTableWhenAllCellsSelected({ state: editor.state });

    expect(result).toBe(true);
    // Document should be unchanged (we only provided state, not dispatch)
    expect(editor.state.doc.eq(beforeDoc)).toBe(true);
  });
});
