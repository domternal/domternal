/**
 * Table Node
 *
 * Block-level table container using HTML <table>.
 * Built on prosemirror-tables for cell selection, keyboard nav, and table editing.
 *
 * Commands (18):
 * - insertTable: Insert new table with configurable rows/cols/header
 * - deleteTable: Delete entire table
 * - addRowBefore / addRowAfter: Insert row
 * - deleteRow: Delete current row
 * - addColumnBefore / addColumnAfter: Insert column
 * - deleteColumn: Delete current column
 * - mergeCells: Merge selected cells into one
 * - splitCell: Split a merged cell back to individual cells
 * - toggleHeaderRow / toggleHeaderColumn / toggleHeaderCell: Toggle header
 * - setCellAttribute: Set cell attribute
 * - goToNextCell / goToPreviousCell: Cell navigation
 * - fixTables: Repair malformed tables
 * - setCellSelection: Programmatic cell selection
 *
 * Features:
 * - goToNextCell/goToPreviousCell exposed as standalone commands
 * - fixTables exposed as command
 * - setCellSelection for programmatic cell range selection
 * - Fully typed options and command params
 * - Framework-agnostic: TableView isolated for wrapper replacement
 */

import { Node } from '@domternal/core';
import type { CommandSpec, ToolbarItem } from '@domternal/core';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';
import {
  tableEditing,
  columnResizing,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
  toggleHeader,
  toggleHeaderCell,
  setCellAttr,
  goToNextCell,
  fixTables,
  CellSelection,
} from 'prosemirror-tables';

import { TableView } from './TableView.js';
import { createTable } from './helpers/createTable.js';
import { deleteTableWhenAllCellsSelected } from './helpers/deleteTableWhenAllCellsSelected.js';
import { createResizeSuppressionPlugin } from './plugins/resizeSuppressionPlugin.js';
import { createCellSelectionPlugin } from './plugins/cellSelectionPlugin.js';

declare module '@domternal/core' {
  interface RawCommands {
    insertTable: CommandSpec<[options?: { rows?: number; cols?: number; withHeaderRow?: boolean }]>;
    deleteTable: CommandSpec;
    addRowBefore: CommandSpec;
    addRowAfter: CommandSpec;
    deleteRow: CommandSpec;
    addColumnBefore: CommandSpec;
    addColumnAfter: CommandSpec;
    deleteColumn: CommandSpec;
    toggleHeaderRow: CommandSpec;
    toggleHeaderColumn: CommandSpec;
    toggleHeaderCell: CommandSpec;
    mergeCells: CommandSpec;
    splitCell: CommandSpec;
    setCellAttribute: CommandSpec<[name: string, value: unknown]>;
    goToNextCell: CommandSpec;
    goToPreviousCell: CommandSpec;
    fixTables: CommandSpec;
    setCellSelection: CommandSpec<[position: { anchorCell: number; headCell?: number }]>;
  }
}

export interface TableOptions {
  /**
   * Custom HTML attributes for the rendered table element.
   */
  HTMLAttributes: Record<string, unknown>;

  /**
   * Minimum cell width in pixels (floor when dragging).
   * @default 25
   */
  cellMinWidth: number;

  /**
   * Default width for columns without an explicit colwidth attribute.
   * Must match the columnResizing plugin default for consistent resize behavior.
   * @default 100
   */
  defaultCellMinWidth: number;

  /**
   * Allow selecting the entire table as a node selection.
   * @default false
   */
  allowTableNodeSelection: boolean;

  /**
   * Custom NodeView constructor. Override to provide framework-specific rendering.
   * Set to null to disable custom NodeView.
   */
  View: (new (node: PMNode, cellMinWidth: number, view: EditorView, defaultCellMinWidth?: number) => NodeView) | null;
}

