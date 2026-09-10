/**
 * Pasting cells into a table.
 *
 * Derived from prosemirror-tables 1.8.5 (src/copypaste.ts and the paste
 * handler of src/input.ts), Copyright (C) 2015-2016 by Marijn Haverbeke
 * <marijnh@gmail.com> and others, MIT License; see THIRD-PARTY-LICENSES.md.
 *
 * Changed from the original: the selection after a paste is read from the
 * table map, so a pasted cell that spans rows up to the table's right edge no
 * longer throws "No cell with offset" (the original looks for a cell that
 * starts in the last pasted row, where a spanning cell leaves none) and the
 * selection covers exactly the pasted cells; a cell clipped at the bottom of a
 * selection keeps the rows it still covers. The helpers use only the public
 * exports of prosemirror-tables, which Domternal accepts from version 1.7.0.
 */
import { Fragment, Slice } from '@domternal/pm/model';
import type { Attrs, Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import { Transform } from '@domternal/pm/transform';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import {
  CellSelection,
  TableMap,
  isInTable,
  removeColSpan,
  selectionCell,
  tableNodeTypes,
} from '@domternal/pm/tables';
import type { Rect } from '@domternal/pm/tables';

/** A rectangular area of cells: one fragment of cells per row. */
export interface PastedCells {
  width: number;
  height: number;
  rows: Fragment[];
}

/** The span attributes prosemirror-tables reads, which it does not export as a type. */
type CellAttrs = Parameters<typeof removeColSpan>[0];
const attrsOf = (cell: PMNode): CellAttrs => cell.attrs as CellAttrs;

/** An entry the caller knows exists: a row of a rectangular area or a cell of a table map. */
function entry<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new RangeError(`No entry ${String(index)}`);
  return value;
}

/** A node of the type filled with the content it requires, as a table cell or row always can be. */
function filled(type: NodeType, attrs?: Attrs | null): PMNode {
  const node = type.createAndFill(attrs);
  if (!node) throw new RangeError(`Cannot fill a ${type.name}`);
  return node;
}

/**
 * The rectangular area of cells a slice holds, or null when the outer nodes
 * of the slice are not table cells or rows.
 */
export function pastedCells(slice: Slice): PastedCells | null {
  if (slice.size === 0) return null;
  let { content, openStart, openEnd } = slice;
  while (content.childCount === 1 && ((openStart > 0 && openEnd > 0) || content.child(0).type.spec['tableRole'] === 'table')) {
    openStart--;
    openEnd--;
    content = content.child(0).content;
  }
  const first = content.child(0);
  const role = first.type.spec['tableRole'] as string | undefined;
  const schema = first.type.schema;
  const rows: Fragment[] = [];
  if (role === 'row') {
    for (let i = 0; i < content.childCount; i++) {
      let cells = content.child(i).content;
      const left = i ? 0 : Math.max(0, openStart - 1);
      const right = i < content.childCount - 1 ? 0 : Math.max(0, openEnd - 1);
      if (left || right) cells = fitSlice(tableNodeTypes(schema).row, new Slice(cells, left, right)).content;
      rows.push(cells);
    }
  } else if (role === 'cell' || role === 'header_cell') {
    rows.push(openStart || openEnd
      ? fitSlice(tableNodeTypes(schema).row, new Slice(content, openStart, openEnd)).content
      : content);
  } else {
    return null;
  }
  return ensureRectangular(schema, rows);
}

/** Pads rows with empty cells so that every row of the area is equally wide. */
function ensureRectangular(schema: Schema, rows: Fragment[]): PastedCells {
  const widths: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = entry(rows, i);
    for (let j = row.childCount - 1; j >= 0; j--) {
      const { rowspan, colspan } = attrsOf(row.child(j));
      for (let r = i; r < i + rowspan; r++) widths[r] = (widths[r] ?? 0) + colspan;
    }
  }
  let width = 0;
  for (const rowWidth of widths) width = Math.max(width, rowWidth);
  for (let r = 0; r < widths.length; r++) {
    if (r >= rows.length) rows.push(Fragment.empty);
    const rowWidth = widths[r] ?? 0;
    if (rowWidth < width) {
      const empty = filled(tableNodeTypes(schema).cell);
      const cells: PMNode[] = [];
      for (let i = rowWidth; i < width; i++) cells.push(empty);
      rows[r] = entry(rows, r).append(Fragment.from(cells));
    }
  }
  return { height: rows.length, width, rows };
}

function fitSlice(nodeType: NodeType, slice: Slice): PMNode {
  const node = filled(nodeType);
  return new Transform(node).replace(0, node.content.size, slice).doc;
}

