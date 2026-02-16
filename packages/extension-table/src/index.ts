/**
 * @domternal/extension-table
 * Table extension for Domternal editor
 *
 * Built on prosemirror-tables. Provides 4 nodes (Table, TableRow, TableCell, TableHeader),
 * 16 commands, Tab/Arrow keyboard navigation, and CellSelection support.
 */

export { Table, type TableOptions } from './Table.js';
export { TableRow, type TableRowOptions } from './TableRow.js';
export { TableCell, type TableCellOptions } from './TableCell.js';
export { TableHeader, type TableHeaderOptions } from './TableHeader.js';
export { TableView } from './TableView.js';
export { createTable } from './helpers/createTable.js';
export { deleteTableWhenAllCellsSelected } from './helpers/deleteTableWhenAllCellsSelected.js';

// Re-export useful types from prosemirror-tables
export { CellSelection, TableMap } from 'prosemirror-tables';
