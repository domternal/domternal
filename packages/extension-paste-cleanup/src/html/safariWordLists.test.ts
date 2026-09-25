// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Element, Properties } from 'hast';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';
import { normalizeClipboardHTML } from './normalize.js';

/*
 * English text variants of recorded Word for Mac 16.113 to Safari 26.5 clipboard shapes, not new native captures.
 * The list level definitions and paragraph shapes come from the reviewed captures in
 * e2e/native-office-capture/fixtures (the synthetic word-mac-v1 lists document).
 */
const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"\nxmlns:w="urn:schemas-microsoft-com:office:word"\n'
  + 'xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"\nxmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head>';
const space = '<span class="Apple-converted-space">\u00a0</span>';
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
// The distinct codes, sorted: a literal Office list item also reports its own indentation and marker font.
const codes = (diagnostics: readonly PasteDiagnostic[]): string[] => [...new Set(warnings(diagnostics))].sort();
const policies = ['preserve', 'adapt'] as const;

// The level definitions and paragraphs of the captured default bullets, single item and partial selections.
const definitions = (...rules: string[]): string => `<head><style class="WebKit-mso-list-quirks-style">\n<!--\n${rules.join('\n')}\n-->\n</style></head>`;
const BULLET_LEVELS = [
  '@list l0:level1\n\t{mso-level-number-format:bullet;\n\tmso-level-reset-level:level1;\n\tmso-level-text:;\n\tmso-level-tab-stop:36.0pt;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;\n\tfont-family:Symbol;}',
  '@list l0:level2\n\t{mso-level-number-format:bullet;\n\tmso-level-text:o;\n\tmso-level-tab-stop:54.0pt;\n\tmso-level-number-position:left;\n\tmargin-left:54.0pt;\n\ttext-indent:-18.0pt;\n\tmso-ascii-font-family:"Courier New";\n\tmso-hansi-font-family:"Courier New";\n\tmso-bidi-font-family:"Courier New";}',
  '@list l0:level3\n\t{mso-level-number-format:bullet;\n\tmso-level-text:;\n\tmso-level-tab-stop:72.0pt;\n\tmso-level-number-position:left;\n\tmargin-left:72.0pt;\n\ttext-indent:-18.0pt;\n\tfont-family:Wingdings;}',
];
const NUMBER_LEVELS = [
  '@list l0:level1\n\t{mso-level-reset-level:level1;\n\tmso-level-tab-stop:36.0pt;\n\tmso-level-number-position:left;\n\ttext-indent:-18.0pt;}',
  '@list l0:level2\n\t{mso-level-number-format:alpha-lower;\n\tmso-level-tab-stop:54.0pt;\n\tmso-level-number-position:left;\n\tmargin-left:54.0pt;\n\ttext-indent:-18.0pt;}',
  '@list l0:level3\n\t{mso-level-number-format:roman-lower;\n\tmso-level-tab-stop:72.0pt;\n\tmso-level-number-position:left;\n\tmargin-left:72.0pt;\n\ttext-indent:-18.0pt;}',
];
const marker = (label: string, padding: number, run = 'mso-bidi-font-family:Aptos;mso-bidi-theme-font:minor-latin'): string =>
  `<!--[if !supportLists]--><span style="${run}"><span style="mso-list:Ignore">${label}<span style="font:7.0pt &quot;Times New Roman&quot;">`
  + `${'\u00a0'.repeat(padding)}${space}</span></span></span><!--[endif]-->`;
const listParagraph = (kind: string, level: number, label: string, text: string, run?: string): string =>
  `<p class="MsoListParagraph${kind}" style="margin-left:${String(18 + level * 18)}.0pt;mso-add-space:\nauto;text-indent:-18.0pt;mso-list:l0 level${String(level)} lfo1;`
  + `tab-stops:list ${String(18 + level * 18)}.0pt">${marker(label, 2, run)}${text}<o:p></o:p></p>`;
const COURIER = 'font-family:&quot;Courier New&quot;;mso-fareast-font-family:&quot;Courier New&quot;';

