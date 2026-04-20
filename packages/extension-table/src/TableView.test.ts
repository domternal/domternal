import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import {
  CellSelection,
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

  describe('getCellIndices (via integration)', () => {
    it('correctly identifies cell position in multi-row, multi-col table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr><tr><td><p>D</p></td><td><p>E</p></td><td><p>F</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Access private method via any
      const cellE = view.table.querySelectorAll('td')[4]!;
      // @ts-expect-error - private method
      const indices = view.getCellIndices(cellE);
      expect(indices.row).toBe(1);
      expect(indices.col).toBe(1);
    });

    it('returns { row: 0, col: 0 } when cell has no tr parent', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // Orphan td (no tr parent)
      const orphanCell = document.createElement('td');
      // @ts-expect-error - private method
      const indices = view.getCellIndices(orphanCell);
      expect(indices).toEqual({ row: 0, col: 0 });
    });

    it('accounts for colspan when computing column index', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td colspan="2"><p>Merged</p></td><td><p>B</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const cellB = view.table.querySelectorAll('td')[1]!;
      // @ts-expect-error - private method
      const indices = view.getCellIndices(cellB);
      expect(indices.col).toBe(2);
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

  describe('setCursorInCell', () => {
    it('places cursor inside the target cell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      // @ts-expect-error - private method
      view.setCursorInCell(1, 0);

      // Cursor should now be in the 3rd cell ("C")
      const { $from } = editor.state.selection;
      const textAtCursor = $from.parent.textContent;
      expect(textAtCursor).toBe('C');
    });

    it('does nothing when position is out of bounds (row)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.setCursorInCell(99, 0);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('does nothing when position is out of bounds (col)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.setCursorInCell(0, 99);
      expect(editor.state.selection).toBe(beforeSel);
    });

    it('does nothing with negative coords', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const beforeSel = editor.state.selection;
      // @ts-expect-error - private method
      view.setCursorInCell(-1, 0);
      expect(editor.state.selection).toBe(beforeSel);
    });
  });

  describe('showDropdown / closeDropdown', () => {
    it('showDropdown creates a row dropdown appended to body', () => {
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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

      // @ts-expect-error - private field
      view.headerBtn!.click();

      // Cell should now be tableHeader
      const cell = editor.state.doc.firstChild?.firstChild?.firstChild;
      expect(cell?.type.name).toBe('tableHeader');
    });
  });

  describe('copyThemeClass', () => {
    it('copies dm-theme-* classes from ancestor to dropdown', () => {
      // The editor wrapper must have dm-editor class, and an ancestor with dm-theme-*
      host.className = 'dm-theme-light dm-editor';

      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      const testDropdown = document.createElement('div');
      // @ts-expect-error - private method
      view.copyThemeClass(testDropdown);

      expect(testDropdown.classList.contains('dm-theme-light')).toBe(true);
    });

    it('does nothing when no .dm-editor ancestor exists', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const view = getTableView(editor)!;

      const testDropdown = document.createElement('div');
      const priorClassCount = testDropdown.classList.length;
      // @ts-expect-error - private method
      view.copyThemeClass(testDropdown);

      // No theme class → no change
      expect(testDropdown.classList.length).toBe(priorClassCount);
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

  describe('positionHandles rowspan branch', () => {
    it('handles rowspan cells when positioning row handle', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td rowspan="2"><p>Merged</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr></table>',
      });
      const view = getTableView(editor)!;
      const mergedCell = view.table.querySelector('td[rowspan="2"]')!;

      expect(() => {
        // @ts-expect-error - private method
        view.positionHandles(mergedCell);
      }).not.toThrow();
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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

      // @ts-expect-error - private field
      const triggerBtn = view.colorBtn!;
      // Mock getBoundingClientRect — btnRect.left > innerWidth forces leftPos > innerWidth,
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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
      editor.view.dispatch(editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection));

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
});