/**
 * Clips or repeats the cells to cover the given width and height, clipping
 * the spans of cells that stick out at the edges.
 */
export function clipCells({ width, height, rows }: PastedCells, newWidth: number, newHeight: number): PastedCells {
  if (width !== newWidth) {
    const added: number[] = [];
    const newRows: Fragment[] = [];
    for (let row = 0; row < rows.length; row++) {
      const frag = entry(rows, row);
      const cells: PMNode[] = [];
      for (let col = added[row] ?? 0, i = 0; col < newWidth; i++) {
        let cell = frag.child(i % frag.childCount);
        const { colspan, rowspan } = attrsOf(cell);
        if (col + colspan > newWidth) {
          cell = cell.type.createChecked(removeColSpan(attrsOf(cell), colspan, col + colspan - newWidth), cell.content);
        }
        cells.push(cell);
        col += attrsOf(cell).colspan;
        for (let j = 1; j < rowspan; j++) added[row + j] = (added[row + j] ?? 0) + attrsOf(cell).colspan;
      }
      newRows.push(Fragment.from(cells));
    }
    rows = newRows;
    width = newWidth;
  }
  if (height !== newHeight) {
    const newRows: Fragment[] = [];
    for (let row = 0, i = 0; row < newHeight; row++, i++) {
      const cells: PMNode[] = [];
      const source = entry(rows, i % height);
      for (let j = 0; j < source.childCount; j++) {
        let cell = source.child(j);
        // The original subtracts the span from the height; a clipped cell keeps the rows it still covers.
        if (row + attrsOf(cell).rowspan > newHeight) {
          cell = cell.type.create({ ...cell.attrs, rowspan: Math.max(1, newHeight - row) }, cell.content);
        }
        cells.push(cell);
      }
      newRows.push(Fragment.from(cells));
    }
    rows = newRows;
    height = newHeight;
  }
  return { width, height, rows };
}

/** Adds empty columns and rows so the table is at least `width` by `height`. */
function growTable(tr: Transaction, map: TableMap, table: PMNode, start: number, width: number, height: number, mapFrom: number): boolean {
  const types = tableNodeTypes(tr.doc.type.schema);
  let empty: PMNode | undefined;
  let emptyHead: PMNode | undefined;
  if (width > map.width) {
    for (let row = 0, rowEnd = 0; row < map.height; row++) {
      const rowNode = table.child(row);
      rowEnd += rowNode.nodeSize;
      const cells: PMNode[] = [];
      let add: PMNode;
      if (rowNode.lastChild === null || rowNode.lastChild.type === types.cell) add = empty ??= filled(types.cell);
      else add = emptyHead ??= filled(types.header_cell);
      for (let i = map.width; i < width; i++) cells.push(add);
      tr.insert(tr.mapping.slice(mapFrom).map(rowEnd - 1 + start), cells);
    }
  }
  if (height > map.height) {
    const cells: PMNode[] = [];
    for (let i = 0, lastRow = (map.height - 1) * map.width; i < Math.max(map.width, width); i++) {
      const header = i >= map.width ? false : table.nodeAt(entry(map.map, lastRow + i))?.type === types.header_cell;
      cells.push(header ? emptyHead ??= filled(types.header_cell) : empty ??= filled(types.cell));
    }
    const emptyRow = types.row.create(null, Fragment.from(cells));
    const rows: PMNode[] = [];
    for (let i = map.height; i < height; i++) rows.push(emptyRow);
    tr.insert(tr.mapping.slice(mapFrom).map(start + table.nodeSize - 2), rows);
  }
  return empty !== undefined || emptyHead !== undefined;
}

/** Splits cells that cross the horizontal line at `top` between `left` and `right`. */
function isolateHorizontal(tr: Transaction, map: TableMap, table: PMNode, start: number, left: number, right: number, top: number, mapFrom: number): boolean {
  if (top === 0 || top === map.height) return false;
  let found = false;
  for (let col = left; col < right; col++) {
    const index = top * map.width + col;
    const pos = entry(map.map, index);
    const cell = table.nodeAt(pos);
    if (cell && map.map[index - map.width] === pos) {
      found = true;
      const { top: cellTop, left: cellLeft } = map.findCell(pos);
      tr.setNodeMarkup(tr.mapping.slice(mapFrom).map(pos + start), null, { ...cell.attrs, rowspan: top - cellTop });
      tr.insert(
        tr.mapping.slice(mapFrom).map(map.positionAt(top, cellLeft, table)),
        filled(cell.type, { ...cell.attrs, rowspan: cellTop + attrsOf(cell).rowspan - top }),
      );
      col += attrsOf(cell).colspan - 1;
    }
  }
  return found;
}