describe('Safari copies of Word lists', () => {
  it.each(policies)('reads a level font Word names per script, as its default o bullet, in %s', formatting => {
    const html = `${WORD}${definitions(...BULLET_LEVELS)}${listParagraph('CxSpFirst', 1, '·', 'L02 First level', 'font-family:Symbol;\nmso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol')}`
      + `${listParagraph('CxSpMiddle', 2, 'o', 'L03 Second level', COURIER)}${listParagraph('CxSpLast', 3, '§', 'L04 Third level', 'font-family:Wingdings;mso-fareast-font-family:Wingdings;mso-bidi-font-family:\nWingdings')}</html>`;
    const result = normalizePasteHTML(html, { formatting });
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).toBe('<ul style="list-style-type:disc"><li><p><span></span>L02 First level</p><ul style="list-style-type:circle"><li><p><span></span>L03 Second level</p>'
      + '<ul style="list-style-type:square"><li><p><span></span>L04 Third level</p></li></ul></li></ul></li></ul>');
  });

  it('reads the high ANSI font for a level text outside ASCII and keeps a mismatched run font literal', () => {
    const level = (text: string): string => `@list l0:level1\n\t{mso-level-number-format:bullet;\n\tmso-level-text:${text};\n\tmso-ascii-font-family:Arial;\n\tmso-hansi-font-family:Wingdings;}`;
    const paragraph = (label: string, run: string): string => `${WORD}${definitions(level(label === '§' ? '' : 'o'))}`
      + `<p class="MsoListParagraph" style="text-indent:-18.0pt;mso-list:l0 level1 lfo1">${marker(label, 2, run)}Text<o:p></o:p></p></html>`;
    expect(normalizePasteHTML(paragraph('§', 'font-family:Wingdings')).html).toContain('<ul style="list-style-type:square">');
    // The ASCII o in Arial is not Word's circle bullet in Courier New.
    expect(codes(normalizePasteHTML(paragraph('o', 'font-family:Arial')).diagnostics)).toEqual(['office-list-unsupported', 'unsupported-formatting']);
  });

  it.each(policies)('opens the levels above a single nested item from their definitions, in %s', formatting => {
    const html = `${WORD}${definitions(...BULLET_LEVELS)}${listParagraph('', 2, 'o', 'L03 Second level', COURIER)}</html>`;
    const result = normalizePasteHTML(html, { formatting });
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).toBe('<ul style="list-style-type:disc"><li><p></p><ul style="list-style-type:circle"><li><p><span></span>L03 Second level</p></li></ul></li></ul>');
  });

  it('keeps the depth, markers and ordinals of a selection that starts in a nested item', () => {
    const html = `${WORD}${definitions(...NUMBER_LEVELS)}`
      + `${listParagraph('CxSpFirst', 2, 'a.', `<span>\u00a0</span>a`)}${listParagraph('CxSpMiddle', 3, 'i.', 'L09 Roman i')}${listParagraph('CxSpMiddle', 3, 'ii.', 'L10 Roman ii')}`
      + `${listParagraph('CxSpMiddle', 2, 'b.', 'L11 Letter b')}${listParagraph('CxSpLast', 1, '4.', 'L12 Second number')}</html>`;
    const result = normalizePasteHTML(html);
    expect(warnings(result.diagnostics)).toEqual([]);
    // The first level starts one before the number of its next item, which then continues it.
    expect(result.html).toBe('<ol style="list-style-type:decimal" start="3"><li><p></p><ol style="list-style-type:lower-alpha" start="1"><li><p><span></span><span>\u00a0</span>a</p>'
      + '<ol style="list-style-type:lower-roman" start="1"><li><p><span></span>L09 Roman i</p></li><li><p><span></span>L10 Roman ii</p></li></ol></li>'
      + '<li><p><span></span>L11 Letter b</p></li></ol></li><li><p><span></span>L12 Second number</p></li></ol>');
  });

  it.each(policies)('keeps an item that skips a level after the run started literal with its marker, as Word shows it, in %s', formatting => {
    // L08 is gone: Word shows 1. L07, then i. and ii. one level further in, then a. L11 and 2. L12. No item is empty.
    const html = `${WORD}${definitions(...NUMBER_LEVELS)}${listParagraph('CxSpFirst', 1, '1.', 'L07 First number')}`
      + `${listParagraph('CxSpMiddle', 3, 'i.', 'L09 Roman i')}${listParagraph('CxSpMiddle', 3, 'ii.', 'L10 Roman ii')}`
      + `${listParagraph('CxSpMiddle', 2, 'a.', 'L11 Letter b')}${listParagraph('CxSpLast', 1, '2.', 'L12 Second number')}</html>`;
    const result = normalizePasteHTML(html, { formatting });
    expect(codes(result.diagnostics)).toEqual(['office-list-unsupported', 'unsupported-formatting']);
    expect(result.html).not.toContain('<li><p></p>');
    expect(result.html).toMatch(/^<ol style="list-style-type:decimal" start="1"><li><p><span><\/span>L07 First number<\/p><p>.*i\..*L09 Roman i<\/p><p>.*ii\..*L10 Roman ii<\/p>/u);
    expect(result.html).toContain('<ol style="list-style-type:lower-alpha" start="1"><li><p><span></span>L11 Letter b</p></li></ol></li><li><p><span></span>L12 Second number</p></li></ol>');
  });

  it('keeps an item literal when a level above it has no supported definition', () => {
    const legal = '@list l0:level1\n\t{mso-level-legal-format:yes;\n\tmso-level-text:"%1\\.";}';
    const html = `${WORD}${definitions(legal, NUMBER_LEVELS[1] ?? '')}${listParagraph('', 2, 'a.', 'L08 Letter a')}</html>`;
    const result = normalizePasteHTML(html);
    expect(codes(result.diagnostics)).toEqual(['office-list-unsupported', 'unsupported-formatting']);
    expect(result.html).not.toContain('<ol');
    // Without any definition, a nested run stays as written, as before.
    expect(normalizePasteHTML(`${WORD}${listParagraph('', 2, '1.', 'Text')}</html>`).html).not.toContain('<ol');
  });
});

