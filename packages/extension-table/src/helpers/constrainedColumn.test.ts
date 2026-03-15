import { describe, it, expect, afterEach } from 'vitest';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { getTableInfo, redistributeColumns } from './constrainedColumn.js';
import { addColumnAfter, addColumnBefore } from '@domternal/pm/tables';

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

/** HTML for a 2-row × N-col table with optional colwidths. */
function tableHTML(colwidths: (number | null)[]): string {
  const makeCell = (tag: string, w: number | null): string => {
    const attr = w ? ` data-colwidth="${String(w)}"` : '';
    return `<${tag}${attr}><p>X</p></${tag}>`;
  };
  const headerRow = colwidths.map((w) => makeCell('th', w)).join('');
  const dataRow = colwidths.map((w) => makeCell('td', w)).join('');
  return `<table><tr>${headerRow}</tr><tr>${dataRow}</tr></table>`;
}

/** Place cursor inside the first cell of the table. */
function focusFirstCell(editor: InstanceType<typeof Editor>): void {
  const doc = editor.state.doc;
  let cellPos = 0;
  doc.nodesBetween(0, doc.content.size, (node, p) => {
    if (cellPos > 0) return false;
    if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
      cellPos = p + 1; // inside the cell
      return false;
    }
    return true;
  });
  if (cellPos > 0) {
    const sel = TextSelection.near(editor.state.doc.resolve(cellPos));
    editor.view.dispatch(editor.state.tr.setSelection(sel));
  }
}

/** Get colwidths from first row of table in editor state. */
function getFirstRowColwidths(editor: InstanceType<typeof Editor>): (number[] | null)[] {
  const table = editor.state.doc.firstChild!;
  const firstRow = table.firstChild!;
  const result: (number[] | null)[] = [];
  for (let i = 0; i < firstRow.childCount; i++) {
    result.push(firstRow.child(i).attrs['colwidth'] as number[] | null);
  }
  return result;
}

// ─── getTableInfo ─────────────────────────────────────────────────────────────

describe('getTableInfo', () => {
  let editor: InstanceType<typeof Editor> | undefined;

  afterEach(() => {
    editor?.destroy();
  });

  it('returns null when cursor is not in a table', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });
    const info = getTableInfo(editor.state);
    expect(info).toBeNull();
  });

  it('returns allFrozen true when all columns have colwidth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 150, 250]),
    });
    focusFirstCell(editor);
    const info = getTableInfo(editor.state);
    expect(info).not.toBeNull();
    expect(info!.allFrozen).toBe(true);
    expect(info!.oldWidths).toEqual([200, 150, 250]);
  });

  it('returns allFrozen false when some columns lack colwidth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, null, 250]),
    });
    focusFirstCell(editor);
    const info = getTableInfo(editor.state);
    expect(info).not.toBeNull();
    expect(info!.allFrozen).toBe(false);
    expect(info!.oldWidths[1]).toBe(0);
  });

  it('returns allFrozen false when no columns have colwidth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([null, null, null]),
    });
    focusFirstCell(editor);
    const info = getTableInfo(editor.state);
    expect(info).not.toBeNull();
    expect(info!.allFrozen).toBe(false);
  });

  it('returns correct tableStart position', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200]),
    });
    focusFirstCell(editor);
    const info = getTableInfo(editor.state);
    expect(info).not.toBeNull();
    expect(info!.tableStart).toBeGreaterThan(0);
  });
});

// ─── redistributeColumns ──────────────────────────────────────────────────────

describe('redistributeColumns', () => {
  let editor: InstanceType<typeof Editor> | undefined;

  afterEach(() => {
    editor?.destroy();
  });

  it('distributes equal widths across all columns', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200, 200]),
    });
    focusFirstCell(editor);

    // Capture addColumnAfter transaction
    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });
    expect(captured).toBeDefined();

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    // 4 columns, each 150px
    const cw = getFirstRowColwidths(editor);
    expect(cw).toHaveLength(4);
    for (const c of cw) {
      expect(c).not.toBeNull();
      expect(c![0]).toBe(150);
    }
  });

  it('distributes with unequal source widths (equal output)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([400, 100, 100]),
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    const cw = getFirstRowColwidths(editor);
    expect(cw).toHaveLength(4);
    // All columns get equal share: 600/4 = 150
    for (const c of cw) {
      expect(c![0]).toBe(150);
    }
  });

  it('clamps column widths at cellMinWidth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([50, 50]),
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    // Target 60px across 3 cols → 20px each, but cellMinWidth=25 → clamped to 25
    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 60, 25);
    editor.view.dispatch(captured);

    const cw = getFirstRowColwidths(editor);
    expect(cw).toHaveLength(3);
    for (const c of cw) {
      expect(c![0]).toBeGreaterThanOrEqual(25);
    }
  });

  it('adjusts last column for rounding remainder', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200, 200]),
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    // 601px / 4 = 150.25 → floor = 150, 4*150 = 600, diff = 1
    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 601, 25);
    editor.view.dispatch(captured);

    const cw = getFirstRowColwidths(editor);
    expect(cw).toHaveLength(4);
    const sum = cw.reduce((s, c) => s + c![0]!, 0);
    expect(sum).toBe(601);
    // Last column absorbs the remainder
    expect(cw[3]![0]).toBe(151);
  });

  it('works with addColumnBefore', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200, 200]),
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnBefore(editor.state, (tr) => { captured = tr; });

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    const cw = getFirstRowColwidths(editor);
    expect(cw).toHaveLength(4);
    for (const c of cw) {
      expect(c![0]).toBe(150);
    }
  });

  it('applies widths to all rows not just first', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200, 200]),
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    // Check second row too
    const table = editor.state.doc.firstChild!;
    const secondRow = table.child(1);
    for (let i = 0; i < secondRow.childCount; i++) {
      const cw = secondRow.child(i).attrs['colwidth'] as number[] | null;
      expect(cw).not.toBeNull();
      expect(cw![0]).toBe(150);
    }
  });
});
