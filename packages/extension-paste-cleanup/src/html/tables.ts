import type { Element, Root, RootContent } from 'hast';

const MAX_TABLE_CELLS = 20_000;
const MAX_TABLE_SPAN = 1_000;

/** Reject table geometry before ProseMirror allocates its rectangular table map. */
export class TableLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableLimitError';
  }
}

// HTML's rules for a non-negative integer: leading white space, an optional plus sign,
// then digits up to the first other character.
const HTML_SPAN = /^[\t\n\f\r ]*\+?(\d+)/;

/**
 * A colspan or rowspan as a browser and the Table extension read it: the whole number
 * the attribute starts with, and 1 when it is missing, invalid or zero. The parser
 * turns a numeric attribute into a number, which reads rounded down. The result is not
 * bounded; a span above 1,000 is refused by {@link assertTableBounds}.
 */
export function readTableSpan(value: unknown): number {
  let read = 0;
  if (typeof value === 'number') read = Number.isFinite(value) ? Math.floor(value) : 0;
  else if (typeof value === 'string') {
    const digits = HTML_SPAN.exec(value)?.[1];
    read = digits === undefined ? 0 : Number(digits);
  }
  return read < 1 ? 1 : read;
}

function span(value: unknown): number {
  const read = readTableSpan(value);
  if (read > MAX_TABLE_SPAN) throw new TableLimitError('Table spans must be no greater than 1000');
  return read;
}

/** Rows belong to their nearest table, including rows inside implicit tbody elements. */
function tableRows(table: Element, maximum: number): Element[] {
  const rows: Element[] = [];
  const pending: RootContent[] = [...table.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type !== 'element' || node.tagName === 'table') continue;
    if (node.tagName === 'tr') {
      if (rows.length >= maximum) throw new TableLimitError('Table row count exceeds the cell budget');
      rows.push(node);
      continue;
    }
    if (node.tagName === 'td' || node.tagName === 'th') {
      throw new TableLimitError('Table cells must belong to a row');
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) pending.push(child);
    }
  }
  return rows;
}

function rowCells(row: Element): Element[] {
  const cells: Element[] = [];
  const pending: RootContent[] = [...row.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type !== 'element' || node.tagName === 'table') continue;
    if (node.tagName === 'tr') throw new TableLimitError('Table rows must not contain other rows');
    if (node.tagName === 'td' || node.tagName === 'th') {
      cells.push(node);
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) pending.push(child);
    }
  }
  return cells;
}

/**
 * Bound the sum of rectangular table-map slots, not only authored td/th nodes.
 * Rowspan contributions expire by row index, so no cell grid is allocated.
 * Empty tables/rows reserve at least one column for schema repair. Overlong
 * rowspans count only existing rows, matching ProseMirror's table-map bounds.
 * Nested tables each consume their own share of the document-wide budget.
 */
export function assertTableBounds(tree: Root, maxCells = MAX_TABLE_CELLS): void {
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > MAX_TABLE_CELLS) {
    throw new RangeError('Table cell budget must be an integer between 1 and 20000');
  }

  let remaining = maxCells;
  const pending: RootContent[] = [...tree.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node?.type !== 'element') continue;
    if (node.tagName === 'table') {
      if (remaining === 0) throw new TableLimitError('Tables exceed the document cell budget');
      const rows = tableRows(node, remaining);
      const height = Math.max(1, rows.length);
      const maximumWidth = Math.floor(remaining / height);
      const expires = new Array<number>(rows.length + 1).fill(0);
      let activeWidth = 0;
      let width = 1;
      for (let index = 0; index < rows.length; index++) {
        activeWidth -= expires[index] ?? 0;
        let rowWidth = activeWidth;
        const row = rows[index];
        if (row === undefined) continue;
        for (const cell of rowCells(row)) {
          const colspan = span(cell.properties.colSpan);
          const rowspan = span(cell.properties.rowSpan);
          if (colspan > maximumWidth - rowWidth) {
            throw new TableLimitError('Expanded table geometry exceeds the document cell budget');
          }
          rowWidth += colspan;
          if (rowspan > 1) {
            activeWidth += colspan;
            const end = Math.min(rows.length, index + rowspan);
            expires[end] = (expires[end] ?? 0) + colspan;
          }
        }
        if (rowWidth > maximumWidth) {
          throw new TableLimitError('Expanded table geometry exceeds the document cell budget');
        }
        width = Math.max(width, rowWidth);
      }
      remaining -= width * height;
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child !== undefined) pending.push(child);
    }
  }
}
