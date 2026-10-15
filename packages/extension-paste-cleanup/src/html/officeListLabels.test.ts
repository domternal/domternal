// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readOfficeMarkerLabel } from './officeListLabels.js';
import type { OfficeLevelDefinition } from './officeListStyles.js';

const definition = (values: Partial<OfficeLevelDefinition> = {}): OfficeLevelDefinition => ({ format: 'decimal', legal: false, ...values });

describe('one bounded Word level label', () => {
  it.each([
    ['decimal', 'Section %1)', 'Section 0)', 0, 'decimal', 'Section ', ') '],
    ['decimal', '%1:', '10000:', 10000, 'decimal', '', ': '],
    ['alpha-lower', '(%1)', '(aa)', 27, 'lower-alpha', '(', ') '],
    ['alpha-upper', 'Part %1.', 'Part ZZZ.', 18278, 'upper-alpha', 'Part ', '. '],
    ['roman-lower', '[%1]', '[xiv]', 14, 'lower-roman', '[', '] '],
    ['roman-upper', 'Article %2:', 'Article XIV:', 14, 'upper-roman', 'Article ', ': '],
  ] as const)('reads the declared %s label %s against its visible marker', (format, text, visible, ordinal, expectedFormat, prefix, suffix) => {
    const result = readOfficeMarkerLabel(definition({ format, text }), text.includes('%2') ? 2 : 1, visible);
    if (ordinal > 10_000) expect(result).toBeUndefined();
    else expect(result).toEqual({ kind: 'ol', markerStyle: expectedFormat, ordinal,
      listLabel: { kind: 'counter', format: expectedFormat, prefix, suffix } });
  });

  it.each(['✓', 'Step', '→', '👩‍💻'])('reads a Unicode text bullet %s without making a font or image asset', text => {
    expect(readOfficeMarkerLabel(definition({ format: 'bullet', text, font: 'arial' }), 1, text, 'arial')).toEqual({
      kind: 'ul', markerStyle: 'disc', listLabel: { kind: 'text', text },
    });
  });

  it('reads an omitted parent level without inventing its current ordinal', () => {
    expect(readOfficeMarkerLabel(definition({ text: 'Section %1)' }), 1)).toEqual({ kind: 'ol', markerStyle: 'decimal',
      listLabel: { kind: 'counter', format: 'decimal', prefix: 'Section ', suffix: ') ' } });
  });

  it.each([
    ['%1.%2.', '1.2.'], ['%1.%1.', '1.1.'], ['%2.', '2.'], ['Article', 'Article'],
    ['%1.', '01.'], ['%1.', '-1.'], ['%1.', '10001.'], ['Part %1)', 'Other 1)'],
    ['Part %1)', 'Part 1.'], ['x'.repeat(64) + '%1.', '1.'], ['\u202e%1.', '1.'],
  ])('keeps unsupported or mismatched level text %s literal', (text, visible) => {
    expect(readOfficeMarkerLabel(definition({ text }), 1, visible)).toBeUndefined();
  });

  it.each([
    ['alpha-lower', 'AA'], ['alpha-upper', 'aa'], ['roman-lower', 'iiii'],
    ['roman-upper', 'xiv'], ['roman-upper', 'MMMM'], ['decimal', 'a'],
  ] as const)('does not guess the number behind %s %s', (format, visible) => {
    expect(readOfficeMarkerLabel(definition({ format }), 1, `${visible}.`)).toBeUndefined();
  });

  it('keeps font-dependent and private-use labels, legal numbering and other formats unsupported', () => {
    for (const font of ['symbol', 'wingdings', 'wingdings 2', 'webdings', 'zapf dingbats']) {
      expect(readOfficeMarkerLabel(definition({ format: 'bullet', text: 'x', font }), 1, 'x', font)).toBeUndefined();
    }
    for (const text of ['\uF0B7', '\u{F0001}', '%1']) {
      expect(readOfficeMarkerLabel(definition({ format: 'bullet', text }), 1, text)).toBeUndefined();
    }
    expect(readOfficeMarkerLabel(definition({ legal: true }), 1, '1.')).toBeUndefined();
    expect(readOfficeMarkerLabel(definition({ format: 'other' }), 1, '1.')).toBeUndefined();
    expect(readOfficeMarkerLabel(definition(), 1, '1.', null)).toBeUndefined();
    expect(readOfficeMarkerLabel(definition(), 10, '1.')).toBeUndefined();
  });
});
