import { describe, expect, it } from 'vitest';
import type { CompoundListLabel } from '../types/ListLabel.js';
import { formatListLabel, listLabelCSS, listLabelForKind, parseListLabel, readListLabel, serializeListLabel } from './listLabel.js';
import { compileListLabelStyles } from './listLabelStyles.js';

const label = (): CompoundListLabel => ({ kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'inherit' }, ') '], fallback: 'decimal' });

describe('bounded compound list labels', () => {
  it('clones and freezes every data part while retaining canonical order', () => {
    const source = label(); const result = readListLabel(source);
    expect(result).toEqual(source); expect(result).not.toBe(source);
    expect(result?.kind).toBe('compound');
    if (result?.kind !== 'compound') throw new Error('Missing compound label');
    expect(Object.isFrozen(result.parts)).toBe(true); expect(Object.isFrozen(result.parts[0])).toBe(true);
    source.parts[0] = 'changed'; expect(result.parts[0]).toEqual({ ancestor: 1, format: 'inherit' });
    expect(parseListLabel(serializeListLabel(result))).toEqual(result);
    expect(listLabelForKind('orderedList', result)).toEqual(result);
    expect(listLabelForKind('bulletList', result)).toBeNull();
  });

  it.each([
    [], ['literal'], [{ ancestor: 1, format: 'decimal' }], [{ ancestor: -1, format: 'decimal' }],
    [{ ancestor: 9, format: 'decimal' }, { ancestor: 0, format: 'decimal' }],
    [{ ancestor: 0, format: 'decimal' }, { ancestor: 1, format: 'decimal' }],
    [{ ancestor: 0, format: 'decimal' }, { ancestor: 0, format: 'decimal' }],
    [{ ancestor: 0.5, format: 'decimal' }], [{ ancestor: 0, format: 'url(x)' }],
    [{ ancestor: 0, format: 'decimal', other: true }],
    ['x'.repeat(65), { ancestor: 0, format: 'decimal' }],
    ['bad\n', { ancestor: 0, format: 'decimal' }],
    Array(20).fill('x') as unknown[],
  ].map(parts => ({ parts })))('rejects malformed or unbounded parts $parts', ({ parts }) => {
    expect(readListLabel({ ...label(), parts })).toBeNull();
  });

  it('rejects accessors and altered arrays without evaluating them', () => {
    let reads = 0;
    const parts = [Object.defineProperty({ ancestor: 0 }, 'format', { enumerable: true, get() { reads++; return 'decimal'; } })];
    expect(readListLabel({ ...label(), parts })).toBeNull();
    const accessor = Object.defineProperty([], '0', { enumerable: true, get() { reads++; return { ancestor: 0, format: 'decimal' }; } });
    expect(readListLabel({ ...label(), parts: accessor })).toBeNull();
    const extra = Object.assign(label().parts, { extra: 1 });
    expect(readListLabel({ ...label(), parts: extra })).toBeNull();
    expect(readListLabel({ ...label(), parts: new Array(2) })).toBeNull();
    expect(reads).toBe(0);
  });

  it('normalizes adjacent and empty literal parts without changing their text', () => {
    expect(readListLabel({ ...label(), parts: ['', 'Section ', '(', { ancestor: 0, format: 'decimal' }, '', ')'] }))
      .toEqual({ ...label(), parts: ['Section (', { ancestor: 0, format: 'decimal' }, ')'] });
  });

  it('resolves actual ancestor values, explicit formats, zero and CSS endpoints', () => {
    expect(formatListLabel(label(), 0, [{ ordinal: 28, format: 'lower-alpha' }])).toBe('ab.0) ');
    expect(formatListLabel({ ...label(), parts: [{ ancestor: 2, format: 'decimal' }, '.', { ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'upper-roman' }] }, 4000,
      [{ ordinal: 3, format: 'lower-roman' }, { ordinal: 7, format: 'upper-alpha' }])).toBe('7.iii.4000');
    expect(formatListLabel(label(), 3)).toBeNull();
    expect(formatListLabel(label(), 3, [null])).toBeNull();
    expect(formatListLabel(label(), 3, [{ ordinal: -1, format: 'decimal' }])).toBeNull();
    expect(formatListLabel(label(), 3, [{ ordinal: 2_147_483_648, format: 'decimal' }])).toBeNull();
  });

  it('compiles only a fallback counter and a fixed derived marker selector', () => {
    const malicious = { ...label(), parts: ['"</style><script>', { ancestor: 0, format: 'decimal' }] };
    const valid = readListLabel(malicious);
    expect(valid).not.toBeNull();
    const css = compileListLabelStyles(valid === null ? [] : [valid]);
    expect(css).toContain('system: extends decimal');
    expect(css).toContain('content: attr(data-dm-compound-marker)');
    expect(css).not.toContain('</style>');
    expect(listLabelCSS(label())).toBe('counter(list-item, decimal) ". "');
  });
});
