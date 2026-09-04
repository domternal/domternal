// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { declaredFont, officeLevelKey, readOfficeListRules, resolveOfficeLevel } from './officeListStyles.js';

// Authored in the shape Word writes into clipboard HTML, not a native capture.
const wordStyle = `<!--
 /* Font Definitions */
 @font-face
	{font-family:"Cambria Math";
	panose-1:2 4 5 3 5 4 6 3 2 4;}
 /* Style Definitions */
 p.MsoNormal, li.MsoNormal, div.MsoNormal
	{margin:0in;
	font-size:12.0pt;
	font-family:"Calibri",sans-serif;}
@page WordSection1
	{size:8.5in 11.0in;}
div.WordSection1
	{page:WordSection1;}
 /* List Definitions */
 @list l0
	{mso-list-id:1024;
	mso-list-type:hybrid;
	mso-list-template-ids:-1 67698689 67698691;}
@list l0:level1
	{mso-level-number-format:bullet;
	mso-level-text:\\F0B7;
	mso-level-tab-stop:none;
	mso-level-number-position:left;
	text-indent:-.25in;
	font-family:Symbol;}
@list l0:level2
	{mso-level-number-format:bullet;
	mso-level-text:o;
	mso-level-tab-stop:none;
	text-indent:-.25in;
	font-family:"Courier New";
	mso-bidi-font-family:"Times New Roman";}
@list l0:level3
	{mso-level-number-format:bullet;
	mso-level-text:\\F0A7;
	font-family:Wingdings;}
@list l1:level1
	{mso-level-tab-stop:none;
	mso-level-number-position:left;
	text-indent:-.25in;}
@list l1:level2
	{mso-level-number-format:alpha-lower;
	mso-level-tab-stop:none;}
@list l1:level3
	{mso-level-number-format:roman-lower;
	mso-level-tab-stop:none;
	mso-level-number-position:right;
	text-indent:-9.0pt;}
@list l2:level1
	{mso-level-text:"%1\\)";
	mso-level-tab-stop:none;}
@list l2:level1 lfo3
	{mso-level-start-at:5;}
ol
	{margin-bottom:0in;}
-->`;

const allWordKeys = new Set([
  'l0:level1', 'l0:level2', 'l0:level3', 'l1:level1', 'l1:level2', 'l1:level3',
  'l2:level1', 'l2:level1 lfo3', 'l9:level1',
]);