export const Table = Node.create<TableOptions>({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  tableRole: 'table',
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      cellMinWidth: 25,
      defaultCellMinWidth: 100,
      allowTableNodeSelection: false,
      View: TableView,
    };
  },

  parseHTML() {
    return [{ tag: 'table' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['table', { ...this.options.HTMLAttributes, ...HTMLAttributes }, ['tbody', 0]];
  },

  addNodeView() {
    const ViewClass = this.options.View;
    const cellMinWidth = this.options.cellMinWidth;
    const defaultCellMinWidth = this.options.defaultCellMinWidth;

    if (!ViewClass) {
      return undefined as unknown as NodeViewConstructor;
    }

    return ((node: PMNode, view: EditorView) =>
      new ViewClass(node, cellMinWidth, view, defaultCellMinWidth)) as unknown as NodeViewConstructor;
  },

  addCommands() {
    return {
      insertTable:
        (options?: { rows?: number; cols?: number; withHeaderRow?: boolean }) =>
        ({ state, tr, dispatch }) => {
          // Prevent insertion inside tables and code blocks
          const $from = state.selection.$from;
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'table') return false;
            if (node.type.spec.code) return false;
          }

          const rows = options?.rows ?? 3;
          const cols = options?.cols ?? 3;
          const withHeaderRow = options?.withHeaderRow ?? true;
          const table = createTable(state.schema, rows, cols, withHeaderRow);

          if (!dispatch) {
            return true;
          }

          const offset = tr.selection.from + 1;
          tr.replaceSelectionWith(table)
            .scrollIntoView()
            .setSelection(TextSelection.near(tr.doc.resolve(offset)));
          dispatch(tr);

          return true;
        },

      deleteTable:
        () =>
        ({ state, dispatch }) => {
          return deleteTable(state, dispatch);
        },

      addRowBefore:
        () =>
        ({ state, dispatch }) => {
          return addRowBefore(state, dispatch);
        },

      addRowAfter:
        () =>
        ({ state, dispatch }) => {
          return addRowAfter(state, dispatch);
        },

      deleteRow:
        () =>
        ({ state, dispatch }) => {
          return deleteRow(state, dispatch);
        },

      addColumnBefore:
        () =>
        ({ state, dispatch }) => {
          return addColumnBefore(state, dispatch);
        },

      addColumnAfter:
        () =>
        ({ state, dispatch }) => {
          return addColumnAfter(state, dispatch);
        },

      deleteColumn:
        () =>
        ({ state, dispatch }) => {
          return deleteColumn(state, dispatch);
        },

      toggleHeaderRow:
        () =>
        ({ state, dispatch }) => {
          return toggleHeader('row')(state, dispatch);
        },

      toggleHeaderColumn:
        () =>
        ({ state, dispatch }) => {
          return toggleHeader('column')(state, dispatch);
        },

      toggleHeaderCell:
        () =>
        ({ state, dispatch }) => {
          return toggleHeaderCell(state, dispatch);
        },

      mergeCells:
        () =>
        ({ state, dispatch }) => {
          return mergeCells(state, dispatch);
        },

      splitCell:
        () =>
        ({ state, dispatch }) => {
          return splitCell(state, dispatch);
        },

      setCellAttribute:
        (name: string, value: unknown) =>
        ({ state, dispatch }) => {
          return setCellAttr(name, value)(state, dispatch);
        },

      goToNextCell:
        () =>
        ({ state, dispatch }) => {
          return goToNextCell(1)(state, dispatch);
        },

      goToPreviousCell:
        () =>
        ({ state, dispatch }) => {
          return goToNextCell(-1)(state, dispatch);
        },

      fixTables:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            const tr = fixTables(state);
            if (tr) dispatch(tr);
          }
          return true;
        },

      setCellSelection:
        (position: { anchorCell: number; headCell?: number }) =>
        ({ tr, dispatch }) => {
          const selection = CellSelection.create(
            tr.doc,
            position.anchorCell,
            position.headCell,
          );
          tr.setSelection(selection as unknown as typeof tr.selection);
          if (dispatch) {
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const editor = this.editor;

    /** Check if cursor is inside a list item (defer Tab/Shift-Tab to list extensions). */
    const isInListItem = (): boolean => {
      if (!editor) return false;
      const { $from } = editor.state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        const name = $from.node(d).type.name;
        if (name === 'listItem' || name === 'taskItem') return true;
      }
      return false;
    };

    /** Delete the entire table when all cells are selected (Backspace/Delete). */
    const deleteTableHandler = (): boolean => {
      if (!editor) return false;
      return deleteTableWhenAllCellsSelected({
        state: editor.state,
        dispatch: editor.view.dispatch,
      });
    };

    return {
      Tab: () => {
        if (!editor || isInListItem()) return false;

        // Try to move to next cell
        if (editor.commands['goToNextCell']?.()) {
          return true;
        }

        // If no next cell, add a row and move into it
        if (editor.commands['addRowAfter']?.()) {
          editor.commands['goToNextCell']?.();
          return true;
        }

        return false;
      },

      'Shift-Tab': () => {
        if (!editor || isInListItem()) return false;
        return editor.commands['goToPreviousCell']?.() ?? false;
      },

      Backspace: deleteTableHandler,
      'Mod-Backspace': deleteTableHandler,
      Delete: deleteTableHandler,
      'Mod-Delete': deleteTableHandler,
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'insertTable',
        command: 'insertTable',
        icon: 'table',
        label: 'Insert Table',
        group: 'insert',
        priority: 140,
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      createResizeSuppressionPlugin(),

      columnResizing({
        cellMinWidth: this.options.cellMinWidth,
        defaultCellMinWidth: this.options.defaultCellMinWidth,
      }),

      tableEditing({
        allowTableNodeSelection: this.options.allowTableNodeSelection,
      }),

      createCellSelectionPlugin(),
    ];
  },
});
