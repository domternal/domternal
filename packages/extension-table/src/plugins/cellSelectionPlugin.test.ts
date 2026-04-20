import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { CellSelection } from '@domternal/pm/tables';
import { Table } from '../Table.js';
import { TableRow } from '../TableRow.js';
import { TableCell } from '../TableCell.js';
import { TableHeader } from '../TableHeader.js';
import { tableViewMap } from '../TableView.js';

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

describe('cellSelectionPlugin', () => {
  let editor: Editor | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    (document as any).elementFromPoint = () => null;
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
  });

  describe('cross-table handle transitions', () => {
    it('hides handle on previous table when cursor moves to another table cell', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table><table><tr><td><p>B</p></td></tr></table>',
      });

      // Find positions of cells in each table
      const cellPositions: { pos: number; tableIdx: number }[] = [];
      let currentTable = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'table') currentTable++;
        if (node.type.name === 'tableCell') {
          cellPositions.push({ pos, tableIdx: currentTable });
        }
      });

      // Place cursor in first table's cell (inside paragraph)
      const firstCellPos = cellPositions[0]!.pos + 2;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(firstCellPos))),
      );

      // Should have registered first table as lastHandleView
      const containers = host.querySelectorAll('.dm-table-container');
      expect(containers.length).toBe(2);

      // Move cursor to second table's cell
      const secondCellPos = cellPositions[1]!.pos + 2;
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(secondCellPos))),
      );

      // Both tables should exist; first table's cell handle should be hidden
      const firstView = tableViewMap.get(containers[0] as HTMLElement);
      const secondView = tableViewMap.get(containers[1] as HTMLElement);
      expect(firstView).toBeDefined();
      expect(secondView).toBeDefined();
      // @ts-expect-error - private field
      expect(firstView!.cellHandleCell).toBeNull();
    });

    it('hides handle on previous table when CellSelection starts in another table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table><table><tr><td><p>B</p></td></tr></table>',
      });

      const cellPositions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell') cellPositions.push(pos);
      });

      // Cursor in first table → sets lastHandleView = tv1
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(cellPositions[0]! + 2))),
      );

      // Now start a CellSelection in the second table
      const sel = CellSelection.create(editor.state.doc, cellPositions[1]!, cellPositions[1]);
      editor.view.dispatch(
        editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection),
      );

      // First table's handle should be hidden after CellSelection in second
      const containers = host.querySelectorAll('.dm-table-container');
      const firstView = tableViewMap.get(containers[0] as HTMLElement);
      expect(firstView).toBeDefined();
      // @ts-expect-error - private field
      expect(firstView!.cellHandleCell).toBeNull();
    });
  });

  describe('resize drag coordination', () => {
    it('calls hideForResize when column-resize-dragging decoration appears', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const container = host.querySelector<HTMLElement>('.dm-table-container')!;
      const view = tableViewMap.get(container)!;

      // Manually add column-resize-dragging class to a cell
      const cell = view.table.querySelector('td') as HTMLElement;
      cell.classList.add('column-resize-dragging');

      // Force plugin update by dispatching a no-op transaction
      editor.view.dispatch(editor.state.tr);

      // @ts-expect-error - private field
      expect(view._resizeDragging).toBe(true);

      // Clear the class to simulate resize end
      cell.classList.remove('column-resize-dragging');
      editor.view.dispatch(editor.state.tr);

      // @ts-expect-error - private field
      expect(view._resizeDragging).toBe(false);
    });
  });

  describe('decoration state', () => {
    it('adds dm-cell-focused class to cell containing cursor (not during CellSelection)', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      // Place cursor inside the cell
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(4))),
      );

      // Find cell in DOM with focused class
      const focused = host.querySelector('.dm-cell-focused');
      expect(focused).not.toBeNull();
    });

    it('does not add dm-cell-focused during CellSelection', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });

      const sel = CellSelection.create(editor.state.doc, 2, 2);
      editor.view.dispatch(
        editor.state.tr.setSelection(sel as unknown as typeof editor.state.tr.selection),
      );

      const focused = host.querySelector('.dm-cell-focused');
      expect(focused).toBeNull();
    });

    it('does not add dm-cell-focused when cursor is outside a table', () => {
      editor = new Editor({
        element: host,
        extensions: allExtensions,
        content: '<p>Outside</p><table><tr><td><p>Inside</p></td></tr></table>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(2))),
      );

      const focused = host.querySelector('.dm-cell-focused');
      expect(focused).toBeNull();
    });
  });
});