describe('bounded Word @list level definitions', () => {
  it('reads Word bullet and numbering definitions and skips every other rule', () => {
    const rules = readOfficeListRules([wordStyle], allWordKeys);
    const level = (list: string, value: number, instance?: string): unknown => resolveOfficeLevel(rules, list, value, instance);
    expect(level('0', 1)).toEqual({ format: 'bullet', text: '', font: 'symbol', legal: false });
    expect(level('0', 2)).toEqual({ format: 'bullet', text: 'o', font: 'courier new', legal: false });
    expect(level('0', 3)).toEqual({ format: 'bullet', text: '', font: 'wingdings', legal: false });
    expect(level('1', 1)).toEqual({ format: 'decimal', legal: false });
    expect(level('1', 2)).toEqual({ format: 'alpha-lower', legal: false });
    expect(level('1', 3)).toEqual({ format: 'roman-lower', legal: false });
    expect(level('2', 1)).toEqual({ format: 'decimal', text: '%1)', legal: false });
    expect(level('9', 1)).toBeUndefined();
    expect(rules.has('l0')).toBe(false);
  });

  it('records only referenced level keys, before any other allocation', () => {
    const rules = readOfficeListRules([wordStyle], new Set(['l0:level2', 'l1:level1 lfo1']));
    expect([...rules.keys()]).toEqual(['l0:level2']);
    expect(readOfficeListRules([wordStyle], new Set()).size).toBe(0);
  });

  it('applies a matching instance override over its base level', () => {
    const style = '@list l3:level1 {mso-level-number-format:alpha-upper;font-family:Arial}'
      + '@list l3:level1 lfo2 {mso-level-start-at:5}'
      + '@list l3:level1 lfo4 {mso-level-number-format:roman-upper;mso-level-text:"%1\\)"}';
    const rules = readOfficeListRules([style], new Set(['l3:level1', 'l3:level1 lfo2', 'l3:level1 lfo4', 'l3:level1 lfo9']));
    expect(resolveOfficeLevel(rules, '3', 1, '2')).toEqual({ format: 'alpha-upper', font: 'arial', legal: false });
    expect(resolveOfficeLevel(rules, '3', 1, '4')).toEqual({ format: 'roman-upper', text: '%1)', font: 'arial', legal: false });
    expect(resolveOfficeLevel(rules, '3', 1, '9')).toEqual({ format: 'alpha-upper', font: 'arial', legal: false });
    expect(resolveOfficeLevel(rules, '3', 1)).toEqual({ format: 'alpha-upper', font: 'arial', legal: false });
  });

  it('does not accept an instance override without its base level', () => {
    const rules = readOfficeListRules(['@list l4:level1 lfo1 {mso-level-number-format:bullet}'], new Set(['l4:level1', 'l4:level1 lfo1']));
    expect(resolveOfficeLevel(rules, '4', 1, '1')).toBeNull();
  });

  it('keeps legal and other number formats distinguishable from supported ones', () => {
    const style = '@list l5:level1 {mso-level-number-format:arabic-leading-zero}'
      + '@list l5:level2 {mso-level-legal-format:yes;mso-level-text:"%1\\.%2\\."}'
      + '@list l5:level3 {mso-level-number-format:ROMAN-UPPER}';
    const rules = readOfficeListRules([style], new Set(['l5:level1', 'l5:level2', 'l5:level3']));
    expect(resolveOfficeLevel(rules, '5', 1)).toEqual({ format: 'other', legal: false });
    expect(resolveOfficeLevel(rules, '5', 2)).toEqual({ format: 'decimal', text: '%1.%2.', legal: true });
    expect(resolveOfficeLevel(rules, '5', 3)).toEqual({ format: 'roman-upper', legal: false });
  });

  it('treats conflicting definitions as ambiguous and identical repeats as one definition', () => {
    const rule = '@list l6:level1 {mso-level-number-format:bullet;mso-level-text:o;font-family:"Courier New"}';
    const other = '@list l6:level2 {mso-level-number-format:bullet;mso-level-text:o;font-family:Arial}';
    const conflicting = '@list l6:level2 {mso-level-number-format:bullet;mso-level-text:o;font-family:Symbol}';
    const rules = readOfficeListRules([rule + other, rule + conflicting], new Set(['l6:level1', 'l6:level2']));
    expect(resolveOfficeLevel(rules, '6', 1)).toEqual({ format: 'bullet', text: 'o', font: 'courier new', legal: false });
    expect(resolveOfficeLevel(rules, '6', 2)).toBeNull();
  });

  it.each([
    ['conflicting duplicate declarations', 'mso-level-number-format:bullet;mso-level-number-format:alpha-lower'],
    ['an unbalanced block', 'mso-level-text:o;font-family:(Symbol'],
    ['a declaration without a value', 'mso-level-number-format'],
    ['an invalid escape', 'mso-level-text:\\0'],
    ['a surrogate escape', 'mso-level-text:\\D800'],
    ['an escape beyond Unicode', 'mso-level-text:\\110000'],
    ['an unescaped inner quote', 'mso-level-text:o"x"'],
    ['an oversized level text', `mso-level-text:"${'x'.repeat(65)}"`],
    ['an escaped font name', 'font-family:\\53ymbol'],
    ['text after a quoted font', 'font-family:"Courier New"x'],
    ['an invalid number format', 'mso-level-number-format:"bullet"'],
  ])('makes a rule with %s unusable', (_name, body) => {
    const rules = readOfficeListRules([`@list l7:level1 {${body}}`], new Set(['l7:level1']));
    expect(resolveOfficeLevel(rules, '7', 1)).toBeNull();
  });

  it('decodes CSS escapes and quoted level text', () => {
    const style = '@list l8:level1 {mso-level-text:"\\2022"}@list l8:level2 {mso-level-text:\\25E6 }'
      + "@list l8:level3 {mso-level-text:'%3\\.'}";
    const rules = readOfficeListRules([style], new Set(['l8:level1', 'l8:level2', 'l8:level3']));
    expect(resolveOfficeLevel(rules, '8', 1)?.text).toBe('•');
    expect(resolveOfficeLevel(rules, '8', 2)?.text).toBe('◦');
    expect(resolveOfficeLevel(rules, '8', 3)?.text).toBe('%3.');
  });

  it('bounds each rule body and its declaration count', () => {
    const long = `@list l9:level1 {mso-level-text:o;x-pad:"${'a'.repeat(8200)}"}`;
    const many = `@list l9:level2 {${Array.from({ length: 65 }, (_, index) => `x-${String(index)}:1`).join(';')}}`;
    const enough = `@list l9:level3 {${Array.from({ length: 63 }, (_, index) => `x-${String(index)}:1`).join(';')};mso-level-text:o}`;
    const rules = readOfficeListRules([long + many + enough], new Set(['l9:level1', 'l9:level2', 'l9:level3']));
    expect(resolveOfficeLevel(rules, '9', 1)).toBeNull();
    expect(resolveOfficeLevel(rules, '9', 2)).toBeNull();
    expect(resolveOfficeLevel(rules, '9', 3)).toEqual({ format: 'decimal', text: 'o', legal: false });
  });

  it('never reads list rules from strings, comments or nested blocks', () => {
    const style = 'p.x {content:"@list l0:level1 {mso-level-text:x}"}'
      + '/* @list l0:level2 {mso-level-text:x} */'
      + "@media print { @list l0:level3 {mso-level-text:x} }"
      + "p.y {content:'}' } @list l0:level4 {mso-level-text:y}";
    const rules = readOfficeListRules([style], new Set(['l0:level1', 'l0:level2', 'l0:level3', 'l0:level4']));
    expect([...rules.keys()]).toEqual(['l0:level4']);
    expect(resolveOfficeLevel(rules, '0', 4)?.text).toBe('y');
  });

  it('stops scanning a style element at unterminated syntax and keeps earlier definitions', () => {
    const before = '@list l1:level1 {mso-level-number-format:alpha-lower}';
    const after = '@list l1:level2 {mso-level-number-format:alpha-lower}';
    const keys = new Set(['l1:level1', 'l1:level2']);
    for (const broken of ['/* open', 'p {color:red', 'p {content:"open}', '@charset "open']) {
      const rules = readOfficeListRules([before + broken + after], keys);
      expect(resolveOfficeLevel(rules, '1', 1)?.format).toBe('alpha-lower');
      expect(resolveOfficeLevel(rules, '1', 2)).toBeUndefined();
    }
    const separate = readOfficeListRules(['p {color:red', after], keys);
    expect(resolveOfficeLevel(separate, '1', 2)?.format).toBe('alpha-lower');
  });

  it('skips statements, stray braces and CDO markers without reading them as rules', () => {
    const style = '@import "x.css"; } <!-- @LIST L2:LEVEL1 LFO3 {MSO-LEVEL-NUMBER-FORMAT:ALPHA-LOWER} -->'
      + '@list l2:level1 {mso-level-number-format:alpha-lower}';
    const rules = readOfficeListRules([style], new Set(['l2:level1', 'l2:level1 lfo3']));
    expect(resolveOfficeLevel(rules, '2', 1, '3')).toEqual({ format: 'alpha-lower', legal: false });
  });

  it('builds level keys in the same form the reader records', () => {
    expect(officeLevelKey('0', 1)).toBe('l0:level1');
    expect(officeLevelKey('12', 9, '3')).toBe('l12:level9 lfo3');
  });
});

describe('declared marker run fonts', () => {
  it.each([
    ['font-family:Symbol;mso-fareast-font-family:Symbol', 'symbol'],
    ['mso-bidi-font-family:Calibri;font-family:"Courier New";color:red', 'courier new'],
    ["font-family:'Wingdings', serif", 'wingdings'],
    ['font-family:  Times   New Roman , serif', 'times new roman'],
    ['font-family:Symbol;font-family:Symbol', 'symbol'],
    ['font-family:/* gap */Symbol;--x:[a;b]', 'symbol'],
  ])('reads the first family of %s', (style, family) => {
    expect(declaredFont(style)).toBe(family);
  });

  it.each([
    ['color:red', undefined],
    [undefined, undefined],
    ['font-family:Symbol;font-family:Arial', null],
    ['font:7.0pt "Times New Roman"', null],
    ['font-family:"unterminated', null],
    ['font-family:\\53ymbol', null],
    ['font-family:Symbol/* open', null],
    ['font-family:Symbol)', null],
    ['font-family:Symbol\\', null],
    [`font-family:Arial;${'x:1;'.repeat(130)}`, null],
  ])('does not claim a family for %s', (style, expected) => {
    expect(declaredFont(style)).toBe(expected);
  });
});
