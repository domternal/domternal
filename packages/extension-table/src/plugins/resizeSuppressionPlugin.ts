/**
 * Suppress column-resize handle during non-resize mouse drags and
 * implement configurable column resize behavior.
 *
 * The columnResizing plugin detects cell borders on every mousemove and
 * shows a blue resize line — confusing when the user is dragging to
 * select cells or text, not to resize a column. This plugin adds a
 * `dm-mouse-drag` CSS class during non-resize drags and blocks
 * columnResizing's mousemove handler from detecting borders.
 *
 * Resize behaviors:
 * - `neighbor`: adjacent column compensates, table width stays constant (Google Docs style)
 * - `independent`: all columns freeze, only dragged column changes, table width grows/shrinks
 * - `redistribute`: original prosemirror-tables behavior, columns redistribute to fill width
 */

import { Plugin } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import { columnResizingPluginKey, TableMap } from '@domternal/pm/tables';

export interface ResizeSuppressionOptions {
  resizeBehavior: 'neighbor' | 'independent' | 'redistribute';
  cellMinWidth: number;
  defaultCellMinWidth: number;
}

export function createResizeSuppressionPlugin(options: ResizeSuppressionOptions): Plugin {
  const { resizeBehavior, cellMinWidth, defaultCellMinWidth } = options;

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false;
          const resizeState = columnResizingPluginKey.getState(view.state) as
            | { activeHandle: number; dragging: unknown } | undefined;

          if (!resizeState || resizeState.activeHandle === -1) {
            // Non-resize drag — suppress columnResizing border detection
            view.dom.classList.add('dm-mouse-drag');
            document.addEventListener('mouseup', () => {
              view.dom.classList.remove('dm-mouse-drag');
            }, { once: true });
            return false;
          }

          // Resize handle mousedown — branch by behavior
          if (resizeBehavior === 'redistribute') {
            // Let columnResizing handle everything (original PM behavior)
            return false;
          }

          if (resizeBehavior === 'independent') {
            // Freeze all column widths, then let columnResizing handle the drag
            freezeColumnWidths(view, resizeState.activeHandle, cellMinWidth, defaultCellMinWidth);
            return false;
          }

          // 'neighbor' mode — intercept and handle the drag ourselves
          return handleNeighborResize(view, event, resizeState.activeHandle, cellMinWidth, defaultCellMinWidth);
        },
        mousemove: (view, event) => {
          if (event.buttons !== 1) return false;
          // Allow columnResizing to process during active column resize
          const resizeState = columnResizingPluginKey.getState(view.state) as
            | { activeHandle: number; dragging: unknown } | undefined;
          if (resizeState?.dragging) return false;
          // Block columnResizing from detecting borders during drag
          return true;
        },
      },
    },
  });
}

// ─── Neighbor resize ──────────────────────────────────────────────────────────

/**
 * Google Docs-style resize: the adjacent column compensates so total table
 * width stays constant. Fully intercepts the drag from columnResizing.
 */
