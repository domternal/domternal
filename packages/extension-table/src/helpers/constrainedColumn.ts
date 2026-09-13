/**
 * Shared table measurements and column insertion that preserves custom widths.
 * Editor commands and the TableView dropdown use the same insertion policy.
 */

import { EditorState } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { addColumnBefore, addColumnAfter, selectedRect, TableMap } from '@domternal/pm/tables';

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
    const oldWidths: number[] = new Array<number>(map.width).fill(0);
    const visited = new Set<number>();
    let assigned = 0;
    for (let index = 0; index < map.map.length; index++) {
      const offset = map.map[index];
      if (offset === undefined || visited.has(offset)) continue;
      visited.add(offset);
      const cell = node.nodeAt(offset);
      const colwidth = cell?.attrs['colwidth'] as number[] | null | undefined;
      const start = index % map.width;
      for (let part = 0; part < (colwidth?.length ?? 0); part++) {
        const width = colwidth?.[part];
        if (width && width > 0 && !oldWidths[start + part]) {
          oldWidths[start + part] = width;
          assigned++;
        }
      }
      if (assigned === map.width) break;
    }
    const allFrozen = oldWidths.every((width) => width > 0);

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

interface ColumnInsertionOptions {
  cellMinWidth: number;
  defaultCellMinWidth: number;
  constrainToContainer: boolean;
}

/** Resolve only unspecified widths; explicit widths remain authoritative. */
function readColumnWidths(
  info: TableInfo,
  tableDom: HTMLTableElement | null,
  options: ColumnInsertionOptions,
): number[] {
  if (info.allFrozen) return info.oldWidths.slice();
  const { cellMinWidth, defaultCellMinWidth } = options;
  const cols = tableDom?.querySelector('colgroup')?.children;
  const measured = info.oldWidths.map((_width, col) => cols?.[col]?.getBoundingClientRect().width ?? 0);
  const sources = measured.map((width) => width > 0 ? 0 : Infinity);

  // WebKit gives COL elements empty rectangles. Resolve their widths from real
  // cells instead, preferring an unmerged cell over an estimate from a colspan.
  const rowspans = new Array<number>(info.oldWidths.length).fill(0);
  for (const row of Array.from(tableDom?.rows ?? [])) {
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      while ((rowspans[col] ?? 0) > 0) col++;
      const end = col + cell.colSpan;
      let explicit = 0;
      let unsized = 0;
      for (let part = col; part < end; part++) {
        const width = info.oldWidths[part] ?? 0;
        explicit += width;
        if (!width) unsized++;
        rowspans[part] = cell.rowSpan;
      }
      const width = unsized > 0 ? (cell.getBoundingClientRect().width - explicit) / unsized : 0;
      for (let part = col; part < end; part++) {
        if (!info.oldWidths[part] && width > 0 && cell.colSpan < (sources[part] ?? Infinity)) {
          measured[part] = width;
          sources[part] = cell.colSpan;
        }
      }
      col = end;
    }
    for (let col = 0; col < rowspans.length; col++) rowspans[col] = Math.max(0, (rowspans[col] ?? 0) - 1);
  }
  const widths = info.oldWidths.map((width, col) => {
    if (width > 0) return width;
    const measurement = measured[col] ?? 0;
    return Math.max(cellMinWidth, measurement > 0 ? Math.round(measurement) : defaultCellMinWidth);
  });

  // Correct collapsed-border rounding using only columns we just measured.
  const renderedWidth = Math.floor(tableDom?.getBoundingClientRect().width ?? 0) - 1;
  if (renderedWidth > 0) {
    let excess = widths.reduce((sum, width) => sum + width, 0) - renderedWidth;
    for (let col = widths.length - 1; col >= 0 && excess > 0; col--) {
      if (info.oldWidths[col]) continue;
      const width = widths[col] ?? cellMinWidth;
      const reduction = Math.min(excess, Math.max(0, width - cellMinWidth));
      widths[col] = width - reduction;
      excess -= reduction;
    }
  }
  return widths;
}

