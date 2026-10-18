import { Extension, isSafeCssValue } from '@domternal/core';
import type { GlobalAttributeSpec, GlobalAttributes, Command, CommandSpec } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import type { Node as PMNode } from '@domternal/pm/model';
import { readTableCellLayout, readTableLayout, readTableRowLayout, TABLE_LAYOUT_SIDES, tableCellStyle, tableLength, tableRowStyle } from './helpers/tableLayout.js';
import type { TableCellLayout, TableLayoutSettings, TableRowLayout, TableSides, TableBorder } from './helpers/tableLayout.js';

export type { TableCellLayout, TableLayoutSettings, TableRowLayout, TableSides, TableBorder } from './helpers/tableLayout.js';

declare module '@domternal/core' {
  interface RawCommands {
    setTableLayout: CommandSpec<[layout: TableLayoutSettings | null]>;
    setTableRowLayout: CommandSpec<[layout: TableRowLayout | null]>;
    setTableCellLayout: CommandSpec<[layout: TableCellLayout | null]>;
  }
}

function stored<T>(element: HTMLElement, name: string, read: (value: unknown) => T | null): T | null {
  const raw = element.getAttribute(`data-dm-${name}`);
  if (!raw || raw.length > 4096) return null;
  try { return read(JSON.parse(raw)); } catch { return null; }
}
function rowFromHTML(element: HTMLElement): TableRowLayout | null {
  const height = tableLength(element.style.height, 1, 4096);
  const split = element.style.breakInside || element.style.getPropertyValue('page-break-inside');
  return readTableRowLayout({ ...(height === undefined ? {} : { height }),
    ...(split === 'avoid' || split === 'auto' ? { allowSplit: split === 'auto' } : {}),
  });
}
function normalizeColor(value: string): string {
  const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(value);
  if (!match) return value;
  const channels = match.slice(1).map(Number);
  return channels.every(channel => channel <= 255)
    ? `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}` : value;
}
function cellFromHTML(element: HTMLElement): TableCellLayout | null {
  const padding: TableSides<number> = {}; const borders: TableSides<TableBorder> = {};
  for (const side of TABLE_LAYOUT_SIDES) {
    const length = tableLength(element.style.getPropertyValue(`padding-${side}`), 0, 256);
    if (length !== undefined) padding[side] = length;
    const width = tableLength(element.style.getPropertyValue(`border-${side}-width`), 0, 16);
    const style = element.style.getPropertyValue(`border-${side}-style`);
    const color = normalizeColor(element.style.getPropertyValue(`border-${side}-color`));
    const candidate = readTableCellLayout({ borders: { [side]: { width: style === 'none' ? 0 : width, style, color: style === 'none' ? '#000000' : color } } });
    if (candidate?.borders?.[side]) borders[side] = candidate.borders[side];
  }
  return readTableCellLayout({ padding, borders });
}

function attribute<T>(name: string, read: (value: unknown) => T | null, html: (element: HTMLElement) => T | null, css: (value: T) => string): GlobalAttributeSpec {
  const validate = (value: unknown): void => { if (value !== null && !read(value)) throw new RangeError(`Invalid ${name}`); };
  Object.defineProperty(validate, Symbol.for('@domternal/table-layout/v1'), { value: read });
  return {
    default: null,
    validate,
    parseHTML: element => stored(element, name, read) ?? html(element),
    renderHTML: attrs => {
      const value = read(attrs[name]);
      if (!value) return null;
      const background = name === 'cellLayout' && isSafeCssValue(attrs['background']) ? `background-color:${String(attrs['background'])};` : '';
      return { [`data-dm-${name}`]: JSON.stringify(value), style: background + css(value) };
    },
  };
}

/** Opt-in document geometry. Add beside Table; existing Table schemas and defaults remain unchanged. */
export const TableLayout = Extension.create({
  name: 'tableLayout',
  addGlobalAttributes(): GlobalAttributes[] {
    return [
      { types: ['table'], attributes: { tableLayout: attribute('tableLayout', readTableLayout,
        element => readTableLayout({ breakBefore: element.style.breakBefore || (element.style.getPropertyValue('page-break-before') === 'always' ? 'page' : element.style.getPropertyValue('page-break-before')) }),
        value => `break-before:${value.breakBefore ?? 'auto'};page-break-before:${value.breakBefore === 'page' ? 'always' : 'auto'}`) } },
      { types: ['tableRow'], attributes: { rowLayout: attribute('rowLayout', readTableRowLayout, rowFromHTML, tableRowStyle) } },
      { types: ['tableCell', 'tableHeader'], attributes: { cellLayout: attribute('cellLayout', readTableCellLayout, cellFromHTML, tableCellStyle) } },
    ];
  },
  addCommands() {
    function update<T>(types: readonly string[], name: string, read: (value: unknown) => T | null) {
      return (value: T | null): Command => ({ state, dispatch }) => {
        const layout = read(value);
        if (value !== null && !layout) return false;
        const positions = new Map<number, PMNode>();
        const addAncestors = (position: number): void => {
          const resolved = state.doc.resolve(position);
          for (let depth = resolved.depth; depth > 0; depth--) {
            const node = resolved.node(depth);
            if (types.includes(node.type.name)) { positions.set(resolved.before(depth), node); break; }
          }
        };
        if (state.selection instanceof CellSelection) {
          state.selection.forEachCell((cell, position) => {
            if (types.includes(cell.type.name)) positions.set(position, cell);
            else addAncestors(position);
          });
        } else {
          const { from, to } = state.selection;
          addAncestors(from); addAncestors(to);
          if (from !== to) state.doc.nodesBetween(from, to, (node, pos) => {
            if (types.includes(node.type.name)) { positions.set(pos, node); return false; }
            return true;
          });
        }
        if (!positions.size) return false;
        if (dispatch) {
          const tr = state.tr;
          for (const [position, node] of positions) tr.setNodeMarkup(position, undefined, { ...node.attrs, [name]: layout });
          dispatch(tr);
        }
        return true;
      };
    }
    return {
      setTableLayout: update(['table'], 'tableLayout', readTableLayout),
      setTableRowLayout: update(['tableRow'], 'rowLayout', readTableRowLayout),
      setTableCellLayout: update(['tableCell', 'tableHeader'], 'cellLayout', readTableCellLayout),
    };
  },
});
