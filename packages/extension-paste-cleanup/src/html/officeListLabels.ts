import { formatListLabel, readListLabel } from '@domternal/core/list-labels';
import type { ListLabel, ListLabelFormat } from '@domternal/core/list-labels';
import type { OfficeLevelDefinition } from './officeListStyles.js';

export interface OfficeMarkerLabel {
  kind: 'ol' | 'ul';
  markerStyle: ListLabelFormat | 'disc';
  listLabel: ListLabel;
  ordinal?: number;
}

const formats: Readonly<Partial<Record<OfficeLevelDefinition['format'], ListLabelFormat>>> = {
  decimal: 'decimal', 'alpha-lower': 'lower-alpha', 'alpha-upper': 'upper-alpha',
  'roman-lower': 'lower-roman', 'roman-upper': 'upper-roman',
};
const privateGlyph = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const symbolFont = /^(?:symbol|wingdings(?: [1-3])?|webdings|zapf dingbats)$/u;
const romanDigits: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** A candidate must round trip through the shared formatter, so ambiguous spellings never infer a number. */
function ordinal(value: string, format: ListLabelFormat): number | undefined {
  let result = 0;
  if (/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) result = Number(value);
  else if (format === 'lower-alpha' || format === 'upper-alpha') {
    if (!/^[A-Za-z]{1,3}$/u.test(value)) return undefined;
    for (const character of value.toLowerCase()) result = result * 26 + character.charCodeAt(0) - 96;
  } else if (format === 'lower-roman' || format === 'upper-roman') {
    if (!/^[ivxlcdmIVXLCDM]{1,15}$/u.test(value)) return undefined;
    const lower = value.toLowerCase();
    for (let index = 0; index < lower.length; index++) {
      const digit = romanDigits[lower.charAt(index)] ?? 0;
      result += digit < (romanDigits[lower.charAt(index + 1)] ?? 0) ? -digit : digit;
    }
  } else return undefined;
  if (result > 10_000 || formatListLabel({ kind: 'counter', format, prefix: '', suffix: '' }, result) !== value) return undefined;
  return result;
}

/** One explicitly defined level counter or a Unicode text bullet, without inferred parent counters or fonts. */
export function readOfficeMarkerLabel(definition: OfficeLevelDefinition, level: number, visible?: string, runFont?: string | null): OfficeMarkerLabel | undefined {
  if (!Number.isInteger(level) || level < 1 || level > 9 || definition.legal || runFont === null
    || symbolFont.test(definition.font ?? '') || symbolFont.test(runFont ?? '')) return undefined;
  const text = definition.text ?? (definition.format === 'bullet' ? '' : `%${String(level)}.`);
  if (privateGlyph.test(text)) return undefined;
  if (definition.format === 'bullet') {
    if (text.includes('%')) return undefined;
    const listLabel = readListLabel({ kind: 'text', text });
    return listLabel !== null && (visible === undefined || text === visible) ? { kind: 'ul', markerStyle: 'disc', listLabel } : undefined;
  }
  const format = formats[definition.format];
  if (format === undefined) return undefined;
  const token = `%${String(level)}`;
  const offset = text.indexOf(token);
  if (offset < 0) return undefined;
  const prefix = text.slice(0, offset); const suffix = text.slice(offset + token.length);
  if (prefix.includes('%') || suffix.includes('%')) return undefined;
  // Word's marker separator is layout. A single native separator keeps the marker clear of its item text.
  const listLabel = readListLabel({ kind: 'counter', format, prefix, suffix: `${suffix} ` });
  if (listLabel === null) return undefined;
  if (visible === undefined) return { kind: 'ol', markerStyle: format, listLabel };
  if (!visible.startsWith(prefix) || !visible.endsWith(suffix)) return undefined;
  const digits = visible.slice(prefix.length, suffix.length === 0 ? undefined : -suffix.length);
  const value = ordinal(digits, format);
  return value === undefined ? undefined : { kind: 'ol', markerStyle: format, listLabel, ordinal: value };
}