/** Use spare space, then borrow only what is needed from the closest columns. */
function insertColumnWidth(
  widths: number[],
  index: number,
  side: 'before' | 'after',
  containerWidth: number,
  options: ColumnInsertionOptions,
): void {
  const { cellMinWidth, defaultCellMinWidth, constrainToContainer } = options;
  const oldTotal = widths.reduce((sum, width) => sum + width, 0);
  let newWidth = Math.max(cellMinWidth, defaultCellMinWidth);

  // An already overflowing table keeps its widths and its horizontal scroll.
  if (constrainToContainer && containerWidth > 0 && oldTotal <= containerWidth) {
    const spare = containerWidth - oldTotal;
    const available = spare + widths.reduce((sum, width) => sum + Math.max(0, width - cellMinWidth), 0);
    newWidth = Math.max(cellMinWidth, Math.min(newWidth, available));
    let deficit = Math.max(0, newWidth - spare);

    for (let distance = 0; distance < widths.length && deficit > 0; distance++) {
      const left = index - 1 - distance;
      const right = index + distance;
      // Prefer the selected side when both neighbors are equally close.
      for (const col of side === 'after' ? [left, right] : [right, left]) {
        const width = widths[col];
        if (width === undefined) continue;
        const reduction = Math.min(deficit, Math.max(0, width - cellMinWidth));
        widths[col] = width - reduction;
        deficit -= reduction;
      }
    }
  }

  // If even minimum widths cannot fit, the wrapper supplies horizontal scroll.
  widths.splice(index, 0, newWidth);
}

/** Write each complete cell width array once, including colspan and rowspan. */
function applyColumnWidths(tr: Transaction, tableStart: number, widths: number[]): void {
  const table = tr.doc.nodeAt(tableStart - 1);
  if (table?.type.name !== 'table') return;
  const map = TableMap.get(table);

  const visited = new Set<number>();
  for (let index = 0; index < map.map.length; index++) {
    const offset = map.map[index];
    if (offset === undefined || visited.has(offset)) continue;
    visited.add(offset);
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const start = index % map.width;
    const colspan = cell.attrs['colspan'] as number;
    const colwidth = widths.slice(start, start + colspan);
    const previous = cell.attrs['colwidth'] as number[] | null;
    if (previous?.length === colwidth.length && previous.every((width, col) => width === colwidth[col])) continue;
    tr.setNodeMarkup(tableStart + offset, null, { ...cell.attrs, colwidth });
  }
}

/**
 * Insert a column and its widths in one transaction. A table with no stored
 * widths retains native automatic layout. Once widths are customized, every
 * column stays explicit so adding a column cannot reactivate CSS redistribution.
 * The optional pending transaction supplies a chain's current doc and selection;
 * only the caller dispatches, so failed chains leave the editor untouched.
 */
export function addColumnWithWidths(
  side: 'before' | 'after',
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  view: EditorView,
  options: ColumnInsertionOptions,
  pending?: Transaction,
): boolean {
  const current = pending && (pending.doc !== state.doc || pending.selection !== state.selection)
    ? EditorState.create({ doc: pending.doc, selection: pending.selection, storedMarks: pending.storedMarks })
    : state;
  const command = side === 'before' ? addColumnBefore : addColumnAfter;
  if (!dispatch) return command(current);

  const info = getTableInfo(current);
  if (!info?.oldWidths.some((width) => width > 0)) return command(current, dispatch);

  const rect = selectedRect(current);
  const index = side === 'before' ? rect.left : rect.right;
  // Map each step separately: replacing a table's opening token and inserting
  // its first row invalidate different boundaries without replacing the table.
  let liveTableStart: number | null = info.tableStart;
  for (const step of pending?.mapping.invert().maps ?? []) {
    const opening = step.mapResult(liveTableStart - 1);
    const content = step.mapResult(liveTableStart);
    if (!opening.deleted) liveTableStart = opening.pos + 1;
    else if (!content.deleted) liveTableStart = content.pos;
    else { liveTableStart = null; break; }
  }
  const liveTable = liveTableStart === null ? null : view.state.doc.nodeAt(liveTableStart - 1);
  const hasLiveTable = liveTableStart !== null && liveTable?.type.name === 'table';
  const tableDom = hasLiveTable && liveTableStart !== null ? findTableDom(view, liveTableStart) : null;
  const containerWidth = hasLiveTable && liveTableStart !== null ? getContainerWidth(view, liveTableStart) : 0;
  // A chain may already have changed the grid; old DOM columns then cannot be
  // used to measure its unspecified widths by index.
  const canMeasureColumns = hasLiveTable && TableMap.get(liveTable).width === info.oldWidths.length;
  const widths = readColumnWidths(info, canMeasureColumns ? tableDom : null, options);
  insertColumnWidth(widths, index, side, containerWidth, options);

  return command(current, (tr) => {
    applyColumnWidths(tr, info.tableStart, widths);
    dispatch(tr);
  });
}
