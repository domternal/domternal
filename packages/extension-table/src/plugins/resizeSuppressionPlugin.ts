/**
 * Suppress column-resize handle during non-resize mouse drags and
 * freeze all column widths when a column resize starts.
 *
 * The columnResizing plugin detects cell borders on every mousemove and
 * shows a blue resize line — confusing when the user is dragging to
 * select cells or text, not to resize a column. This plugin adds a
 * `dm-mouse-drag` CSS class during non-resize drags and blocks
 * columnResizing's mousemove handler from detecting borders.
 *
 * Additionally, when a column resize starts (mousedown on a resize handle),
 * this plugin measures the DOM widths of all columns that don't have explicit
 * colwidth attributes and stores them in the document. This ensures that
 * during and after the drag, all columns have fixed pixel widths and only
 * the dragged column changes — other columns don't redistribute.
 */

import { Plugin } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { columnResizingPluginKey, TableMap } from '@domternal/pm/tables';

export function createResizeSuppressionPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (event.button !== 0) return false;
          // Only suppress for non-resize drags (activeHandle === -1 means
          // the cursor is NOT on a column border)
          const resizeState = columnResizingPluginKey.getState(view.state) as
            | { activeHandle: number; dragging: unknown } | undefined;
          if (!resizeState || resizeState.activeHandle === -1) {
            view.dom.classList.add('dm-mouse-drag');
            document.addEventListener('mouseup', () => {
              view.dom.classList.remove('dm-mouse-drag');
            }, { once: true });
          } else {
            // Resize handle mousedown — freeze all column widths before
            // the columnResizing plugin starts the drag
            freezeColumnWidths(view, resizeState.activeHandle);
          }
          return false;
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

/**
 * Before a column resize starts, measure all column widths from the DOM
 * and store them as colwidth attributes on every cell. This converts the
 * table from CSS width: 100% (columns redistribute) to a fixed pixel
 * width (only the dragged column changes).
 */
function freezeColumnWidths(view: EditorView, handlePos: number): void {
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
        measuredWidths[col] = Math.max(25, Math.round(domWidth / parts));
      } else {
        measuredWidths[col] = 100;
      }
    } catch {
      measuredWidths[col] = 100;
    }
  }

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
