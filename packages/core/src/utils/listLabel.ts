import type { ListLabel, ListLabelFormat } from '../types/ListLabel.js';

const FORMATS: readonly ListLabelFormat[] = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'];
/** Text is bounded in Unicode code points, including both ordered affixes together. */
export const LIST_LABEL_TEXT_LIMIT = 64;
/** The closed JSON representation remains small even when every character is escaped. */
const JSON_LIMIT = 1_024;
const COUNTER_LIMIT = 2_147_483_647;
// Formatting controls can conceal or reorder a marker. Joiners used by natural language and emoji remain text.
function control(point: number): boolean {
  return point < 0x20 || point >= 0x7f && point <= 0x9f || point === 0x61c
    || point === 0x200e || point === 0x200f || point >= 0x2028 && point <= 0x202e
    || point >= 0x2066 && point <= 0x2069 || point === 0xfeff;
}

function textLength(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > LIST_LABEL_TEXT_LIMIT * 2) return undefined;
  let count = 0;
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point === undefined || control(point) || point >= 0xd800 && point <= 0xdfff || ++count > LIST_LABEL_TEXT_LIMIT) return undefined;
  }
  return count;
}

/** Accept only data records, without invoking getters or retaining caller-owned objects. */
export function readListLabel(value: unknown): ListLabel | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 && keys.length !== 4) return null;
    const field = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable ? descriptor.value as unknown : undefined;
    };
    const kind = field('kind');
    if (kind === 'text' && keys.length === 2 && keys.every(key => key === 'kind' || key === 'text')) {
      const text = field('text'); const length = textLength(text);
      if (length === undefined || length === 0 || typeof text !== 'string' || !/\S/u.test(text)) return null;
      return Object.freeze({ kind, text });
    }
    if (kind !== 'counter' || keys.length !== 4 || !keys.every(key => key === 'kind' || key === 'format' || key === 'prefix' || key === 'suffix')) return null;
    const format = field('format'); const prefix = field('prefix'); const suffix = field('suffix');
    const before = textLength(prefix); const after = textLength(suffix);
    if (typeof format !== 'string' || !(FORMATS as readonly string[]).includes(format)
      || typeof prefix !== 'string' || typeof suffix !== 'string' || before === undefined || after === undefined
      || before + after > LIST_LABEL_TEXT_LIMIT) return null;
    return Object.freeze({ kind, format: format as ListLabelFormat, prefix, suffix });
  } catch {
    return null;
  }
}

/** A counter belongs to an ordered list; a literal marker belongs to a bullet list. */
export function listLabelForKind(kind: string, value: unknown): ListLabel | null {
  const label = readListLabel(value);
  return label !== null && (kind === 'orderedList' && label.kind === 'counter' || kind === 'bulletList' && label.kind === 'text') ? label : null;
}

export function parseListLabel(value: unknown): ListLabel | null {
  if (typeof value !== 'string' || value.length > JSON_LIMIT) return null;
  try { return readListLabel(JSON.parse(value) as unknown); } catch { return null; }
}

/** Canonical property order prevents equivalent labels from acquiring different HTML identities. */
export function serializeListLabel(value: unknown): string | null {
  const label = readListLabel(value);
  return label === null ? null : JSON.stringify(label);
}

function alphabetic(value: number, upper: boolean): string {
  let result = '';
  while (value > 0) {
    value--;
    result = String.fromCharCode((upper ? 65 : 97) + value % 26) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** The predefined CSS formats fall back to decimal outside their defined range. */
function counter(value: number, format: ListLabelFormat): string {
  if (format === 'decimal' || value === 0 || (format === 'lower-roman' || format === 'upper-roman') && value > 3_999) return String(value);
  if (format === 'lower-alpha' || format === 'upper-alpha') return alphabetic(value, format === 'upper-alpha');
  let result = '';
  for (const [amount, symbol] of ROMAN) {
    while (value >= amount) { result += symbol; value -= amount; }
  }
  return format === 'lower-roman' ? result.toLowerCase() : result;
}

/** Shared display/export formatting. An invalid ordinal never becomes a plausible marker. */
export function formatListLabel(value: unknown, ordinal?: number): string | null {
  const label = readListLabel(value);
  if (label === null) return null;
  if (label.kind === 'text') return label.text;
  if (ordinal === undefined || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > COUNTER_LIMIT) return null;
  return label.prefix + counter(ordinal, label.format) + label.suffix;
}

/** Quote a validated CSS string; syntax-looking text can never leave its string token. */
export function quoteListLabelCSS(value: string): string {
  return `"${value.replace(/["'\\<>&]/gu, character => `\\${character.codePointAt(0)?.toString(16) ?? ''} `)}"`;
}

/** Only the list-item counter and closed format enum can become CSS syntax. */
export function listLabelCSS(value: unknown): string | null {
  const label = readListLabel(value);
  if (label === null) return null;
  return label.kind === 'text' ? quoteListLabelCSS(label.text)
    : `${quoteListLabelCSS(label.prefix)} counter(list-item, ${label.format}) ${quoteListLabelCSS(label.suffix)}`;
}
