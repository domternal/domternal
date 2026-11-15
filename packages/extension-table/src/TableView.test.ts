import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor, History } from '@domternal/core';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import {
  CellSelection,
  TableMap,
  addColumn,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
} from '@domternal/pm/tables';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { TableView, tableViewMap } from './TableView.js';

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

function getTableView(editor: Editor): TableView | undefined {
  const container = editor.view.dom.querySelector<HTMLElement>('.dm-table-container');
  if (!container) return undefined;
  return tableViewMap.get(container);
}

/** TableView members the tests read and drive. */
interface ViewInternals {
  hoveredCell: HTMLTableCellElement | null;
  hoveredRow: number;
  hoveredCol: number;
  suppressCellToolbar: boolean;
  colHandle: HTMLButtonElement;
  rowHandle: HTMLButtonElement;
  cellToolbar: HTMLElement;
  colorBtn: HTMLButtonElement;
  cellRect(cell: HTMLTableCellElement): { left: number; top: number; right: number; bottom: number } | null;
  selectRow(row: number): boolean;
  selectColumn(col: number): boolean;
}

function internals(view: TableView): ViewInternals {
  return view as unknown as ViewInternals;
}

/** A table's cell texts by row, with spans written out, such as `Title(cs3)` or `A(rs2)`. */
function rowsOf(table: PMNode): string[][] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const colspan = cell.attrs['colspan'] as number;
      const rowspan = cell.attrs['rowspan'] as number;
      cells.push(cell.textContent + (colspan > 1 ? `(cs${String(colspan)})` : '') + (rowspan > 1 ? `(rs${String(rowspan)})` : ''));
    });
    rows.push(cells);
  });
  return rows;
}

/** The texts of the selected cells in table order, empty without a cell selection. */
function selectedTexts(editor: Editor): string[] {
  const texts: string[] = [];
  const { selection } = editor.state;
  if (selection instanceof CellSelection) selection.forEachCell((cell) => { texts.push(cell.textContent); });
  return texts;
}

/** The position of the cell with this text. */
function cellPosOf(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.textContent === text) found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error(`No cell ${text}`);
  return found;
}

/** The DOM cell with this text in the view's table, a nested table's cells included. */
function cellOf(view: TableView, text: string): HTMLTableCellElement {
  const cell = Array.from(view.table.querySelectorAll<HTMLTableCellElement>('td, th')).find((candidate) => candidate.textContent === text);
  if (!cell) throw new Error(`No cell ${text}`);
  return cell;
}

/** Move the pointer over the cells with these texts, in this order. */
function hover(view: TableView, ...texts: string[]): void {
  for (const text of texts) cellOf(view, text).dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
}

/** The label of the open row or column menu, or null. */
function menuLabel(): string | null {
  return document.querySelector('.dm-table-controls-dropdown')?.getAttribute('aria-label') ?? null;
}

/** Click the open menu's item with this label. False when no open menu offers it. */
function choose(label: string): boolean {
  const item = document.querySelector<HTMLButtonElement>(`.dm-table-controls-dropdown button[aria-label="${label}"]`);
  item?.click();
  return item !== null;
}

type Box = [left: number, top: number, width: number, height: number];

function rectOf([left, top, width, height]: Box): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) };
}

/**
 * Give the view fixed boxes, as a browser would lay them out: the container at the origin, the
 * table at (20, 20) with rows 30px tall, and each named cell the box given for it.
 */
function layout(view: TableView, cells: Record<string, Box>): void {
  view.dom.getBoundingClientRect = () => rectOf([0, 0, 400, 200]);
  view.table.getBoundingClientRect = () => rectOf([20, 20, 300, 30 * view.table.rows.length]);
  Array.from(view.table.rows).forEach((row, index) => {
    row.getBoundingClientRect = () => rectOf([20, 20 + 30 * index, 300, 30]);
  });
  for (const [text, box] of Object.entries(cells)) {
    cellOf(view, text).getBoundingClientRect = () => rectOf(box);
  }
}