describe('Safari copies of Word picture bullets', () => {
  const PICTURE = '@list l4:level1\n\t{mso-level-number-format:image;\n\tmso-level-text:;\n\tfont-family:Symbol;}';
  const item = '<p class="MsoListParagraphCxSpMiddle" style="text-indent:-18.0pt;mso-list:l4 level1 lfo5;\ntab-stops:list 36.0pt"><!--[if !supportLists]-->'
    + '<span style="font-family:Symbol;\nmso-fareast-font-family:Symbol;mso-bidi-font-family:Symbol"><span style="mso-list:Ignore">'
    + '<img width="10" height="10" src="blob:http://127.0.0.1:5896/20115753-e53e-4ef0-bfc1-bc78d8dde26f" alt="*"><span style="font:7.0pt &quot;Times New Roman&quot;">'
    + `\u00a0\u00a0\u00a0${space}</span></span></span><!--[endif]-->L66 Picture bullet<o:p></o:p></p>`;
  const html = `${WORD}${definitions(PICTURE)}${item}</html>`;

  it.each(policies)('keeps the picture as its alt text marker of a literal item, never as an image, in %s', formatting => {
    const result = normalizePasteHTML(html, { formatting });
    expect(result.status).toBe('cleaned');
    expect(codes(result.diagnostics)).toEqual(['office-list-unsupported', 'unsupported-formatting']);
    expect(result.html).not.toContain('<img');
    expect(result.html).toMatch(/^<p>.*\*.*L66 Picture bullet<\/p>$/u);
  });

  it('never offers a marker picture to clipboard image preparation, which would refuse the paste', () => {
    const reserveImage = vi.fn((_node: Element, _original: Properties): string | undefined => undefined);
    const removedImage = vi.fn();
    const { result } = normalizeClipboardHTML(html, {}, undefined, { reserveImage, removedImage, retainTree: () => undefined });
    expect(result.status).toBe('cleaned');
    expect(reserveImage).not.toHaveBeenCalled();
    expect(removedImage).not.toHaveBeenCalled();
  });
});