function handleNeighborResize(
  view: EditorView,
  event: MouseEvent,
  activeHandle: number,
  cellMinWidth: number,
  defaultCellMinWidth: number,
): boolean {
  // Step 1 — freeze all columns so every col has an explicit width
  freezeColumnWidths(view, activeHandle, cellMinWidth, defaultCellMinWidth);

  // Step 2 — re-read state after freeze dispatch
  const state = view.state;
  const resizeState = columnResizingPluginKey.getState(state) as
    | { activeHandle: number; dragging: unknown } | undefined;
  const handle = resizeState?.activeHandle ?? -1;
  if (handle === -1) return false;

  const $cell = state.doc.resolve(handle);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const nodeAfter = $cell.nodeAfter;
  if (!nodeAfter) return false;
  const draggedCol = map.colCount($cell.pos - tableStart)! + ((nodeAfter.attrs['colspan'] as number) || 1) - 1;
  const neighborCol = draggedCol + 1;

  // Step 3 — last column: no neighbor, fall back (freeze already ran = independent)
  if (neighborCol >= map.width) return false;

  // Step 4 — read starting widths from frozen attrs
  const startWidth = readColWidth(table, map, draggedCol, defaultCellMinWidth);
  const neighborStartWidth = readColWidth(table, map, neighborCol, defaultCellMinWidth);
  const startX = event.clientX;

  // Step 5 — set dragging meta (triggers decorations + cellSelectionPlugin hideForResize)
  view.dispatch(state.tr.setMeta(columnResizingPluginKey, {
    setDragging: { startX, startWidth },
  }));

  // Step 6 — find table DOM for direct col manipulation
  let tableDom: HTMLElement | null = view.domAtPos(tableStart).node as HTMLElement;
  while (tableDom && tableDom.nodeName !== 'TABLE') tableDom = tableDom.parentNode as HTMLElement;
  const cols = tableDom?.querySelector('colgroup')?.children;
  if (!cols) return false;

  const win = view.dom.ownerDocument.defaultView ?? window;

  function move(e: MouseEvent) {
    if (!e.buttons) return finish(e);

    const offset = e.clientX - startX;
    // Clamp so both columns stay >= cellMinWidth and their sum stays constant
    const clamped = Math.max(
      -(startWidth - cellMinWidth),
      Math.min(offset, neighborStartWidth - cellMinWidth),
    );
    const newDraggedW = startWidth + clamped;
    const newNeighborW = neighborStartWidth - clamped;

    (cols![draggedCol] as HTMLElement).style.width = newDraggedW + 'px';
    (cols![neighborCol] as HTMLElement).style.width = newNeighborW + 'px';
  }

  function finish(e: MouseEvent) {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);

    const pluginState = columnResizingPluginKey.getState(view.state) as
      | { activeHandle: number; dragging: { startX: number; startWidth: number } | null } | undefined;
    if (!pluginState?.dragging) return;

    // Calculate final widths
    const offset = e.clientX - startX;
    const clamped = Math.max(
      -(startWidth - cellMinWidth),
      Math.min(offset, neighborStartWidth - cellMinWidth),
    );
    const finalDraggedW = Math.round(startWidth + clamped);
    const finalNeighborW = Math.round(neighborStartWidth - clamped);

    // Re-resolve table from current state (may have changed during drag)
    const curState = view.state;
    const curHandle = pluginState.activeHandle;
    const $curCell = curState.doc.resolve(curHandle);
    const curTable = $curCell.node(-1);
    const curMap = TableMap.get(curTable);
    const curStart = $curCell.start(-1);

    // Store both column widths + clear dragging in one atomic transaction
    const tr = curState.tr;
    storeColWidth(tr, curTable, curMap, curStart, draggedCol, finalDraggedW);
    storeColWidth(tr, curTable, curMap, curStart, neighborCol, finalNeighborW);
    tr.setMeta(columnResizingPluginKey, { setDragging: null });
    view.dispatch(tr);
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read the effective column width from the first-row cell at the given column index. */
function readColWidth(table: PMNode, map: TableMap, col: number, fallback: number): number {
  const offset = map.map[col]!;
  const cell = table.nodeAt(offset);
  if (!cell) return fallback;
  const idx = col - map.colCount(offset)!;
  const colwidth = cell.attrs['colwidth'] as number[] | null;
  return colwidth?.[idx] ?? fallback;
}

/**
 * Store a single column's width across all rows in a transaction.
 * Same pattern as prosemirror-tables' updateColumnWidth.
 */
function storeColWidth(
  tr: Transaction,
  table: PMNode,
  map: TableMap,
  tableStart: number,
  col: number,
  width: number,
): void {
  for (let row = 0; row < map.height; row++) {
    const mapIndex = row * map.width + col;
    // Skip if same cell as row above (rowspan)
    if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;

    const pos = map.map[mapIndex]!;
    const cellNode = table.nodeAt(pos);
    if (!cellNode) continue;

    const attrs = cellNode.attrs;
    const colspan = (attrs['colspan'] as number) || 1;
    const index = colspan === 1 ? 0 : col - map.colCount(pos)!;
    const colwidth = attrs['colwidth'] as number[] | null;

    if (colwidth && colwidth[index] === width) continue;

    const newColwidth = colwidth ? colwidth.slice() : new Array(colspan).fill(0) as number[];
    newColwidth[index] = width;
    tr.setNodeMarkup(tableStart + pos, null, { ...attrs, colwidth: newColwidth });
  }
}

// ─── Freeze all columns ──────────────────────────────────────────────────────

/**
 * Measure all column widths from the DOM and store them as colwidth attributes
 * on every cell. Converts the table from CSS-distributed widths to fixed pixel
 * widths so columns don't redistribute during resize.
 */
function freezeColumnWidths(view: EditorView, handlePos: number, cellMinWidth: number, defaultCellMinWidth: number): void {
  const state = view.state;
  const $cell = state.doc.resolve(handlePos);

  // Find the table node
  let tableDepth = -1;
  for (let d = $cell.depth; d > 0; d--) {
    if ($cell.node(d).type.name === 'table') {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth === -1) return;

  const table = $cell.node(tableDepth);
  const tableStart = $cell.start(tableDepth);
  const map = TableMap.get(table);
  const firstRow = table.firstChild;
  if (!firstRow) return;

  // Check which columns need width measurement (don't have explicit colwidth)
  const colNeedsWidth: boolean[] = [];
  let anyNeedsWidth = false;

  for (let col = 0; col < map.width; col++) {
    const cellOffset = map.map[col]!; // first row
    const cellNode = table.nodeAt(cellOffset);
    if (!cellNode) {
      colNeedsWidth.push(true);
      anyNeedsWidth = true;
      continue;
    }
    const colWithinCell = col - map.colCount(cellOffset)!;
    const colwidth = cellNode.attrs['colwidth'] as number[] | null;
    if (colwidth && colwidth[colWithinCell]) {
      colNeedsWidth.push(false);
    } else {
      colNeedsWidth.push(true);
      anyNeedsWidth = true;
    }
  }

  if (!anyNeedsWidth) return;

  // Measure column widths from DOM (same approach as prosemirror-tables' currentColWidth)
  const measuredWidths: number[] = new Array(map.width) as number[];

  for (let col = 0; col < map.width; col++) {
    const cellOffset = map.map[col]!; // first row
    const cellNode = table.nodeAt(cellOffset)!;
    const colspan = (cellNode.attrs['colspan'] as number) || 1;
    const colwidth = cellNode.attrs['colwidth'] as number[] | null;
    const colWithinCell = col - map.colCount(cellOffset)!;

    if (!colNeedsWidth[col]) {
      // Already has explicit width
      measuredWidths[col] = colwidth![colWithinCell]!;
      continue;
    }

    // Measure from DOM
    try {
      const dom = view.domAtPos(tableStart + cellOffset);
      const cellDom = dom.node.childNodes[dom.offset] as HTMLElement;
      if (cellDom) {
        let domWidth = cellDom.offsetWidth;
        let parts = colspan;
        if (colwidth) {
          for (let j = 0; j < colspan; j++) {
            if (colwidth[j]) {
              domWidth -= colwidth[j]!;
              parts--;
            }
          }
        }
        measuredWidths[col] = Math.max(cellMinWidth, Math.round(domWidth / parts));
      } else {
        measuredWidths[col] = defaultCellMinWidth;
      }
    } catch {
      measuredWidths[col] = defaultCellMinWidth;
    }
  }

  // Prevent table growth from sub-pixel border rounding in border-collapse.
  // Each cell.offsetWidth rounds independently, so their sum can exceed
  // table.offsetWidth by 1-2px. Adjust the last measured column to compensate.
  try {
    let tableDom: HTMLElement | null = view.domAtPos(tableStart).node as HTMLElement;
    while (tableDom && tableDom.nodeName !== 'TABLE') tableDom = tableDom.parentNode as HTMLElement;
    if (tableDom) {
      const actualWidth = tableDom.offsetWidth;
      if (actualWidth > 0) {
        let measuredTotal = 0;
        for (let col = 0; col < map.width; col++) measuredTotal += measuredWidths[col]!;
        const diff = measuredTotal - actualWidth;
        if (diff > 0) {
          for (let col = map.width - 1; col >= 0; col--) {
            if (colNeedsWidth[col]) {
              measuredWidths[col] = Math.max(cellMinWidth, measuredWidths[col]! - diff);
              break;
            }
          }
        }
      }
    }
  } catch { /* DOM lookup failed — continue with unadjusted widths */ }

  // Accumulate colwidth arrays per cell (handles colspan cells visited multiple times)
  const cellColwidths = new Map<number, number[]>();

  for (let col = 0; col < map.width; col++) {
    if (!colNeedsWidth[col]) continue;

    const width = measuredWidths[col]!;

    for (let row = 0; row < map.height; row++) {
      const mapIndex = row * map.width + col;
      // Skip if same cell as row above (rowspan)
      if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;

      const pos = map.map[mapIndex]!;
      const cellNode = table.nodeAt(pos);
      if (!cellNode) continue;

      const attrs = cellNode.attrs;
      const colspan = (attrs['colspan'] as number) || 1;
      const index = colspan === 1 ? 0 : col - map.colCount(pos)!;

      if (!cellColwidths.has(pos)) {
        const existing = attrs['colwidth'] as number[] | null;
        cellColwidths.set(pos, existing ? existing.slice() : new Array(colspan).fill(0) as number[]);
      }
      cellColwidths.get(pos)![index!] = width;
    }
  }

  // Apply accumulated changes in a single transaction
  const tr = state.tr;

  for (const [pos, colwidth] of cellColwidths) {
    const cellNode = table.nodeAt(pos);
    if (!cellNode) continue;
    tr.setNodeMarkup(tableStart + pos, null, {
      ...cellNode.attrs,
      colwidth,
    });
  }

  if (tr.docChanged) {
    view.dispatch(tr);
  }
}
