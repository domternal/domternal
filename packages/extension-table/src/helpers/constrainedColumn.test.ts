import { describe, it, expect, afterEach } from 'vitest';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import {
  getTableInfo,
  redistributeColumns,
  findTableDom,
  getContainerWidth,
  constrainedAddColumn,
} from './constrainedColumn.js';
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

  it('skips same cell across rowspan rows (branch: rowspan skip)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td rowspan="2" data-colwidth="200"><p>Merged</p></td><td data-colwidth="200"><p>B</p></td></tr><tr><td data-colwidth="150"><p>C</p></td></tr></table>',
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });
    expect(captured).toBeDefined();

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    // Should not throw, rowspan cell should still be present
    const firstRow = editor.state.doc.firstChild!.firstChild!;
    expect(firstRow.childCount).toBeGreaterThan(0);
  });

  it('handles colspan cells correctly (branch: colspan > 1)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td colspan="2" data-colwidth="200,200"><p>Merged</p></td><td data-colwidth="200"><p>C</p></td></tr></table>',
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    const info = getTableInfo(editor.state)!;
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    // No throw; table structure intact
    const firstRow = editor.state.doc.firstChild!.firstChild!;
    expect(firstRow.childCount).toBeGreaterThan(0);
  });

  it('skips cells that already have target width (branch: colwidth[index] === targetW)', () => {
    editor = new Editor({
      extensions: allExtensions,
      // Column widths already 150 — targeting 600/4 columns = 150 each
      content: '<table><tr><td data-colwidth="150"><p>A</p></td><td data-colwidth="150"><p>B</p></td><td data-colwidth="150"><p>C</p></td></tr></table>',
    });
    focusFirstCell(editor);

    let captured: any;
    addColumnAfter(editor.state, (tr) => { captured = tr; });

    const info = getTableInfo(editor.state)!;
    // 600/4 = 150, matches existing widths → setNodeMarkup skip branch
    redistributeColumns(captured, info.tableStart, 600, 25);
    editor.view.dispatch(captured);

    // No throw
    const firstRow = editor.state.doc.firstChild!.firstChild!;
    expect(firstRow.childCount).toBe(4);
  });

  it('returns early when tableStartPos does not resolve to a table (branch: tableDepth === -1)', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>No table</p>',
    });

    const tr = editor.state.tr;
    // Resolve a position in a non-table doc
    expect(() => { redistributeColumns(tr, 0, 600, 25); }).not.toThrow();
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

// ─── findTableDom ─────────────────────────────────────────────────────────────

describe('findTableDom', () => {
  let editor: InstanceType<typeof Editor> | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
  });

  it('returns null when given an invalid position (catches throw)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([200, 200]),
    });

    // Position out of range triggers throw inside view.domAtPos
    const result = findTableDom(editor.view, 99999);
    expect(result).toBeNull();
  });

  it('returns null when position is not inside a table', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<p>Not a table</p>',
    });

    // Walk up from pos 0 - won't find a TABLE element
    const result = findTableDom(editor.view, 0);
    expect(result).toBeNull();
  });

  it('returns null when view throws on domAtPos (catch block)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([200, 200]),
    });

    // Monkeypatch view.domAtPos to throw
    const origDomAtPos = editor.view.domAtPos.bind(editor.view);
    editor.view.domAtPos = () => { throw new Error('synthetic'); };

    const result = findTableDom(editor.view, 2);
    expect(result).toBeNull();

    // Restore
    editor.view.domAtPos = origDomAtPos;
  });
});

// ─── getContainerWidth ────────────────────────────────────────────────────────

describe('getContainerWidth', () => {
  let editor: InstanceType<typeof Editor> | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
  });

  it('returns 0 when wrapper cannot be found (invalid position)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([200, 200]),
    });

    // Invalid position triggers null in findTableDom, which means no wrapper
    const width = getContainerWidth(editor.view, 99999);
    expect(width).toBe(0);
  });

  it('returns 0 when position is outside any table', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<p>No table here</p>',
    });

    const width = getContainerWidth(editor.view, 0);
    expect(width).toBe(0);
  });
});

// ─── constrainedAddColumn ─────────────────────────────────────────────────────

describe('constrainedAddColumn', () => {
  let editor: InstanceType<typeof Editor> | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
  });

  it('delegates to pmCommand directly when columns are not all frozen', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([null, null]),
    });
    focusFirstCell(editor);

    const pmCommand = addColumnAfter;
    const result = constrainedAddColumn(pmCommand, editor.view, 25, 100);
    expect(result).toBe(true);

    // Should have 3 columns now
    const table = editor.state.doc.firstChild!;
    const firstRow = table.firstChild!;
    expect(firstRow.childCount).toBe(3);
  });

  it('delegates to pmCommand when container width cannot be measured (wrapper not in DOM)', () => {
    // No element attached - view DOM not measurable
    editor = new Editor({
      extensions: allExtensions,
      content: tableHTML([200, 200]),
    });
    focusFirstCell(editor);

    const result = constrainedAddColumn(addColumnAfter, editor.view, 25, 100);
    expect(result).toBe(true); // pmCommand path

    const table = editor.state.doc.firstChild!;
    const firstRow = table.firstChild!;
    expect(firstRow.childCount).toBe(3);
  });

  it('returns false when not in a table (no info)', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: '<p>Not in table</p>',
    });

    const result = constrainedAddColumn(addColumnAfter, editor.view, 25, 100);
    expect(result).toBe(false);
  });

  it('redistributes when frozen columns would overflow container', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([200, 200]), // frozen columns
    });
    focusFirstCell(editor);

    // Mock getBoundingClientRect on the .tableWrapper to return a tight container
    // oldTotal (400) + defaultCellMinWidth (100) = 500 > 420 → redistribute path
    const wrapper = host.querySelector('.tableWrapper')!;
    expect(wrapper).not.toBeNull();
    wrapper.getBoundingClientRect = () => ({
      width: 420,
      height: 100,
      top: 0,
      left: 0,
      right: 420,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const result = constrainedAddColumn(addColumnAfter, editor.view, 25, 100);
    expect(result).toBe(true);

    // Should have 3 columns now, all redistributed
    const table = editor.state.doc.firstChild!;
    const firstRow = table.firstChild!;
    expect(firstRow.childCount).toBe(3);

    // All columns should have colwidth set and sum to ~container width
    const widths = Array.from({ length: firstRow.childCount }, (_, i) => {
      const cw = firstRow.child(i).attrs['colwidth'] as number[] | null;
      return cw?.[0] ?? 0;
    });
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(420);
    expect(total).toBeGreaterThan(0);
  });

  it('takes pmCommand path when frozen but plenty of space', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: allExtensions,
      content: tableHTML([100, 100]),
    });
    focusFirstCell(editor);

    // Huge container → table + new column fits easily (oldTotal 200 + 100 = 300 <= 1000)
    const wrapper = host.querySelector('.tableWrapper')!;
    wrapper.getBoundingClientRect = () => ({
      width: 1000,
      height: 100,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const result = constrainedAddColumn(addColumnAfter, editor.view, 25, 100);
    expect(result).toBe(true);

    // 3 columns but widths NOT redistributed (pmCommand path)
    const table = editor.state.doc.firstChild!;
    const firstRow = table.firstChild!;
    expect(firstRow.childCount).toBe(3);
  });
});