describe('TableView', () => {
  let editor: Editor | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
  });

  describe('construction', () => {
    it('creates a TableView instance when a table is rendered', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor);
      expect(view).toBeDefined();
      expect(view).toBeInstanceOf(TableView);
    });

    it('exposes dom, table, colgroup, and contentDOM nodes', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.dom).toBeInstanceOf(HTMLElement);
      expect(view.dom.className).toBe('dm-table-container');
      expect(view.table).toBeInstanceOf(HTMLTableElement);
      expect(view.colgroup).toBeInstanceOf(HTMLElement);
      expect(view.contentDOM).toBeInstanceOf(HTMLElement);
      expect(view.contentDOM.tagName).toBe('TBODY');
    });

    it('registers the dom element in tableViewMap', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(tableViewMap.get(view.dom)).toBe(view);
    });

    it('has default cellMinWidth and defaultCellMinWidth', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.cellMinWidth).toBe(25);
      expect(view.defaultCellMinWidth).toBe(100);
    });
  });

  describe('update', () => {
    it('returns true when node type matches', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const tableNode = editor.state.doc.firstChild!;
      expect(view.update(tableNode)).toBe(true);
    });

    it('returns false when given node of different type', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Create a paragraph node (different type)
      const paragraphNode = editor.schema.nodes['paragraph']!.create();
      expect(view.update(paragraphNode)).toBe(false);
    });
  });

  describe('ignoreMutation', () => {
    it('does not ignore selection mutations', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.ignoreMutation({ type: 'selection' })).toBe(false);
    });

    it('ignores attribute mutations', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const mutation = {
        type: 'attributes',
        target: view.table,
      } as unknown as MutationRecord;
      expect(view.ignoreMutation(mutation)).toBe(true);
    });
  });

  describe('hideForResize / showAfterResize', () => {
    it('hideForResize sets resize flag', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideForResize();
      // @ts-expect-error - private field
      expect(view._resizeDragging).toBe(true);
    });

    it('showAfterResize clears resize flag', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideForResize();
      view.showAfterResize();
      // @ts-expect-error - private field
      expect(view._resizeDragging).toBe(false);
    });
  });

  describe('showCellHandle / hideCellHandle', () => {
    it('hideCellHandle sets display empty and clears cellHandleCell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideCellHandle();
      // @ts-expect-error - private field
      expect(view.cellHandleCell).toBeNull();
    });

    it('showCellHandle does nothing during resize drag', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideForResize(); // sets _resizeDragging = true

      const cell = view.table.querySelector('td')!;
      view.showCellHandle(cell);

      // @ts-expect-error - private field
      expect(view.cellHandleCell).toBeNull();
    });

    it('showCellHandle sets cellHandleCell when not resizing', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;

      view.showCellHandle(cell);

      // @ts-expect-error - private field
      expect(view.cellHandleCell).toBe(cell);
    });
  });

  describe('updateCellHandle', () => {
    it('hides cell toolbar when active=false', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // @ts-expect-error - private field access for test
      view.cellToolbar.style.display = 'flex';

      view.updateCellHandle(false);

      // @ts-expect-error - private field
      expect(view.cellToolbar.style.display).toBe('');
    });

    it('hides cell toolbar when resize dragging', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideForResize();

      // @ts-expect-error - private field
      view.cellToolbar.style.display = 'flex';

      view.updateCellHandle(true);

      // @ts-expect-error - private field
      expect(view.cellToolbar.style.display).toBe('');
    });

    it('hides toolbar when active=true but no cells are selected', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // No .selectedCell elements → fallback path
      view.updateCellHandle(true);

      // @ts-expect-error - private field
      expect(view.cellToolbar.style.display).toBe('');
    });
  });

  describe('destroy', () => {
    it('removes dom from tableViewMap', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const dom = view.dom;

      view.destroy();

      expect(tableViewMap.get(dom)).toBeUndefined();
    });
  });

  describe('cellRect (via integration)', () => {
    it('gives a cell its rectangle in the table map', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).cellRect(cellOf(view, 'E'))).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
    });

    it('returns null for a cell that is not in the table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).cellRect(document.createElement('td'))).toBeNull();
    });

    it('covers every column of a colspan cell and counts the columns after it', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td colspan="2"><p>Merged</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).cellRect(cellOf(view, 'Merged'))).toEqual({ left: 0, top: 0, right: 2, bottom: 1 });
      expect(internals(view).cellRect(cellOf(view, 'B'))).toEqual({ left: 2, top: 0, right: 3, bottom: 1 });
    });

    it('places a cell beside a rowspan cell from the row above in its own column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>E</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).cellRect(cellOf(view, 'E'))).toEqual({ left: 1, top: 1, right: 2, bottom: 2 });
      expect(internals(view).cellRect(cellOf(view, 'A'))).toEqual({ left: 0, top: 0, right: 1, bottom: 2 });
    });

    it('returns null for a cell of a nested table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><table><tr><td><p>n1</p></td><td><p>n2</p></td></tr></table></td><td><p>Y</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).cellRect(cellOf(view, 'n1'))).toBeNull();
      expect(internals(view).cellRect(cellOf(view, 'n1n2'))).toEqual({ left: 0, top: 0, right: 1, bottom: 1 });
      expect(internals(view).cellRect(cellOf(view, 'Y'))).toEqual({ left: 1, top: 0, right: 2, bottom: 1 });
    });
  });

  describe('selectRow / selectColumn', () => {
    it('selectRow creates CellSelection spanning the row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.selectRow(1);
      expect(editor.state.selection).toBeInstanceOf(CellSelection);
    });

    it('selectColumn creates CellSelection spanning the column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.selectColumn(0);
      expect(editor.state.selection).toBeInstanceOf(CellSelection);
    });

    it('selectRow does nothing when row is out of bounds', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.selectRow(99);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('selectColumn does nothing when col is out of bounds', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.selectColumn(99);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('selectRow does nothing with negative row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.selectRow(-1);
      expect(editor.state.selection).toBe(beforeSel);
    });
  });

  describe('line selection (selectRow / selectColumn)', () => {
    it('selects only the cells lying wholly in the row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>E</p></td><td><p>F</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(internals(view).selectRow(1)).toBe(true);
      expect(selectedTexts(editor)).toEqual(['E', 'F']);
    });

    it('returns false and keeps the selection for a row out of bounds', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      expect(internals(view).selectRow(99)).toBe(false);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('returns false and keeps the selection for a column out of bounds', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      expect(internals(view).selectColumn(99)).toBe(false);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('returns false and keeps the selection for a negative column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      expect(internals(view).selectColumn(-1)).toBe(false);
      expect(editor.state.selection).toBe(beforeSel);
    });
  });

  describe('showDropdown / closeDropdown', () => {
    it('showDropdown creates a row dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.hoveredRow = 0;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown');
      expect(dropdown).not.toBeNull();
      expect(dropdown?.getAttribute('aria-label')).toBe('Row options');
      expect(dropdown?.querySelectorAll('button').length).toBe(3);
    });

    it('showDropdown creates a column dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.hoveredCol = 0;
      // @ts-expect-error - private method
      view.showDropdown('column');

      const dropdown = document.querySelector('.dm-table-controls-dropdown');
      expect(dropdown).not.toBeNull();
      expect(dropdown?.getAttribute('aria-label')).toBe('Column options');
    });

    it('closeDropdown removes the dropdown and resets state', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');
      view.suppressCellToolbar = true;

      // @ts-expect-error - private method
      view.closeDropdown();

      expect(document.querySelector('.dm-table-controls-dropdown')).toBeNull();
      expect(view.suppressCellToolbar).toBe(false);
    });

    it('showDropdown replaces existing dropdown (closes previous)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');
      // @ts-expect-error - private method
      view.showDropdown('column');

      // Only one dropdown should exist at a time
      const dropdowns = document.querySelectorAll('.dm-table-controls-dropdown');
      expect(dropdowns.length).toBe(1);
      expect(dropdowns[0]?.getAttribute('aria-label')).toBe('Column options');
    });

    it('showDropdown mounts the dropdown inside .dm-editor when present', () => {
      host.className = 'dm-editor';
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.hoveredRow = 0;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = host.querySelector('.dm-table-controls-dropdown');
      expect(dropdown).not.toBeNull();
      expect(dropdown?.parentElement).toBe(host);
    });

    it('closeDropdown does nothing if no dropdown exists', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // No dropdown open
      expect(() => {
        // @ts-expect-error - private method
        view.closeDropdown();
      }).not.toThrow();
    });

    it('falls back to document.body when no .dm-editor ancestor exists', () => {
      // host has no `dm-editor` class, so closest('.dm-editor') is null.
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown');
      expect(dropdown?.parentElement).toBe(document.body);
    });

    it('dropdown is a descendant of the theme-classed editor so tokens cascade', () => {
      // copyThemeClass() was removed: theme custom properties now reach the
      // dropdown purely because it is a DOM descendant of the themed editor.
      host.className = 'dm-editor dm-theme-dark';
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown');
      expect(dropdown?.closest('.dm-theme-dark')).toBe(host);
    });
  });

  describe('floating cleanup (autoUpdate teardown)', () => {
    it('closeDropdown invokes the floating-ui cleanup and clears the ref', () => {
      host.className = 'dm-editor';
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const cleanup = vi.fn();
      // @ts-expect-error - private field: swap the real autoUpdate cleanup for a spy
      view.dropdownCleanup = cleanup;

      // @ts-expect-error - private method
      view.closeDropdown();

      expect(cleanup).toHaveBeenCalledTimes(1);
      // @ts-expect-error - private field
      expect(view.dropdownCleanup).toBeNull();
    });

    it('NodeView destroy tears down an open dropdown and its floating cleanup', () => {
      host.className = 'dm-editor';
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const cleanup = vi.fn();
      // @ts-expect-error - private field
      view.dropdownCleanup = cleanup;

      editor.destroy();

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(document.querySelector('.dm-table-controls-dropdown')).toBeNull();
    });
  });

  describe('onDocKeyDown / onDocMouseDown', () => {
    it('Escape key closes open dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      // @ts-expect-error - private method
      view.onDocKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(document.querySelector('.dm-table-controls-dropdown')).toBeNull();
    });

    it('non-Escape key does nothing', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      // @ts-expect-error - private method
      view.onDocKeyDown({ key: 'a' } as KeyboardEvent);

      expect(document.querySelector('.dm-table-controls-dropdown')).not.toBeNull();
    });

    it('mousedown inside dropdown does not close it', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');
      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;

      // @ts-expect-error - private method
      view.onDocMouseDown({ target: dropdown } as MouseEvent);

      expect(document.querySelector('.dm-table-controls-dropdown')).not.toBeNull();
    });

    it('mousedown outside dropdown closes it', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');
      const outsideEl = document.body;

      // @ts-expect-error - private method
      view.onDocMouseDown({ target: outsideEl } as MouseEvent);

      expect(document.querySelector('.dm-table-controls-dropdown')).toBeNull();
    });

    it('mousedown on colHandle does not close dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showDropdown('row');

      // @ts-expect-error - private field
      const target = view.colHandle;
      // @ts-expect-error - private method
      view.onDocMouseDown({ target } as MouseEvent);

      expect(document.querySelector('.dm-table-controls-dropdown')).not.toBeNull();
    });
  });

  describe('updateColumns', () => {
    it('creates col elements for each column in the first row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cols = view.colgroup.querySelectorAll('col');
      expect(cols.length).toBe(3);
    });

    it('sets col.style.width when cell has explicit colwidth', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td data-colwidth="200"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cols = view.colgroup.querySelectorAll('col');
      expect((cols[0] as HTMLElement).style.width).toBe('200px');
      expect((cols[1] as HTMLElement).style.width).toBe('150px');
    });

    it('handles node with no first child (empty/invalid) without throwing', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Empty paragraph with no firstChild - simulate early return
      const emptyParagraph = editor.schema.nodes['paragraph']!.create();
      expect(() => {
        // @ts-expect-error - private method
        view.updateColumns(emptyParagraph);
      }).not.toThrow();
    });

    it('sets table.style.width when fixed width is achievable', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td data-colwidth="200"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.table.style.width).toBe('350px');
      expect(view.table.style.minWidth).toBe('');
    });

    it('floors a table WITHOUT explicit widths at defaultCellMinWidth per column', () => {
      // Without the floor, `width: 100%` in a narrow container (a layout
      // column) crushed the cells to slivers; the min-width makes the
      // wrapper's overflow-x scroll instead.
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.table.style.minWidth).toBe('300px'); // 3 x defaultCellMinWidth 100
      expect(view.table.style.width).toBe('');
    });

    it('mixed columns floor at colwidth + default for the rest', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td data-colwidth="200"><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      expect(view.table.style.minWidth).toBe('300px'); // 200 + default 100
      expect(view.table.style.width).toBe('');
    });
  });

  describe('dispatchCellSelection (via dispatchCellSelection private)', () => {
    it('dispatches a CellSelection via internal method', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);

      // @ts-expect-error - private method
      view.dispatchCellSelection(sel);

      expect(editor.state.selection).toBeInstanceOf(CellSelection);
    });
  });

  describe('execRowCmd / execColCmd', () => {
    it('execRowCmd adds a new row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;

      // @ts-expect-error - private method
      view.execRowCmd(addRowAfter);

      expect(editor.state.doc.firstChild?.childCount).toBe(2);
    });

    it('execColCmd adds a new column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;

      // @ts-expect-error - private method
      view.execColCmd(addColumnAfter);

      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
    });

    it('execRowCmd deletes entire table when deleting last row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;

      // @ts-expect-error - private method
      view.execRowCmd(deleteRow);

      // Table should be gone
      let hasTable = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'table') hasTable = true;
      });
      expect(hasTable).toBe(false);
    });

    it('execColCmd deletes entire table when deleting last column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        // Table with constrainToContainer false so deleteColumn direct path is used
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.constrainToContainer = false;
      // @ts-expect-error - private field
      view.hoveredCol = 0;

      // @ts-expect-error - private method
      view.execColCmd(deleteColumn);

      let hasTable = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'table') hasTable = true;
      });
      expect(hasTable).toBe(false);
    });
  });

  describe('onColClick / onRowClick', () => {
    it('onColClick triggers column selection and shows dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;

      // @ts-expect-error - private method
      view.onColClick();

      expect(view.suppressCellToolbar).toBe(true);
      expect(document.querySelector('.dm-table-controls-dropdown')).not.toBeNull();
      expect(document.querySelector('.dm-table-controls-dropdown')?.getAttribute('aria-label')).toBe('Column options');
    });

    it('onRowClick triggers row selection and shows dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;

      // @ts-expect-error - private method
      view.onRowClick();

      expect(view.suppressCellToolbar).toBe(true);
      expect(document.querySelector('.dm-table-controls-dropdown')?.getAttribute('aria-label')).toBe('Row options');
    });
  });

  describe('onCellHandleClick', () => {
    it('does nothing when cellHandleCell is null', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method (cellHandleCell is null by default)
      view.onCellHandleClick();

      expect(editor.state.selection).toBe(beforeSel);
    });

    it('creates a CellSelection for the active cell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;

      // @ts-expect-error - private field
      view.cellHandleCell = cell;
      // @ts-expect-error - private method
      view.onCellHandleClick();

      // Selection should have $anchorCell/$headCell (CellSelection markers)
      expect((editor.state.selection as any).$anchorCell).toBeDefined();
      expect((editor.state.selection as any).$headCell).toBeDefined();
    });
  });

  describe('onMouseMove / onMouseLeave', () => {
    it('onMouseMove does nothing during resize drag', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      view.hideForResize();

      const cell = view.table.querySelector('td')!;
      // @ts-expect-error - private method
      view.onMouseMove({ target: cell } as unknown as MouseEvent);

      // @ts-expect-error - private field
      expect(view.hoveredCell).toBeNull();
    });

    it('onMouseMove does nothing when target is not an HTMLElement', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.onMouseMove({ target: null } as unknown as MouseEvent);

      // @ts-expect-error - private field
      expect(view.hoveredCell).toBeNull();
    });

    it('onMouseMove does nothing when target is outside a cell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.onMouseMove({ target: document.body } as unknown as MouseEvent);

      // @ts-expect-error - private field
      expect(view.hoveredCell).toBeNull();
    });

    it('onMouseMove tracks hoveredCell when target is a cell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;

      // @ts-expect-error - private method
      view.onMouseMove({ target: cell } as unknown as MouseEvent);

      // @ts-expect-error - private field
      expect(view.hoveredCell).toBe(cell);
    });

    it('onMouseMove does nothing when same cell is already hovered', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;

      // @ts-expect-error - private method
      view.onMouseMove({ target: cell } as unknown as MouseEvent);
      const firstHover = (view as any).hoveredCell;

      // Second time same cell
      // @ts-expect-error - private method
      view.onMouseMove({ target: cell } as unknown as MouseEvent);
      expect((view as any).hoveredCell).toBe(firstHover);
    });
  });

  describe('cancelHide', () => {
    it('clears the pending hide timeout', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.onMouseLeave();

      // @ts-expect-error - private field
      expect(view.hideTimeout).not.toBeNull();

      // @ts-expect-error - private method
      view.cancelHide();

      // @ts-expect-error - private field
      expect(view.hideTimeout).toBeNull();
    });
  });

  describe('hideHandles', () => {
    it('hides handles by resetting display', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showHandles();
      // @ts-expect-error - private method
      view.hideHandles();

      // @ts-expect-error - private field
      expect(view.colHandle.style.display).toBe('');
      // @ts-expect-error - private field
      expect(view.rowHandle.style.display).toBe('');
    });

    it('does not hide handles when dropdown is open', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.showHandles();
      // @ts-expect-error - private method
      view.showDropdown('row');

      // @ts-expect-error - private method
      view.hideHandles();

      // @ts-expect-error - private field
      expect(view.colHandle.style.display).toBe('flex');
    });
  });

  describe('row dropdown button clicks', () => {
    it('clicking "Insert Row Above" adds a row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Insert Row Above"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.childCount).toBe(2);
    });

    it('clicking "Insert Row Below" adds a row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Insert Row Below"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.childCount).toBe(2);
    });

    it('clicking "Delete Row" removes a row', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;
      // @ts-expect-error - private method
      view.showDropdown('row');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Delete Row"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.childCount).toBe(1);
    });
  });

  describe('column dropdown button clicks', () => {
    it('clicking "Insert Column Left" adds a column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;
      // @ts-expect-error - private method
      view.showDropdown('column');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Insert Column Left"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
    });

    it('clicking "Insert Column Right" adds a column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;
      // @ts-expect-error - private method
      view.showDropdown('column');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Insert Column Right"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
    });

    it('clicking "Delete Column" removes a column', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;
      // @ts-expect-error - private method
      view.showDropdown('column');

      const dropdown = document.querySelector('.dm-table-controls-dropdown')!;
      const btn = dropdown.querySelector<HTMLButtonElement>('button[aria-label="Delete Column"]')!;
      btn.click();

      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(1);
    });
  });

  describe('showColorDropdown', () => {
    it('creates a color dropdown with reset + swatch buttons', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;
      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);

      const dropdown = document.querySelector('.dm-table-cell-dropdown')!;
      expect(dropdown).not.toBeNull();
      expect(dropdown.getAttribute('aria-label')).toBe('Cell background color');
      expect(dropdown.querySelector<HTMLButtonElement>('.dm-color-palette-reset')).not.toBeNull();
      expect(dropdown.querySelectorAll('.dm-color-swatch').length).toBeGreaterThan(0);
    });

    it('clicking reset color removes background', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td style="background:red"><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Select the cell first
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;
      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);

      const reset = document.querySelector<HTMLButtonElement>('.dm-color-palette-reset')!;
      reset.click();

      // Dropdown should close
      expect(document.querySelector('.dm-table-cell-dropdown')).toBeNull();
    });

    it('clicking a color swatch sets background', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;
      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);

      const swatch = document.querySelector<HTMLButtonElement>('.dm-color-swatch')!;
      swatch.click();

      // Dropdown should close after click
      expect(document.querySelector('.dm-table-cell-dropdown')).toBeNull();
    });

    it('second click on open trigger closes dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;

      // Open
      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);
      expect(document.querySelector('.dm-table-cell-dropdown')).not.toBeNull();

      // Second call with same trigger (btn has --open class) → closes
      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);
      expect(document.querySelector('.dm-table-cell-dropdown')).toBeNull();
    });
  });

  describe('showAlignmentDropdown', () => {
    it('creates an alignment dropdown with 6 items (3 horizontal + 3 vertical)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.alignBtn!;
      // @ts-expect-error - private method
      view.showAlignmentDropdown(triggerBtn);

      const dropdown = document.querySelector('.dm-table-cell-align-dropdown')!;
      expect(dropdown).not.toBeNull();
      expect(dropdown.getAttribute('aria-label')).toBe('Cell alignment');
      const items = dropdown.querySelectorAll('.dm-table-align-item');
      expect(items.length).toBe(6);
    });

    it('clicking "Align center" sets textAlign to center', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.alignBtn!;
      // @ts-expect-error - private method
      view.showAlignmentDropdown(triggerBtn);

      const center = document.querySelector<HTMLButtonElement>('[aria-label="Align center"]')!;
      center.click();

      const cell = editor.state.doc.firstChild?.firstChild?.firstChild;
      expect(cell?.attrs['textAlign']).toBe('center');
    });

    it('clicking "Align middle" sets verticalAlign to middle', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.alignBtn!;
      // @ts-expect-error - private method
      view.showAlignmentDropdown(triggerBtn);

      const middle = document.querySelector<HTMLButtonElement>('[aria-label="Align middle"]')!;
      middle.click();

      const cell = editor.state.doc.firstChild?.firstChild?.firstChild;
      expect(cell?.attrs['verticalAlign']).toBe('middle');
    });
  });

  describe('buildCellToolbar button actions', () => {
    it('merge button triggers mergeCells command', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Select both cells
      const sel = CellSelection.create(editor.state.doc, 2, 7);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      view.mergeBtn!.click();

      // After merge, first row should have 1 cell with colspan=2
      const firstCell = editor.state.doc.firstChild?.firstChild?.firstChild;
      expect(firstCell?.attrs['colspan']).toBe(2);
    });

    it('split button triggers splitCell command', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td colspan="2"><p>A</p></td></tr><tr><td><p>B</p></td><td><p>C</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Select merged cell
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      view.splitBtn!.click();

      // After split, first row should have 2 cells
      expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
    });

    it('header button toggles tableHeader', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      view.headerBtn!.click();

      // Cell should now be tableHeader
      const cell = editor.state.doc.firstChild?.firstChild?.firstChild;
      expect(cell?.type.name).toBe('tableHeader');
    });
  });

  describe('handle click events (colHandle, rowHandle, cellHandle)', () => {
    it('colHandle click triggers onColClick', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredCol = 0;
      // @ts-expect-error - private field
      view.colHandle.click();

      expect(document.querySelector('.dm-table-controls-dropdown')?.getAttribute('aria-label')).toBe('Column options');
    });

    it('rowHandle click triggers onRowClick', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private field
      view.hoveredRow = 0;
      // @ts-expect-error - private field
      view.rowHandle.click();

      expect(document.querySelector('.dm-table-controls-dropdown')?.getAttribute('aria-label')).toBe('Row options');
    });

    it('cellHandle click triggers onCellHandleClick', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;
      // @ts-expect-error - private field
      view.cellHandleCell = cell;
      // @ts-expect-error - private field
      view.cellHandle.click();

      // Selection becomes CellSelection
      expect((editor.state.selection as any).$anchorCell).toBeDefined();
    });

    it('createHandle mousedown prevents default', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Fire mousedown on colHandle
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      // @ts-expect-error - private field
      view.colHandle.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('cellHandle mousedown prevents default', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      // @ts-expect-error - private field
      view.cellHandle.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('ignoreMutation edge cases', () => {
    it('non-MutationRecord-like object with non-selection/attributes type returns false', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Plain object (not instanceof MutationRecord) with childList type
      // Hits the final `return false` since it's not selection, not attributes,
      // and not an instanceof MutationRecord
      const mutation = { type: 'childList', target: view.contentDOM } as unknown as MutationRecord;
      expect(view.ignoreMutation(mutation)).toBe(false);
    });
  });

  describe('update clears invalid cellHandleCell', () => {
    it('hides cell handle when cellHandleCell is no longer in the table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Set cellHandleCell to an orphan element
      const orphan = document.createElement('td');
      // @ts-expect-error - private field
      view.cellHandleCell = orphan;

      // Call update - should trigger hideCellHandle because orphan not in table
      const tableNode = editor.state.doc.firstChild!;
      view.update(tableNode);

      // @ts-expect-error - private field
      expect(view.cellHandleCell).toBeNull();
    });
  });

  describe('positionHandles over a rowspan cell', () => {
    it('puts the row handle on the first row of a rowspan cell entered directly', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td rowspan="2"><p>Merged</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      layout(view, { Merged: [20, 20, 100, 60], B: [120, 20, 100, 30], C: [120, 50, 100, 30] });
      // @ts-expect-error: private method
      view.onMouseMove({ target: cellOf(view, 'Merged') } as unknown as MouseEvent);

      // Row 0 spans 20px to 50px: its centre, 35px, less half the 24px handle.
      expect(internals(view).hoveredRow).toBe(0);
      expect(internals(view).rowHandle.style.top).toBe('23px');
      expect(internals(view).rowHandle.style.display).toBe('flex');
    });
  });

  describe('onMouseLeave setTimeout', () => {
    it('hideTimeout fires after delay, hiding handles', async () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cell = view.table.querySelector('td')!;

      // @ts-expect-error - private method
      view.onMouseMove({ target: cell } as unknown as MouseEvent);
      // @ts-expect-error - private method
      view.onMouseLeave();

      // Wait for setTimeout (200ms)
      await new Promise((r) => setTimeout(r, 250));

      // @ts-expect-error - private field
      expect(view.hoveredCell).toBeNull();
    });
  });

  describe('positionToolbarDropdown viewport-aware positioning', () => {
    it('shifts left when dropdown would overflow viewport', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Mock innerWidth to something tiny so the check triggers
      const origWidth = window.innerWidth;
      Object.defineProperty(window, 'innerWidth', { value: 100, configurable: true });

      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;
      // Mock getBoundingClientRect - btnRect.left > innerWidth forces leftPos > innerWidth,
      // so leftPos + dropdownWidth > innerWidth branch fires.
      triggerBtn.getBoundingClientRect = () => ({
        left: 200,
        right: 220,
        top: 0,
        bottom: 20,
        width: 20,
        height: 20,
        x: 200,
        y: 0,
        toJSON: () => ({}),
      });

      // @ts-expect-error - private method
      view.showColorDropdown(triggerBtn);

      const dropdown = document.querySelector<HTMLElement>('.dm-table-cell-dropdown')!;
      expect(dropdown).not.toBeNull();
      // leftPos got shifted left - should be <= innerWidth
      const leftStyle = parseFloat(dropdown.style.left);
      expect(leftStyle).toBeLessThanOrEqual(100);

      // Restore
      Object.defineProperty(window, 'innerWidth', { value: origWidth, configurable: true });
    });
  });

  describe('toolbar button mousedown prevents default', () => {
    it('merge button mousedown preventsDefault', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Toolbar buttons have mousedown handler to prevent editor blur
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      // @ts-expect-error - private field
      view.mergeBtn!.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    it('color button mousedown preventsDefault', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      // @ts-expect-error - private field
      view.colorBtn!.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });
  });

  describe('ignoreMutation with real MutationRecord', () => {
    it('returns true for childList mutation outside contentDOM', async () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Create real MutationObserver to get real MutationRecord
      const records = await new Promise<MutationRecord[]>((resolve) => {
        const observer = new MutationObserver((recs) => {
          observer.disconnect();
          resolve(recs);
        });
        observer.observe(view.dom, { childList: true, subtree: true });
        // Add a child to colHandle (outside contentDOM)
        // @ts-expect-error - private field
        view.colHandle.appendChild(document.createElement('span'));
      });

      expect(records.length).toBeGreaterThan(0);
      expect(view.ignoreMutation(records[0]!)).toBe(true);
    });
  });

  describe('cell toolbar button click listeners', () => {
    it('colorBtn click opens color dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      view.colorBtn!.click();

      const dropdown = document.querySelector('.dm-table-cell-dropdown');
      expect(dropdown?.getAttribute('aria-label')).toBe('Cell background color');
    });

    it('alignBtn click opens alignment dropdown', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(editor.state.tr.setSelection(sel));

      // @ts-expect-error - private field
      view.alignBtn!.click();

      const dropdown = document.querySelector('.dm-table-cell-align-dropdown');
      expect(dropdown?.getAttribute('aria-label')).toBe('Cell alignment');
    });
  });

  describe('closeDropdown clears toolbar button open state', () => {
    it('removes dm-table-cell-toolbar-btn--open class from buttons', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      // Manually mark a toolbar button as open
      // @ts-expect-error - private field
      view.colorBtn!.classList.add('dm-table-cell-toolbar-btn--open');

      // Open and close a dropdown
      // @ts-expect-error - private method
      view.showColorDropdown(view.colorBtn!);
      // @ts-expect-error - private method
      view.closeDropdown();

      // @ts-expect-error - private field
      expect(view.colorBtn!.classList.contains('dm-table-cell-toolbar-btn--open')).toBe(false);
    });
  });

  describe('row and column handles with merged cells', () => {
    const TITLE3 = '<table><tr><th colspan="3"><p>Title</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>';
    const TITLE2 = '<table><tr><th colspan="2"><p>T</p></th><th><p>X</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>';
    const CAT2 = '<table><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>E</p></td><td><p>F</p></td></tr></table>';
    const CAT3 = '<table><tr><td rowspan="2"><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>E</p></td><td><p>F</p></td></tr><tr><td><p>G</p></td><td><p>H</p></td><td><p>I</p></td></tr></table>';
    const PLAIN = '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>';
    const OTHER = '<table><tr><td><p>P</p></td><td><p>Q</p></td></tr><tr><td><p>R</p></td><td><p>S</p></td></tr></table>';
    const NESTED_TABLE = '<table><tr><td><p>n1</p></td><td><p>n2</p></td></tr><tr><td><p>n3</p></td><td><p>n4</p></td></tr></table>';
    const NESTED = `<table><tr><td>${NESTED_TABLE}</td><td><p>Y</p></td></tr><tr><td><p>Z</p></td><td><p>W</p></td></tr></table>`;

    const TITLE3_BOXES: Record<string, Box> = {
      Title: [20, 20, 300, 30],
      A: [20, 50, 100, 30], B: [120, 50, 100, 30], C: [220, 50, 100, 30],
      D: [20, 80, 100, 30], E: [120, 80, 100, 30], F: [220, 80, 100, 30],
    };
    const CAT3_BOXES: Record<string, Box> = {
      A: [20, 20, 100, 60], B: [120, 20, 100, 30], C: [220, 20, 100, 30],
      E: [120, 50, 100, 30], F: [220, 50, 100, 30],
      G: [20, 80, 100, 30], H: [120, 80, 100, 30], I: [220, 80, 100, 30],
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function mount(html: string): Editor {
      const created = new Editor({ element: host, extensions: [...allExtensions, History], content: html });
      // Column resizing reads the pointer's coordinates, which jsdom cannot map to a position.
      vi.spyOn(created.view, 'posAtCoords').mockReturnValue(null);
      return created;
    }

    /** The view of the table container at this index, in document order. */
    function viewAt(index = 0): TableView {
      const container = editor?.view.dom.querySelectorAll<HTMLElement>('.dm-table-container')[index];
      const view = container ? tableViewMap.get(container) : undefined;
      if (!view) throw new Error(`No table view at ${String(index)}`);
      return view;
    }

    /** A top-level table's rows, or null when that table is gone. */
    function grid(index = 0): string[][] | null {
      const tables: PMNode[] = [];
      editor?.state.doc.forEach((node) => { if (node.type.name === 'table') tables.push(node); });
      const table = tables[index];
      return table ? rowsOf(table) : null;
    }

    /** Text typed into a cell from elsewhere, such as by a collaborator, leaving the selection alone. */
    function typeInto(text: string): void {
      editor!.view.dispatch(editor!.state.tr.insertText('x', cellPosOf(editor!, text) + 2));
    }

    /** A column added at the left edge of the first table from elsewhere, leaving the selection alone. */
    function addColumnElsewhere(): void {
      const table = editor!.state.doc.firstChild!;
      const map = TableMap.get(table);
      editor!.view.dispatch(addColumn(editor!.state.tr, { map, table, tableStart: 1, left: 0, top: 0, right: 1, bottom: 1 }, 0));
    }

    describe('column handle under a merged title row', () => {
      it.each([
        ['A', ['A', 'D'], [['Title(cs2)'], ['B', 'C'], ['E', 'F']]],
        ['B', ['B', 'E'], [['Title(cs2)'], ['A', 'C'], ['D', 'F']]],
        ['C', ['C', 'F'], [['Title(cs2)'], ['A', 'B'], ['D', 'E']]],
      ])('Delete Column on column %s under a full-width title row removes only that column', (text, selected, rows) => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, text);
        internals(view).colHandle.click();
        expect(menuLabel()).toBe('Column options');
        expect(selectedTexts(editor)).toEqual(selected);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual(rows);
      });

      it('Delete Column under a title merged over two columns removes one column', () => {
        editor = mount(TITLE2);
        const view = viewAt();
        hover(view, 'B');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['B', 'E']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['T', 'X'], ['A', 'C'], ['D', 'F']]);
      });

      it.each([
        ['C', 'Insert Column Left', [['Title(cs4)'], ['A', 'B', '', 'C'], ['D', 'E', '', 'F']]],
        ['A', 'Insert Column Right', [['Title(cs4)'], ['A', '', 'B', 'C'], ['D', '', 'E', 'F']]],
      ])('hovering %s, %s beside a merged title inserts next to that column', (text, action, rows) => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, text);
        internals(view).colHandle.click();
        expect(choose(action)).toBe(true);
        expect(grid()).toEqual(rows);
      });

      it('Insert Column Left beside a merged title keeps every column width', () => {
        editor = mount(
          '<table><tr><th colspan="3" data-colwidth="100,100,100"><p>Title</p></th></tr>'
          + '<tr><td data-colwidth="100"><p>A</p></td><td data-colwidth="100"><p>B</p></td><td data-colwidth="100"><p>C</p></td></tr></table>',
        );
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        expect(choose('Insert Column Left')).toBe(true);
        expect(grid()).toEqual([['Title(cs4)'], ['A', 'B', '', 'C']]);
        const table = editor.state.doc.firstChild!;
        expect(table.child(0).child(0).attrs['colwidth']).toEqual([100, 100, 100, 100]);
        expect(table.child(1).child(2).attrs['colwidth']).toEqual([100]);
      });

      it('Insert Column Right on the last column puts the new column beside the title', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        expect(choose('Insert Column Right')).toBe(true);
        expect(grid()).toEqual([['Title(cs3)', ''], ['A', 'B', 'C', ''], ['D', 'E', 'F', '']]);
      });

      it('Delete Column on a column a merged row interrupts removes its own cells and narrows that row', () => {
        editor = mount('<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td colspan="3"><p>M</p></td></tr><tr><td><p>G</p></td><td><p>H</p></td><td><p>I</p></td></tr></table>');
        const view = viewAt();
        hover(view, 'B');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['B', 'H']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['A', 'C'], ['M(cs2)'], ['G', 'I']]);
      });

      it('undo restores a column deleted under a title row in one step', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs2)'], ['A', 'B'], ['D', 'E']]);
        expect(editor.commands.undo()).toBe(true);
        expect(grid()).toEqual([['Title(cs3)'], ['A', 'B', 'C'], ['D', 'E', 'F']]);
        expect(editor.commands.undo()).toBe(false);
      });
    });

    describe('row handle beside a merged first column', () => {
      it.each([
        ['E', ['E', 'F'], [['A', 'B', 'C']]],
        ['B', ['B', 'C'], [['A', 'E', 'F']]],
      ])('Delete Row on the row of %s removes that row and shortens the merged cell', (text, selected, rows) => {
        editor = mount(CAT2);
        const view = viewAt();
        hover(view, text);
        internals(view).rowHandle.click();
        expect(menuLabel()).toBe('Row options');
        expect(selectedTexts(editor)).toEqual(selected);
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual(rows);
      });

      it('Delete Row in a taller table removes only the hovered row', () => {
        editor = mount(CAT3);
        const view = viewAt();
        hover(view, 'E');
        internals(view).rowHandle.click();
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual([['A', 'B', 'C'], ['G', 'H', 'I']]);
      });

      it.each([
        ['E', 'Insert Row Above'],
        ['B', 'Insert Row Below'],
      ])('hovering %s, %s inside a merged block lengthens the merged cell', (text, action) => {
        editor = mount(CAT3);
        const view = viewAt();
        hover(view, text);
        internals(view).rowHandle.click();
        expect(choose(action)).toBe(true);
        expect(grid()).toEqual([['A(rs3)', 'B', 'C'], ['', ''], ['E', 'F'], ['G', 'H', 'I']]);
      });

      it('Delete Row beside a merged header column keeps that header cell', () => {
        editor = mount('<table><tr><th rowspan="2"><p>A</p></th><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>E</p></td><td><p>F</p></td></tr><tr><th><p>G</p></th><td><p>H</p></td><td><p>I</p></td></tr></table>');
        const view = viewAt();
        hover(view, 'E');
        internals(view).rowHandle.click();
        expect(selectedTexts(editor)).toEqual(['E', 'F']);
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual([['A', 'B', 'C'], ['G', 'H', 'I']]);
        expect(editor.state.doc.firstChild!.child(0).child(0).type.name).toBe('tableHeader');
      });
    });

    describe('targeting', () => {
      it('a cell below a rowspan cell targets its own column', () => {
        editor = mount(CAT2);
        const view = viewAt();
        hover(view, 'E');
        expect(internals(view).hoveredCol).toBe(1);
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['B', 'E']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['A(rs2)', 'C'], ['F']]);
      });

      it('Insert Column Right from a cell below a rowspan cell inserts after its own column', () => {
        editor = mount(CAT2);
        const view = viewAt();
        hover(view, 'E');
        internals(view).colHandle.click();
        expect(choose('Insert Column Right')).toBe(true);
        expect(grid()).toEqual([['A(rs2)', 'B', '', 'C'], ['E', '', 'F']]);
      });

      it('crossing a merged title keeps the column handle on its column', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        layout(view, TITLE3_BOXES);
        hover(view, 'C');
        // Column C spans 220px to 320px: its centre, 270px, less half the 24px handle.
        expect(internals(view).colHandle.style.left).toBe('258px');
        expect(internals(view).rowHandle.style.top).toBe('53px');
        hover(view, 'Title');
        expect(internals(view).hoveredCol).toBe(2);
        expect(internals(view).colHandle.style.left).toBe('258px');
        expect(internals(view).rowHandle.style.top).toBe('23px');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['C', 'F']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs2)'], ['A', 'B'], ['D', 'E']]);
      });

      it('crossing a merged first column keeps the row handle on its row', () => {
        editor = mount(CAT3);
        const view = viewAt();
        layout(view, CAT3_BOXES);
        hover(view, 'E');
        expect(internals(view).rowHandle.style.top).toBe('53px');
        hover(view, 'A');
        expect(internals(view).hoveredRow).toBe(1);
        expect(internals(view).rowHandle.style.top).toBe('53px');
        // The column handle follows to the merged cell's column.
        expect(internals(view).colHandle.style.left).toBe('58px');
        internals(view).rowHandle.click();
        expect(selectedTexts(editor)).toEqual(['E', 'F']);
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual([['A', 'B', 'C'], ['G', 'H', 'I']]);
      });

      it('centres the column handle on its column when the columns run right to left', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        view.table.dir = 'rtl';
        layout(view, {
          Title: [20, 20, 300, 30],
          A: [220, 50, 100, 30], B: [120, 50, 100, 30], C: [20, 50, 100, 30],
          D: [220, 80, 100, 30], E: [120, 80, 100, 30], F: [20, 80, 100, 30],
        });
        hover(view, 'C', 'Title');
        expect(internals(view).hoveredCol).toBe(2);
        expect(internals(view).colHandle.style.left).toBe('58px');
      });

      it('an open menu keeps its column while the pointer crosses other cells', () => {
        editor = mount(PLAIN);
        const view = viewAt();
        layout(view, {
          A: [20, 20, 100, 30], B: [120, 20, 100, 30], C: [220, 20, 100, 30],
          D: [20, 50, 100, 30], E: [120, 50, 100, 30], F: [220, 50, 100, 30],
        });
        hover(view, 'B');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['B', 'E']);
        hover(view, 'C', 'F');
        expect(internals(view).hoveredCol).toBe(1);
        expect(internals(view).colHandle.style.left).toBe('158px');
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['A', 'C'], ['D', 'F']]);
      });

      it('a cell toolbar dropdown leaves the handles free to target another column', () => {
        editor = mount(PLAIN);
        const view = viewAt();
        const b = cellPosOf(editor, 'B');
        editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, b, b)));
        internals(view).colorBtn.click();
        expect(document.querySelector('.dm-color-palette')).not.toBeNull();
        hover(view, 'C');
        expect(internals(view).hoveredCol).toBe(2);
        internals(view).colHandle.click();
        expect(menuLabel()).toBe('Column options');
        expect(document.querySelector('.dm-color-palette')).toBeNull();
        expect(selectedTexts(editor)).toEqual(['C', 'F']);
      });

      it('hides a handle whose line has no cell of its own, and its click opens nothing', () => {
        editor = mount('<table><tr><td colspan="2"><p>X</p></td></tr><tr><td colspan="2"><p>Y</p></td></tr></table>');
        const view = viewAt();
        hover(view, 'X');
        expect(internals(view).colHandle.style.display).toBe('');
        expect(internals(view).rowHandle.style.display).toBe('flex');
        const doc = editor.state.doc;
        internals(view).colHandle.click();
        expect(menuLabel()).toBeNull();
        expect(internals(view).suppressCellToolbar).toBe(false);
        expect(editor.state.doc).toBe(doc);
      });

      it('selects all of the only column of a table, a rowspan cell included', () => {
        editor = mount('<table><tr><td rowspan="2"><p>A</p></td></tr><tr></tr><tr><td><p>B</p></td></tr></table>');
        const view = viewAt();
        hover(view, 'B');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['A', 'B']);
        expect(choose('Delete Column')).toBe(true);
        // Deleting the only column deletes the table.
        expect(grid()).toBeNull();
      });

      it('offers the only column of a table whose one cell spans every row, but no row', () => {
        editor = mount('<table><tr><td rowspan="2"><p>A</p></td></tr><tr></tr></table>');
        const view = viewAt();
        hover(view, 'A');
        expect(internals(view).colHandle.style.display).toBe('flex');
        expect(internals(view).rowHandle.style.display).toBe('');
        internals(view).colHandle.click();
        expect(menuLabel()).toBe('Column options');
        expect(selectedTexts(editor)).toEqual(['A']);
      });
    });

    describe('table changes while the handles are in use', () => {
      it('a table update between hover and click keeps the handle on its column', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        typeInto('A');
        internals(view).colHandle.click();
        expect(menuLabel()).toBe('Column options');
        expect(selectedTexts(editor)).toEqual(['C', 'F']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs2)'], ['xA', 'B'], ['D', 'E']]);
      });

      it('a table update between hover and click leaves a table holding the selection alone', () => {
        editor = mount(`${PLAIN}<p>between</p>${OTHER}`);
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellPosOf(editor, 'Q') + 2)));
        const view = viewAt(0);
        hover(view, 'C');
        typeInto('A');
        internals(view).colHandle.click();
        expect(choose('Delete Column')).toBe(true);
        expect(grid(0)).toEqual([['xA', 'B'], ['D', 'E']]);
        expect(grid(1)).toEqual([['P', 'Q'], ['R', 'S']]);
      });

      it('a menu acts on the column it opened on after a table update', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        typeInto('A');
        expect(menuLabel()).toBe('Column options');
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs2)'], ['xA', 'B'], ['D', 'E']]);
      });

      it('a menu acts on its column when the selection moved meanwhile', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        const a = cellPosOf(editor, 'A');
        editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, a, a)));
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs2)'], ['A', 'B'], ['D', 'E']]);
      });

      it('a merge from elsewhere that keeps the table size leaves the handle on its column', () => {
        editor = mount('<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr><tr><td><p>G</p></td><td><p>H</p></td><td><p>I</p></td></tr></table>');
        const view = viewAt();
        hover(view, 'H');
        // D takes over E's column, as a collaborator's merge leaves it.
        const d = cellPosOf(editor, 'D');
        const e = cellPosOf(editor, 'E');
        const merged = editor.state.tr.delete(e, e + editor.state.doc.nodeAt(e)!.nodeSize);
        editor.view.dispatch(merged.setNodeMarkup(d, null, { ...editor.state.doc.nodeAt(d)!.attrs, colspan: 2 }));
        expect(grid()).toEqual([['A', 'B', 'C'], ['D(cs2)', 'F'], ['G', 'H', 'I']]);
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['B', 'H']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['A', 'C'], ['D', 'F'], ['G', 'I']]);
      });

      it('a change in table size resets the targeted line and hides the handles', () => {
        editor = mount(PLAIN);
        const view = viewAt();
        hover(view, 'C');
        expect(internals(view).colHandle.style.display).toBe('flex');
        addColumnElsewhere();
        expect([internals(view).hoveredRow, internals(view).hoveredCol]).toEqual([-1, -1]);
        expect(internals(view).colHandle.style.display).toBe('');
        expect(internals(view).rowHandle.style.display).toBe('');
      });

      it('a change in table size closes an open column menu, which then reopens on the moved column', () => {
        editor = mount(PLAIN);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        addColumnElsewhere();
        expect(menuLabel()).toBeNull();
        expect(internals(view).suppressCellToolbar).toBe(false);
        expect(internals(view).colHandle.style.display).toBe('');
        hover(view, 'C');
        internals(view).colHandle.click();
        expect(selectedTexts(editor)).toEqual(['C', 'F']);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['', 'A', 'B'], ['', 'D', 'E']]);
      });

      it('a column menu opened over a row menu keeps the cell toolbar away through its insert', () => {
        editor = mount(PLAIN);
        const view = viewAt();
        hover(view, 'B');
        internals(view).rowHandle.click();
        expect(menuLabel()).toBe('Row options');
        internals(view).colHandle.click();
        expect(menuLabel()).toBe('Column options');
        expect(internals(view).suppressCellToolbar).toBe(true);
        expect(selectedTexts(editor)).toEqual(['B', 'E']);
        expect(choose('Insert Column Left')).toBe(true);
        expect(grid()).toEqual([['A', '', 'B', 'C'], ['D', '', 'E', 'F']]);
        expect(internals(view).cellToolbar.style.display).toBe('');
      });

      it('a menu left open when the editor turns read-only changes nothing', () => {
        editor = mount(TITLE3);
        const view = viewAt();
        hover(view, 'C');
        internals(view).colHandle.click();
        editor.setEditable(false);
        expect(choose('Delete Column')).toBe(true);
        expect(grid()).toEqual([['Title(cs3)'], ['A', 'B', 'C'], ['D', 'E', 'F']]);
      });
    });

    describe('nested tables', () => {
      it('outer handles ignore the cells of a nested table', () => {
        editor = mount(NESTED);
        const outer = viewAt(0);
        const inner = viewAt(1);
        hover(outer, 'W', 'n1');
        expect(internals(outer).hoveredCell).toBe(cellOf(outer, 'W'));
        expect([internals(outer).hoveredRow, internals(outer).hoveredCol]).toEqual([1, 1]);
        expect([internals(inner).hoveredRow, internals(inner).hoveredCol]).toEqual([0, 0]);
      });

      it('Delete Row on an outer row leaves the nested table intact', () => {
        editor = mount(NESTED);
        const outer = viewAt(0);
        hover(outer, 'Z');
        internals(outer).rowHandle.click();
        expect(selectedTexts(editor)).toEqual(['Z', 'W']);
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual([['n1n2n3n4', 'Y']]);
        expect(rowsOf(editor.state.doc.firstChild!.child(0).child(0).child(0))).toEqual([['n1', 'n2'], ['n3', 'n4']]);
      });

      it('an outer row below a nested table is targeted by its own index', () => {
        editor = mount(`<table><tr><td>${NESTED_TABLE}</td><td><p>Y</p></td></tr><tr><td><p>Z</p></td><td><p>W</p></td></tr><tr><td><p>P</p></td><td><p>Q</p></td></tr><tr><td><p>R</p></td><td><p>S</p></td></tr></table>`);
        const outer = viewAt(0);
        hover(outer, 'Z');
        expect(internals(outer).hoveredRow).toBe(1);
        internals(outer).rowHandle.click();
        expect(choose('Delete Row')).toBe(true);
        expect(grid()).toEqual([['n1n2n3n4', 'Y'], ['P', 'Q'], ['R', 'S']]);
      });
    });
  });
});
