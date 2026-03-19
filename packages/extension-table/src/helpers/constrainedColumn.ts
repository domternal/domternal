/**
 * Shared helpers for constraining table columns within container width.
 *
 * Used by both Table.ts (editor commands) and TableView.ts (dropdown)
 * to prevent add-column operations from causing table overflow.
 */

import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { TableMap } from '@domternal/pm/tables';

export interface TableInfo {
  tableStart: number;
  oldWidths: number[];
  allFrozen: boolean;
}

/**
 * Read table metadata from the current selection.
 * Returns null if the cursor is not inside a table.
 */
export function getTableInfo(state: EditorState): TableInfo | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name !== 'table') continue;

    const tableStart = $from.start(d);
    const map = TableMap.get(node);
    const oldWidths: number[] = [];
    let allFrozen = true;

    for (let col = 0; col < map.width; col++) {
      const cellOffset = map.map[col] ?? 0;
      const cell = node.nodeAt(cellOffset);
      if (!cell) { allFrozen = false; oldWidths.push(0); continue; }

      const colInCell = col - map.colCount(cellOffset);
      const colwidth = cell.attrs['colwidth'] as number[] | null;
      const w = colwidth?.[colInCell];
      if (w) {
        oldWidths.push(w);
      } else {
        allFrozen = false;
        oldWidths.push(0);
      }
    }

    return { tableStart, oldWidths, allFrozen };
  }
  return null;
}

/**
 * Walk up from a position inside a table to find the TABLE element in the DOM.
 * Returns null if the DOM is unavailable.
 */
export function findTableDom(view: EditorView, tableStart: number): HTMLTableElement | null {
  try {
    let node = view.domAtPos(tableStart).node as HTMLElement | null;
    while (node && node.nodeName !== 'TABLE') {
      node = node.parentNode as HTMLElement | null;
    }
    return node as HTMLTableElement | null;
  } catch { return null; }
}

/**
 * Measure the container (.tableWrapper) width from the DOM.
 * Subtracts 1 for the collapsed outer border (border-collapse adds ~1px
 * to table.offsetWidth beyond the sum of colwidths).
 * Returns 0 if the DOM is unavailable.
 */
export function getContainerWidth(view: EditorView, tableStart: number): number {
  const tableDom = findTableDom(view, tableStart);
  const wrapper = tableDom?.closest('.tableWrapper') as HTMLElement | null;
  if (wrapper) return Math.floor(wrapper.getBoundingClientRect().width) - 1;
  return 0;
}

/**
 * Redistribute all column widths equally in a captured transaction.
 * Modifies the transaction in-place.
 */
export function redistributeColumns(
  tr: Transaction,
  tableStartPos: number,
  targetWidth: number,
  cellMinWidth: number,
): void {
  // Resolve the table in the new (post-addColumn) document
  const $pos = tr.doc.resolve(tableStartPos);
  let tableDepth = -1;
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth === -1) return;

  const table = $pos.node(tableDepth);
  const tableStart = $pos.start(tableDepth);
  const map = TableMap.get(table);
  const colCount = map.width;

  // Equal distribution, clamped at cellMinWidth
  const baseWidth = Math.max(cellMinWidth, Math.floor(targetWidth / colCount));
  const newWidths: number[] = new Array(colCount).fill(baseWidth) as number[];

  // Adjust last column for rounding remainder
  const used = baseWidth * colCount;
  const diff = targetWidth - used;
  if (diff !== 0 && colCount > 0) {
    const lastIdx = colCount - 1;
    newWidths[lastIdx] = Math.max(cellMinWidth, (newWidths[lastIdx] ?? baseWidth) + diff);
  }

  // Apply widths to all cells via setNodeMarkup
  for (let col = 0; col < map.width; col++) {
    const targetW = newWidths[col]!;
    for (let row = 0; row < map.height; row++) {
      const mapIndex = row * map.width + col;
      // Skip if same cell as row above (rowspan)
      if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;

      const pos = map.map[mapIndex] ?? 0;
      const cellNode = table.nodeAt(pos);
      if (!cellNode) continue;

      const colspan = (cellNode.attrs['colspan'] as number) || 1;
      const index = colspan === 1 ? 0 : col - map.colCount(pos);
      const colwidth = cellNode.attrs['colwidth'] as number[] | null;

      if (colwidth?.[index] === targetW) continue;

      const newColwidth = colwidth ? colwidth.slice() : new Array(colspan).fill(0) as number[];
      newColwidth[index] = targetW;
      tr.setNodeMarkup(tableStart + pos, null, { ...cellNode.attrs, colwidth: newColwidth });
    }
  }
}

type PMCommand = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => boolean;

/**
 * Execute an addColumn command with container constraint.
 * If columns are frozen and adding would overflow, redistributes.
 * Otherwise delegates to the PM command normally.
 */
export function constrainedAddColumn(
  pmCommand: PMCommand,
  view: EditorView,
  cellMinWidth: number,
  defaultCellMinWidth: number,
): boolean {
  const state = view.state;
  const info = getTableInfo(state);

  if (!info?.allFrozen) {
    return pmCommand(state, view.dispatch.bind(view));
  }

  const containerWidth = getContainerWidth(view, info.tableStart);
  if (containerWidth <= 0) {
    return pmCommand(state, view.dispatch.bind(view));
  }

  const oldTotal = info.oldWidths.reduce((a, b) => a + b, 0);
  // If table + new min column still fits, let PM handle normally
  if (oldTotal + defaultCellMinWidth <= containerWidth) {
    return pmCommand(state, view.dispatch.bind(view));
  }

  // Would overflow — capture transaction, redistribute, then dispatch
  let captured: Transaction | undefined;
  pmCommand(state, (tr) => { captured = tr; });
  if (!captured) return false;

  redistributeColumns(captured, info.tableStart, Math.min(oldTotal, containerWidth), cellMinWidth);
  view.dispatch(captured);
  return true;
}