/** Splits cells that cross the vertical line at `left` between `top` and `bottom`. */
function isolateVertical(tr: Transaction, map: TableMap, table: PMNode, start: number, top: number, bottom: number, left: number, mapFrom: number): boolean {
  if (left === 0 || left === map.width) return false;
  let found = false;
  for (let row = top; row < bottom; row++) {
    const index = row * map.width + left;
    const pos = entry(map.map, index);
    const cell = table.nodeAt(pos);
    if (cell && map.map[index - 1] === pos) {
      found = true;
      const cellLeft = map.colCount(pos);
      const updatePos = tr.mapping.slice(mapFrom).map(pos + start);
      tr.setNodeMarkup(updatePos, null, removeColSpan(attrsOf(cell), left - cellLeft, attrsOf(cell).colspan - (left - cellLeft)));
      tr.insert(updatePos + cell.nodeSize, filled(cell.type, removeColSpan(attrsOf(cell), 0, left - cellLeft)));
      row += attrsOf(cell).rowspan - 1;
    }
  }
  return found;
}

/**
 * Inserts the cells into the table whose content starts at `tableStart`, at
 * the top left corner of `rect`, growing the table and splitting merged
 * cells at the edges as needed, and selects the pasted cells.
 */
export function insertCells(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  tableStart: number,
  rect: Pick<Rect, 'top' | 'left'>,
  cells: PastedCells,
): void {
  let table = tableStart ? state.doc.nodeAt(tableStart - 1) : state.doc;
  if (!table) throw new Error('No table found');
  let map = TableMap.get(table);
  const { top, left } = rect;
  const right = left + cells.width;
  const bottom = top + cells.height;
  const tr = state.tr;
  let mapFrom = 0;
  const recomp = (): void => {
    table = tableStart ? tr.doc.nodeAt(tableStart - 1) : tr.doc;
    if (!table) throw new Error('No table found');
    map = TableMap.get(table);
    mapFrom = tr.mapping.maps.length;
  };
  if (growTable(tr, map, table, tableStart, right, bottom, mapFrom)) recomp();
  if (isolateHorizontal(tr, map, table, tableStart, left, right, top, mapFrom)) recomp();
  if (isolateHorizontal(tr, map, table, tableStart, left, right, bottom, mapFrom)) recomp();
  if (isolateVertical(tr, map, table, tableStart, top, bottom, left, mapFrom)) recomp();
  if (isolateVertical(tr, map, table, tableStart, top, bottom, right, mapFrom)) recomp();
  for (let row = top; row < bottom; row++) {
    const from = map.positionAt(row, left, table);
    const to = map.positionAt(row, right, table);
    tr.replace(tr.mapping.slice(mapFrom).map(from + tableStart), tr.mapping.slice(mapFrom).map(to + tableStart), new Slice(entry(cells.rows, row - top), 0, 0));
  }
  recomp();
  // The cells covering the corners of the pasted area. A cell that spans rows
  // leaves the last pasted row without a cell of its own, so a position looked
  // up by row would miss it.
  const anchor = entry(map.map, top * map.width + left);
  const head = entry(map.map, (bottom - 1) * map.width + right - 1);
  tr.setSelection(new CellSelection(tr.doc.resolve(tableStart + anchor), tr.doc.resolve(tableStart + head)));
  dispatch(tr);
}

/**
 * The paste handler: cells pasted into a table, or any content pasted into a
 * cell selection, replace cells. Returns false when the paste is not for a table.
 */
export function handleTablePaste(view: EditorView, slice: Slice): boolean {
  if (!isInTable(view.state)) return false;
  let cells = pastedCells(slice);
  const selection = view.state.selection;
  if (selection instanceof CellSelection) {
    cells ??= { width: 1, height: 1, rows: [Fragment.from(fitSlice(tableNodeTypes(view.state.schema).cell, slice))] };
    const table = selection.$anchorCell.node(-1);
    const start = selection.$anchorCell.start(-1);
    const rect = TableMap.get(table).rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start);
    cells = clipCells(cells, rect.right - rect.left, rect.bottom - rect.top);
    insertCells(view.state, view.dispatch, start, rect, cells);
    return true;
  }
  if (cells) {
    const $cell = selectionCell(view.state);
    const start = $cell.start(-1);
    insertCells(view.state, view.dispatch, start, TableMap.get($cell.node(-1)).findCell($cell.pos - start), cells);
    return true;
  }
  return false;
}
