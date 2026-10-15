import { describe, expect, it } from 'vitest';
import { formatListLabel, listLabelCSS, listLabelForKind, parseListLabel, readListLabel, serializeListLabel } from './listLabel.js';
import type { CounterListLabel, ListLabelFormat } from '../types/ListLabel.js';

const label = (format: ListLabelFormat = 'decimal', prefix = 'Section ', suffix = ')'): CounterListLabel => ({ kind: 'counter', format, prefix, suffix });

describe('bounded list label records', () => {
  it('copies and freezes only the closed data record', () => {
    const original = { ...label() }; const read = readListLabel(original);
    expect(read).toEqual(original); expect(read).not.toBe(original); expect(Object.isFrozen(read)).toBe(true);
    original.prefix = 'Changed'; expect(read).toMatchObject({ prefix: 'Section ' });
    expect(readListLabel(Object.assign(Object.create(null) as object, { kind: 'text', text: '✓' }))).toEqual({ kind: 'text', text: '✓' });
  });

  it.each([null, undefined, 1, '', [], new Date(), { kind: 'counter' }, { kind: 'text', text: '' }, { kind: 'text', text: '  ' },
    { ...label(), format: 'custom' }, { ...label(), suffix: null }, { ...label(), extra: true },
    { kind: 'text', text: '✓', format: 'decimal' }, { ...label(), [Symbol('extra')]: 1 }])('rejects an unknown record %j', value => {
    expect(readListLabel(value)).toBeNull(); expect(listLabelCSS(value)).toBeNull(); expect(serializeListLabel(value)).toBeNull();
  });

  it('does not call accessors, inherit fields or stringify arbitrary objects', () => {
    let reads = 0;
    const accessor = { kind: 'text', get text() { reads++; return '✓'; } };
    expect(readListLabel(accessor)).toBeNull(); expect(reads).toBe(0);
    expect(readListLabel(Object.create({ kind: 'text', text: '✓' }) as unknown)).toBeNull();
    expect(readListLabel(Object.defineProperty({ kind: 'text' }, 'text', { value: '✓', enumerable: false }))).toBeNull();
    const proxy = new Proxy({}, { ownKeys() { throw new Error('closed'); } });
    expect(readListLabel(proxy)).toBeNull();
  });

  it('rejects excess fields before looking up their descriptors', () => {
    let reads = 0;
    const original = { kind: 'text', text: '✓', extra: 1 };
    const proxy = new Proxy(original, { getOwnPropertyDescriptor(target, property) { reads++; return Reflect.getOwnPropertyDescriptor(target, property); } });
    expect(readListLabel(proxy)).toBeNull(); expect(reads).toBe(0);
  });

  it.each(['\0', '\t', '\n', '\r', '\u007f', '\u009f', '\u061c', '\u200e', '\u200f', '\u2028', '\u202e', '\u2066', '\u2069', '\ufeff', '\ud800', '\udfff'])('rejects control or invalid Unicode %j', character => {
    expect(readListLabel(label('decimal', character))).toBeNull();
    expect(readListLabel({ kind: 'text', text: `x${character}` })).toBeNull();
  });

  it('bounds both affixes together and counts supplementary characters once', () => {
    expect(readListLabel(label('decimal', '😀'.repeat(32), 'x'.repeat(32)))).not.toBeNull();
    expect(readListLabel(label('decimal', '😀'.repeat(32), 'x'.repeat(33)))).toBeNull();
    expect(readListLabel({ kind: 'text', text: '😀'.repeat(64) })).not.toBeNull();
    expect(readListLabel({ kind: 'text', text: '😀'.repeat(65) })).toBeNull();
    expect(readListLabel({ kind: 'text', text: '👨‍👩‍👧' })).not.toBeNull();
    expect(readListLabel(label('decimal', '', ''))).not.toBeNull();
  });

  it('keeps ordered and bullet contracts separate', () => {
    const bullet = { kind: 'text', text: '→' };
    expect(listLabelForKind('orderedList', label())).toEqual(label());
    expect(listLabelForKind('bulletList', bullet)).toEqual(bullet);
    expect(listLabelForKind('bulletList', label())).toBeNull();
    expect(listLabelForKind('orderedList', bullet)).toBeNull();
    expect(listLabelForKind('taskList', bullet)).toBeNull();
  });

  it('roundtrips canonical JSON without accepting extra fields or excessive input', () => {
    const original = label('lower-alpha', '<" & ', '\\);');
    expect(parseListLabel(serializeListLabel(original))).toEqual(original);
    expect(serializeListLabel({ suffix: ')', prefix: 'Section ', format: 'decimal', kind: 'counter' })).toBe(JSON.stringify(label()));
    expect(parseListLabel('{')).toBeNull(); expect(parseListLabel(' '.repeat(1_025))).toBeNull();
    expect(parseListLabel('{"kind":"text","text":"x","__proto__":{}}')).toBeNull();
    expect(parseListLabel({ toString: () => JSON.stringify(label()) })).toBeNull();
  });
});

describe('list label formatting', () => {
  it.each([
    ['decimal', 0, '0'], ['decimal', 42, '42'], ['lower-alpha', 0, '0'], ['lower-alpha', 1, 'a'],
    ['lower-alpha', 26, 'z'], ['lower-alpha', 27, 'aa'], ['upper-alpha', 52, 'AZ'], ['upper-alpha', 703, 'AAA'],
    ['lower-roman', 0, '0'], ['lower-roman', 49, 'xlix'], ['upper-roman', 944, 'CMXLIV'],
    ['upper-roman', 3_999, 'MMMCMXCIX'], ['lower-roman', 4_000, '4000'], ['upper-roman', 2_147_483_647, '2147483647'],
  ] as const)('formats %s at %s', (format, value, expected) => {
    expect(formatListLabel(label(format), value)).toBe(`Section ${expected})`);
  });

  it.each([undefined, -1, 0.5, NaN, Infinity, 2_147_483_648, Number.MAX_SAFE_INTEGER])('refuses an invalid ordinal %s', value => {
    expect(formatListLabel(label(), value)).toBeNull();
  });

  it('formats literal text without requiring a counter', () => {
    expect(formatListLabel({ kind: 'text', text: '☑' })).toBe('☑');
    expect(formatListLabel({ kind: 'unknown' }, 1)).toBeNull();
  });

  it('emits only a fixed counter expression and quoted text tokens', () => {
    expect(listLabelCSS(label())).toBe('"Section " counter(list-item, decimal) ")"');
    expect(listLabelCSS({ kind: 'text', text: '✓' })).toBe('"✓"');
    expect(listLabelCSS(label('decimal', '"; color:red; } /*', '\\"\'</style>&')))
      .toBe('"\\22 ; color:red; } /*" counter(list-item, decimal) "\\5c \\22 \\27 \\3c /style\\3e \\26 "');
  });
});
