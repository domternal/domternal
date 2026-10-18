/* Object aliases remain assignable to the public JSONContent attribute format. */
/* eslint-disable @typescript-eslint/consistent-type-definitions */
import type { Node as PMNode } from '@domternal/pm/model';

/** Explicit dimensions use CSS pixels, with bounded values suitable for document layout. */
export type TableRowLayout = {
  height?: number;
  /** Browsers and PDF retain a minimum height; Word also supports an exact height. */
  heightRule?: 'atLeast' | 'exact';
  allowSplit?: boolean;
};

export type TableBorder = {
  width: number;
  style: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  color: string;
};

export type TableSides<T> = Partial<Record<'top' | 'right' | 'bottom' | 'left', T>>;

export type TableCellLayout = {
  padding?: TableSides<number>;
  borders?: TableSides<TableBorder>;
};

export type TableLayoutSettings = {
  breakBefore?: 'auto' | 'page';
};

export const TABLE_LAYOUT_SIDES = ['top', 'right', 'bottom', 'left'] as const;

function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    && Object.keys(value).every(key => keys.includes(key));
}
function bounded(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Null means absent or invalid. Unknown keys never silently become document settings. */
export function readTableRowLayout(value: unknown): TableRowLayout | null {
  if (!record(value, ['height', 'heightRule', 'allowSplit'])) return null;
  const result: TableRowLayout = {};
  if (value['height'] !== undefined) {
    if (!bounded(value['height'], 1, 4096)) return null;
    result.height = value['height'];
  }
  if (value['heightRule'] !== undefined) {
    if (!result.height || (value['heightRule'] !== 'atLeast' && value['heightRule'] !== 'exact')) return null;
    result.heightRule = value['heightRule'];
  }
  if (value['allowSplit'] !== undefined) {
    if (typeof value['allowSplit'] !== 'boolean') return null;
    result.allowSplit = value['allowSplit'];
  }
  return Object.keys(result).length ? result : null;
}

export function readTableCellLayout(value: unknown): TableCellLayout | null {
  if (!record(value, ['padding', 'borders'])) return null;
  const result: TableCellLayout = {};
  if (value['padding'] !== undefined) {
    if (!record(value['padding'], TABLE_LAYOUT_SIDES)) return null;
    const padding: TableSides<number> = {};
    for (const side of TABLE_LAYOUT_SIDES) {
      const entry = value['padding'][side];
      if (entry === undefined) continue;
      if (!bounded(entry, 0, 256)) return null;
      padding[side] = entry;
    }
    if (Object.keys(padding).length) result.padding = padding;
  }
  if (value['borders'] !== undefined) {
    if (!record(value['borders'], TABLE_LAYOUT_SIDES)) return null;
    const borders: TableSides<TableBorder> = {};
    for (const side of TABLE_LAYOUT_SIDES) {
      const entry = value['borders'][side];
      if (entry === undefined) continue;
      if (!record(entry, ['width', 'style', 'color']) || !bounded(entry['width'], 0, 16)
        || typeof entry['style'] !== 'string' || !['solid', 'dashed', 'dotted', 'double', 'none'].includes(entry['style'])
        || typeof entry['color'] !== 'string' || !/^#[\da-f]{6}$/i.test(entry['color'])) return null;
      borders[side] = { width: entry['width'], style: entry['style'] as TableBorder['style'], color: entry['color'].toLowerCase() };
    }
    if (Object.keys(borders).length) result.borders = borders;
  }
  return Object.keys(result).length ? result : null;
}

export function readTableLayout(value: unknown): TableLayoutSettings | null {
  if (!record(value, ['breakBefore']) || (value['breakBefore'] !== 'auto' && value['breakBefore'] !== 'page')) return null;
  return { breakBefore: value['breakBefore'] };
}

/** Parse explicit physical HTML lengths, never percentages, expressions or resource URLs. */
export function tableLength(value: string, min: number, max: number): number | undefined {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|mm|cm|in)?$/i.exec(value.trim());
  if (!match?.[1]) return undefined;
  const factor = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[match[2]?.toLowerCase() ?? 'px'];
  const length = Number(match[1]) * (factor ?? 1);
  return bounded(length, min, max) ? Math.round(length * 10000) / 10000 : undefined;
}

export function tableRowStyle(value: TableRowLayout): string {
  return [value.height === undefined ? '' : `height:${String(value.height)}px`,
    value.allowSplit === undefined ? '' : `break-inside:${value.allowSplit ? 'auto' : 'avoid'};page-break-inside:${value.allowSplit ? 'auto' : 'avoid'}`,
  ].filter(Boolean).join(';');
}
export function tableCellStyle(value: TableCellLayout): string {
  const styles: string[] = [];
  for (const side of TABLE_LAYOUT_SIDES) {
    const padding = value.padding?.[side];
    const border = value.borders?.[side];
    if (padding !== undefined) styles.push(`padding-${side}:${String(padding)}px`);
    if (border) styles.push(`border-${side}:${String(border.width)}px ${border.style} ${border.color}`);
  }
  return styles.join(';');
}

/** Only the opt-in schema's own reader owns these attributes, not similarly named host data. */
export function getNodeTableLayout(node: PMNode): TableLayoutSettings | null {
  return ownedLayout(node, 'tableLayout', readTableLayout);
}
export function getNodeTableRowLayout(node: PMNode): TableRowLayout | null {
  return ownedLayout(node, 'rowLayout', readTableRowLayout);
}
export function getNodeTableCellLayout(node: PMNode): TableCellLayout | null {
  return ownedLayout(node, 'cellLayout', readTableCellLayout);
}
function ownedLayout<T>(node: PMNode, name: string, reader: (value: unknown) => T | null): T | null {
  const validate = node.type.spec.attrs?.[name]?.validate;
  if (typeof validate !== 'function' || Reflect.get(validate, Symbol.for('@domternal/table-layout/v1')) !== reader) return null;
  return reader(node.attrs[name]);
}
