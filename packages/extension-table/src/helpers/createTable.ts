/**
 * Creates a table node from schema types.
 *
 * Builds table → rows → cells structure.
 * First row gets tableHeader cells if withHeaderRow is true.
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { tableNodeTypes } from 'prosemirror-tables';

export function createTable(
  schema: Schema,
  rows: number,
  cols: number,
  withHeaderRow: boolean,
  cellContent?: PMNode,
): PMNode {
  const types = tableNodeTypes(schema);

  const headerCells: PMNode[] = [];
  const cells: PMNode[] = [];

  for (let col = 0; col < cols; col++) {
    const cell = cellContent
      ? types.cell.createChecked(null, cellContent)
      : types.cell.createAndFill();

    if (cell) {
      cells.push(cell);
    }

    if (withHeaderRow) {
      const headerCell = cellContent
        ? types.header_cell.createChecked(null, cellContent)
        : types.header_cell.createAndFill();

      if (headerCell) {
        headerCells.push(headerCell);
      }
    }
  }

  const tableRows: PMNode[] = [];

  for (let row = 0; row < rows; row++) {
    const rowCells = withHeaderRow && row === 0 ? headerCells : cells;
    tableRows.push(types.row.createChecked(null, rowCells));
  }

  return types.table.createChecked(null, tableRows);
}
