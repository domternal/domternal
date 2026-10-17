import type { CompoundListLabel, CompoundListLabelCounter, ListLabel, ListLabelAncestor, ListLabelFormat } from '../types/ListLabel.js';

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

function format(value: unknown): value is ListLabelFormat {
  return typeof value === 'string' && (FORMATS as readonly string[]).includes(value);
}

function field(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor && descriptor.enumerable ? descriptor.value as unknown : undefined;
}

function compound(parts: unknown, fallback: unknown): CompoundListLabel | null {
  if (!format(fallback) || !Array.isArray(parts) || Object.getPrototypeOf(parts) !== Array.prototype) return null;
  const length = Object.getOwnPropertyDescriptor(parts, 'length')?.value as unknown;
  if (typeof length !== 'number' || length < 1 || length > 19 || Reflect.ownKeys(parts).length !== length + 1) return null;
  const copy: (string | CompoundListLabelCounter)[] = [];
  let previous = 9; let literals = 0;
  for (let index = 0; index < length; index++) {
    const part = field(parts, String(index));
    if (typeof part === 'string') {
      const count = textLength(part);
      if (count === undefined || (literals += count) > LIST_LABEL_TEXT_LIMIT) return null;
      if (part !== '') {
        const last = copy.length - 1;
        if (typeof copy[last] === 'string') copy[last] += part;
        else copy.push(part);
      }
      continue;
    }
    if (part === null || typeof part !== 'object' || Array.isArray(part)) return null;
    const prototype: unknown = Object.getPrototypeOf(part);
    const keys = Reflect.ownKeys(part);
    if (prototype !== null && prototype !== Object.prototype || keys.length !== 2 || !keys.every(key => key === 'ancestor' || key === 'format')) return null;
    const ancestor = field(part, 'ancestor'); const marker = field(part, 'format');
    if (typeof ancestor !== 'number' || !Number.isInteger(ancestor) || ancestor < 0 || ancestor >= previous
      || marker !== 'inherit' && !format(marker)) return null;
    previous = ancestor;
    copy.push(Object.freeze({ ancestor, format: marker }));
  }
  if (previous !== 0) return null;
  Object.freeze(copy);
  return Object.freeze({ kind: 'compound', parts: copy, fallback });
}

/** Accept only data records, without invoking getters or retaining caller-owned objects. */
export function readListLabel(value: unknown): ListLabel | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (!(keys.length === 2 && keys.every(key => key === 'kind' || key === 'text'))
      && !(keys.length === 3 && keys.every(key => key === 'kind' || key === 'parts' || key === 'fallback'))
      && !(keys.length === 4 && keys.every(key => key === 'kind' || key === 'format' || key === 'prefix' || key === 'suffix'))) return null;
    const kind = field(value, 'kind');
    if (kind === 'text' && keys.length === 2 && keys.every(key => key === 'kind' || key === 'text')) {
      const text = field(value, 'text'); const length = textLength(text);
      if (length === undefined || length === 0 || typeof text !== 'string' || !/\S/u.test(text)) return null;
      return Object.freeze({ kind, text });
    }
    if (kind === 'compound' && keys.length === 3) return compound(field(value, 'parts'), field(value, 'fallback'));
    if (kind !== 'counter' || keys.length !== 4 || !keys.every(key => key === 'kind' || key === 'format' || key === 'prefix' || key === 'suffix')) return null;
    const format = field(value, 'format'); const prefix = field(value, 'prefix'); const suffix = field(value, 'suffix');
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
  return label !== null && (kind === 'orderedList' && label.kind !== 'text' || kind === 'bulletList' && label.kind === 'text') ? label : null;
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
export function formatListLabel(value: unknown, ordinal?: number, ancestors: readonly ListLabelAncestor[] = []): string | null {
  const label = readListLabel(value);
  if (label === null) return null;
  if (label.kind === 'text') return label.text;
  if (ordinal === undefined || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > COUNTER_LIMIT) return null;
  if (label.kind === 'compound') {
    let result = '';
    for (const part of label.parts) {
      if (typeof part === 'string') { result += part; continue; }
      const context = part.ancestor === 0 ? { ordinal, format: label.fallback } : ancestors[part.ancestor - 1];
      if (context === null || context === undefined || !Number.isSafeInteger(context.ordinal) || context.ordinal < 0
        || context.ordinal > COUNTER_LIMIT || !format(context.format)) return null;
      result += counter(context.ordinal, part.format === 'inherit' ? context.format : part.format);
    }
    return result;
  }
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
  if (label.kind === 'compound') return `counter(list-item, ${label.fallback}) ". "`;
  return label.kind === 'text' ? quoteListLabelCSS(label.text)
    : `${quoteListLabelCSS(label.prefix)} counter(list-item, ${label.format}) ${quoteListLabelCSS(label.suffix)}`;
}
