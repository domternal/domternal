// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

/*
 * English text variants of recorded Word for Mac 16.113 clipboard shapes, not new native captures. Chrome 154 and Firefox 155 carry Word's raw
 * HTML with its stylesheet, from the owner's captures of 2026-10-03 (e2e/native-office-capture/fixtures,
 * word-table-text and word-alignment-spacing). The links Word writes to its local temporary files are left out.
 */
const policies = ['preserve', 'adapt'] as const;
const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.filter(entry => entry.severity !== 'info').map(entry => entry.code);
const markup = (html: string): string => html.replace(/>[\t\n\f\r ]+</gu, '><').trim();

const HEAD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"\nxmlns:w="urn:schemas-microsoft-com:office:word"\n'
  + 'xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"\nxmlns="http://www.w3.org/TR/REC-html40">\n\n<head>\n'
  + '<meta http-equiv=Content-Type content="text/html; charset=utf-8">\n<meta name=ProgId content=Word.Document>\n'
  + '<meta name=Generator content="Microsoft Word 15">\n<meta name=Originator content="Microsoft Word 15">\n<style>\n<!--\n /* Style Definitions */\n'
  + ' p.MsoNormal, li.MsoNormal, div.MsoNormal\n\t{mso-style-unhide:no;\n\tmso-style-qformat:yes;\n\tmso-style-parent:"";\n\tmargin-top:0cm;\n'
  + '\tmargin-right:0cm;\n\tmargin-bottom:8.0pt;\n\tmargin-left:0cm;\n\tline-height:115%;\n\tmso-pagination:widow-orphan;\n\tfont-size:12.0pt;\n'
  + '\tfont-family:"Aptos",sans-serif;\n\tmso-ascii-font-family:Aptos;\n\tmso-fareast-language:EN-US;}\n-->\n</style>\n</head>\n\n'
  + "<body lang=en-HR style='tab-interval:36.0pt;word-wrap:break-word'>\n<!--StartFragment-->\n\n";
const TAIL = '\n\n<!--EndFragment-->\n</body>\n\n</html>';

/** A cell of Word's Table Grid style, which writes single spacing as line-height:normal on every cell paragraph. */
const cell = (text: string, style = 'width:150.25pt;border:solid windowtext 1.0pt;\n  mso-border-alt:solid windowtext .5pt;padding:0cm 5.4pt 0cm 5.4pt'): string =>
  `  <td width=200 valign=top style='${style}'>\n  <p class=MsoNormal style='margin-bottom:0cm;line-height:normal'>${text}<o:p></o:p></p>\n  </td>\n`;
const TABLE = `${HEAD}<h1>T01 Table<o:p></o:p></h1>\n\n<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0\n`
  + " style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt;\n mso-yfti-tbllook:1184;mso-padding-alt:0cm 5.4pt 0cm 5.4pt'>\n"
  + ` <tr style='mso-yfti-irow:0;mso-yfti-firstrow:yes'>\n${cell('T02 Column A')}${cell('T03 Column B')}${cell('T04 Column C')} </tr>\n`
  + ` <tr style='mso-yfti-irow:1;mso-yfti-lastrow:yes'>\n${cell("<span\n  style='color:black;mso-color-alt:windowtext'>T05 Gray cell</span>",
    'width:150.25pt;border:solid windowtext 1.0pt;\n  border-top:none;mso-border-top-alt:solid windowtext .5pt;mso-border-alt:solid windowtext .5pt;\n'
    + '  background:#D9D9D9;mso-background-themecolor:background1;mso-background-themeshade:\n  217;padding:0cm 5.4pt 0cm 5.4pt')}`
  + `${cell('T06 Plain\n  cell')}${cell('T07 Third\n  cell')} </tr>\n</table>\n\n<p class=MsoNormal>T10 Between tables.<o:p></o:p></p>${TAIL}`;

describe('Word table cells in Chrome and Firefox', () => {
  it.each(policies)('drop the single spacing Table Grid writes on every cell paragraph without a notice, in %s', formatting => {
    const result = normalizePasteHTML(TABLE, { formatting });
    expect(warnings(result.diagnostics)).toEqual([]);
    expect(result.html).not.toContain('line-height');
    expect(markup(result.html)).toContain('<td style="width:150.25pt"><p>T02 Column A</p></td><td style="width:150.25pt"><p>T03 Column B</p></td>'
      + '<td style="width:150.25pt"><p>T04 Column C</p></td>');
  });

  it('keeps the shading of a cell and the text color Word writes on its run', () => {
    expect(markup(normalizePasteHTML(TABLE).html)).toMatch(/<td data-background="#D9D9D9" style="[^"]*background-color:#D9D9D9"><p><span><span style="color:black">T05 Gray cell<\/span><\/span><\/p><\/td>/u);
  });
});

describe('line-height: normal', () => {
  it.each(policies)('is the initial value: it renders like no line height, so it is dropped quietly, in %s', formatting => {
    const result = normalizePasteHTML('<p style="line-height:normal">Text</p><h2 style="LINE-HEIGHT: Normal">Heading</h2>', { formatting });
    expect(result.html).toBe('<p>Text</p><h2>Heading</h2>');
    expect(warnings(result.diagnostics)).toEqual([]);
  });

  it('resets a line height an earlier declaration of the same attribute set, as CSS lets the later one win', () => {
    expect(normalizePasteHTML('<p style="line-height:2;line-height:normal">Text</p>').html).toBe('<p>Text</p>');
    expect(normalizePasteHTML('<p style="line-height:normal;line-height:2">Text</p>').html).toBe('<p style="line-height:2">Text</p>');
  });
});
