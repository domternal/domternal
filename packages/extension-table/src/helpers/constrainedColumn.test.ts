import { describe, it, expect, afterEach, vi } from 'vitest';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection, type Transaction } from '@domternal/pm/state';
import {
  getTableInfo,
  findTableDom,
  getContainerWidth,
  addColumnWithWidths,
} from './constrainedColumn.js';
import { CellSelection, TableMap } from '@domternal/pm/tables';

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

describe('addColumnWithWidths', () => {
  let editor: Editor;
  let host: HTMLDivElement;
  const defaults = { cellMinWidth: 25, defaultCellMinWidth: 100, constrainToContainer: true };

  afterEach(() => {
    editor.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  function mount(widths: (number | null)[], containerWidth: number, content = tableHTML(widths)): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: allExtensions, content });
    const wrapper = host.querySelector('.tableWrapper');
    if (wrapper) {
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, containerWidth + 1, 100));
    }
    focusFirstCell(editor);
  }

  function selectColumn(column: number, row = 0): void {
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    const pos = 1 + map.map[row * map.width + column]!;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))));
  }

  function insert(side: 'before' | 'after', options = defaults): boolean {
    return addColumnWithWidths(side, editor.state, editor.view.dispatch.bind(editor.view), editor.view, options);
  }

  function widths(): number[] {
    return getFirstRowColwidths(editor).flatMap((width) => width ?? [0]);
  }

  it.each([
    { side: 'after' as const, column: 0, expected: [300, 100, 100, 100] },
    { side: 'before' as const, column: 0, expected: [100, 300, 100, 100] },
    { side: 'after' as const, column: 2, expected: [400, 75, 25, 100] },
    { side: 'before' as const, column: 2, expected: [400, 75, 100, 25] },
  ])('uses nearby space for $side at column $column without equalizing unrelated widths', ({ side, column, expected }) => {
    mount([400, 100, 100], 600);
    selectColumn(column);
    expect(insert(side)).toBe(true);
    expect(widths()).toEqual(expected);
  });

  it.each([
    { side: 'before' as const, expected: [235, 100, 25, 240] },
    { side: 'after' as const, expected: [300, 25, 100, 175] },
  ])('prefers the selected neighbor then the opposite neighbor when inserting $side', ({ side, expected }) => {
    mount([300, 60, 240], 600);
    selectColumn(1);
    expect(insert(side)).toBe(true);
    expect(widths()).toEqual(expected);
  });

  it.each([
    { side: 'after' as const, column: 1, expected: [100, 25, 100, 25, 200] },
    { side: 'before' as const, column: 2, expected: [200, 25, 100, 25, 100] },
  ])('skips neighbors already at their floor when inserting $side', ({ side, column, expected }) => {
    mount([200, 25, 25, 200], 450);
    selectColumn(column);
    expect(insert(side)).toBe(true);
    expect(widths()).toEqual(expected);
  });

  it('uses all available spare space before changing a stored width', () => {
    mount([300, 100, 100], 560);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([260, 100, 100, 100]);
  });

  it('preserves every old width and fixes the new width when ample space remains', () => {
    mount([200, 150], 900);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 150]);
    expect(host.querySelector('table')!.style.width).toBe('450px');
    expect(host.querySelector('table')!.style.minWidth).toBe('');
  });

  it('keeps unrelated widths stable across repeated insertions', () => {
    mount([400, 100, 100], 600);
    expect(insert('after')).toBe(true);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 100, 100, 100]);
  });

  it('uses a smaller new column when the remaining capacity is below the default', () => {
    mount([50, 50], 100);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([25, 50, 25]);
  });

  it('keeps the minimum width when adding a column must overflow', () => {
    mount([25, 25], 50);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([25, 25, 25]);
  });

  it('preserves an already overflowing table instead of squeezing it into its container', () => {
    mount([400, 100], 300);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([400, 100, 100]);
  });

  it('respects a configured minimum above the default insertion width', () => {
    mount([200, 150], 900);
    expect(insert('after', { ...defaults, cellMinWidth: 120, defaultCellMinWidth: 80 })).toBe(true);
    expect(widths()).toEqual([200, 120, 150]);
  });

  it.each(['before', 'after'] as const)('preserves all stored widths with constraints disabled for %s', (side) => {
    mount([300, 60, 240], 600);
    selectColumn(1);
    expect(insert(side, { ...defaults, constrainToContainer: false })).toBe(true);
    expect(widths()).toEqual(side === 'before' ? [300, 100, 60, 240] : [300, 60, 100, 240]);
    expect(host.querySelector('table')!.style.width).toBe('700px');
  });

  it('preserves frozen widths and assigns a default when the DOM cannot be measured', () => {
    mount([200, 150], 0);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 150]);
  });

  it('keeps native automatic sizing when no columns have stored widths', () => {
    mount([null, null], 500);
    expect(insert('after')).toBe(true);
    expect(getFirstRowColwidths(editor)).toEqual([null, null, null]);
  });

  it('preserves partial stored widths using defaults when unknown columns cannot be measured', () => {
    mount([200, null, 150], 0);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 100, 150]);
  });

  it('uses current DOM widths for unsized columns without changing stored widths', () => {
    mount([200, null, 150], 900);
    const cells = host.querySelectorAll('th, td');
    cells.forEach((cell, index) => {
      const width = [200, 180, 150][index % 3]!;
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, 50));
      Object.defineProperty(cell, 'offsetWidth', { configurable: true, value: width });
    });
    host.querySelectorAll('col').forEach((col, index) => {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, [200, 180, 150][index], 50));
    });
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 180, 150]);
  });

  it('corrects measured rounding using only unsized columns and preserves explicit widths', () => {
    mount([200, null, null, 150], 900);
    const measured = [200, 75.6, 74.6, 150];
    host.querySelectorAll('col').forEach((col, index) => {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, measured[index], 50));
    });
    vi.spyOn(host.querySelector('table')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 501, 100));
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 76, 74, 150]);
  });

  it('measures cells when column elements return empty rectangles', () => {
    mount([200, null, 150], 900);
    host.querySelectorAll('col').forEach((col) => {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(new DOMRect());
    });
    host.querySelectorAll('th, td').forEach((cell, index) => {
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, [200, 180, 150][index % 3], 50));
    });
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 180, 150]);
  });

  it('prefers unmerged cell measurements and accounts for rowspans below a merged header', () => {
    mount([], 900,
      '<table><tr><th colspan="3" data-colwidth="200,0,0">Header</th></tr>' +
      '<tr><td rowspan="2" data-colwidth="200">A</td><td>B</td><td>C</td></tr>' +
      '<tr><td>D</td><td>E</td></tr></table>',
    );
    const measured: Record<string, number> = { Header: 520, A: 200, B: 180, C: 140, D: 180, E: 140 };
    host.querySelectorAll('col').forEach((col) => {
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(new DOMRect());
    });
    host.querySelectorAll('th, td').forEach((cell) => {
      vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, measured[cell.textContent], 50));
    });
    vi.spyOn(host.querySelector('table')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 521, 150));
    selectColumn(0, 1);
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 180, 140]);
    const table = editor.state.doc.firstChild!;
    expect(table.firstChild!.firstChild!.attrs['colwidth']).toEqual([200, 100, 180, 140]);
    expect(table.child(2).child(1).attrs['colwidth']).toEqual([180]);
    expect(table.child(2).child(2).attrs['colwidth']).toEqual([140]);
    expect(TableMap.get(table).problems).toBeNull();
  });

  it('updates every segment of a colspan crossing the inserted column and preserves cell attributes', () => {
    mount([], 600,
      '<table><tr><th data-colwidth="300">A</th><th data-colwidth="100">B</th><th data-colwidth="200">C</th></tr>' +
      '<tr><td colspan="2" data-colwidth="300,100" data-background="#112233" data-text-align="right"><p>Merged</p></td><td data-colwidth="200">D</td></tr></table>',
    );
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([200, 100, 100, 200]);
    const merged = editor.state.doc.firstChild!.child(1).firstChild!;
    expect(merged.attrs).toMatchObject({ colspan: 3, colwidth: [200, 100, 100], background: '#112233', textAlign: 'right' });
    expect(merged.textContent).toBe('Merged');
    expect(TableMap.get(editor.state.doc.firstChild!).problems).toBeNull();
  });

  it('keeps widths consistent for a merged cell spanning both rows and columns', () => {
    mount([], 600,
      '<table><tr><th data-colwidth="300">A</th><th data-colwidth="100">B</th><th data-colwidth="200">C</th></tr>' +
      '<tr><td rowspan="2" colspan="2" data-colwidth="300,100" data-vertical-align="bottom"><p>Merged</p></td><td data-colwidth="200">D</td></tr>' +
      '<tr><td data-colwidth="200">E</td></tr></table>',
    );
    expect(insert('after')).toBe(true);
    const table = editor.state.doc.firstChild!;
    const merged = table.child(1).firstChild!;
    expect(merged.attrs).toMatchObject({ rowspan: 2, colspan: 3, colwidth: [200, 100, 100], verticalAlign: 'bottom' });
    expect(table.child(2).childCount).toBe(1);
    expect(table.child(2).firstChild!.attrs['colwidth']).toEqual([200]);
    expect(TableMap.get(table).problems).toBeNull();
  });

  it('inserts after the entire selected cell rectangle', () => {
    mount([300, 100, 200], 600);
    const table = editor.state.doc.firstChild!;
    const map = TableMap.get(table);
    const selection = CellSelection.create(editor.state.doc, 1 + map.map[0]!, 1 + map.map[1]!);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    expect(insert('after')).toBe(true);
    expect(widths()).toEqual([300, 25, 100, 175]);
  });

  it('delivers one complete transaction through the supplied dispatch without dispatching the view', () => {
    mount([400, 100, 100], 600);
    const previous = editor.state.doc;
    let captured: Transaction | undefined;
    const dispatch = vi.fn((tr: Transaction) => { captured = tr; });
    const viewDispatch = vi.spyOn(editor.view, 'dispatch');
    expect(addColumnWithWidths('after', editor.state, dispatch, editor.view, defaults)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(viewDispatch).not.toHaveBeenCalled();
    expect(editor.state.doc.eq(previous)).toBe(true);
    expect(captured!.doc.firstChild!.firstChild!.childCount).toBe(4);
    expect(captured!.doc.firstChild!.firstChild!.firstChild!.attrs['colwidth']).toEqual([300]);
  });

  it('checks availability without measuring or mutating the document', () => {
    mount([400, 100, 100], 600);
    const previous = editor.state.doc;
    const measure = vi.spyOn(editor.view, 'domAtPos');
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    expect(addColumnWithWidths('after', editor.state, undefined, editor.view, defaults)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(editor.state.doc.eq(previous)).toBe(true);
  });

  it('returns false outside a table without dispatching', () => {
    mount([], 600, '<p>Outside</p>');
    const dispatch = vi.fn();
    expect(addColumnWithWidths('after', editor.state, dispatch, editor.view, defaults)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
