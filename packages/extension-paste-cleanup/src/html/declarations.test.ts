// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

// Authored approximations of Office and Google Docs clipboard declarations, not native captures.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const imageBox = (box: string, image: string): string =>
  `<p><span style="border:none;display:inline-block;overflow:hidden;${box}"><img src="${PNG}" width="200" height="100" alt="Text" style="${image}"></span></p>`;
const warnings = (diagnostics: readonly PasteDiagnostic[]): PasteDiagnostic[] => diagnostics.filter(diagnostic => diagnostic.severity !== 'info');

describe('routine source declarations', () => {
  it('drops Office private declarations, zero margins and vertical spacing from a Word paragraph without a warning', () => {
    const html = "<p class=MsoNormal style='margin-top:0cm;margin-right:0cm;margin-bottom:8.0pt;margin-left:0cm;line-height:107%;mso-pagination:widow-orphan'>"
      + "<span lang=HR style='font-size:12.0pt;font-family:\"Aptos\",sans-serif;mso-ascii-theme-font:minor-latin;mso-fareast-font-family:\"Times New Roman\";mso-ansi-language:HR'>Text</span></p>";
    const preserve = normalizePasteHTML(html);
    expect(preserve.diagnostics).toEqual([]);
    expect(preserve.html).toBe('<p style="line-height:107%"><span lang="HR"><span style="font-family:&#x22;Aptos&#x22;,sans-serif;font-size:12pt">Text</span></span></p>');
    const adapt = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(warnings(adapt.diagnostics)).toEqual([]);
    expect(adapt.html).toBe('<p><span lang="HR">Text</span></p>');
  });

  it('drops neutral Google Docs declarations without a warning', () => {
    const html = '<b style="font-weight:normal;" id="docs-internal-guid-1a2b3c"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">'
      + '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
      + 'font-variant:normal;font-variant-numeric:normal;font-variant-east-asian:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Hello</span></p></b>';
    for (const formatting of ['preserve', 'adapt'] as const) {
      expect(warnings(normalizePasteHTML(html, { formatting }).diagnostics)).toEqual([]);
    }
  });

  it('treats list indentation on semantic lists as destination layout', () => {
    const html = '<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li><p>One</p></li></ul>'
      + '<ol style="margin-left:36pt;padding-left:12pt"><li><p>Two</p></li></ol>';
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<ul><li><p>One</p></li></ul><ol><li><p>Two</p></li></ol>');
    expect(result.diagnostics).toEqual([]);
  });

  it('treats Word table borders, cell padding and table layout as destination layout', () => {
    const html = "<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;"
      + "mso-border-alt:solid windowtext .5pt;mso-yfti-tbllook:1184;mso-padding-alt:0cm 5.4pt 0cm 5.4pt;margin-left:-5.4pt'>"
      + "<tr style='mso-yfti-irow:0;height:15.0pt'><td width=301 valign=top style='width:225.4pt;border:solid windowtext 1.0pt;"
      + "mso-border-alt:solid windowtext .5pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal style='margin-bottom:0cm;line-height:normal'>Cell</p></td>"
      + "<td style='border-top:solid windowtext 1.0pt;border-left:none;border-bottom:solid windowtext 1.0pt;border-right:solid windowtext 1.0pt;padding:0cm 5.4pt'>"
      + '<p class=MsoNormal>Next</p></td></tr></table>';
    const result = normalizePasteHTML(html);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toBe('<table><tbody><tr style="height:15.0pt"><td style="width:225.4pt"><p style="line-height:normal">Cell</p></td><td><p>Next</p></td></tr></tbody></table>');
  });

  it('drops neutral values, pagination and typesetting controls without a warning', () => {
    const html = '<p style="text-indent:0cm;margin:0cm;padding:0;border:none;font-variant:normal;text-transform:none;letter-spacing:normal;'
      + 'word-spacing:0px;font-stretch:normal;font-feature-settings:normal;text-decoration-skip-ink:none;-webkit-text-decoration-skip:none;'
      + 'text-wrap-mode:wrap;background:transparent;background-image:none;text-shadow:none;page-break-before:always;break-after:page;'
      + 'orphans:2;widows:2;tab-stops:36.0pt;text-autospace:none;layout-grid-mode:char;punctuation-wrap:simple;text-justify:inter-ideograph;'
      + 'word-wrap:break-word;overflow-wrap:anywhere;word-break:break-all;line-break:strict;font-kerning:none;margin-bottom:.0001pt;mso-hide:none">Text</p>';
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<p>Text</p>');
    expect(result.diagnostics).toEqual([]);
  });

  it('resets an inherited color for the Office default text color without a warning', () => {
    const html = '<p><span style="color:red">Before <a href="https://example.test/"><span style="color:windowtext;text-decoration:none;text-underline:none">link</span></a></span></p>';
    const result = normalizePasteHTML(html);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toBe('<p><span><span style="color:red">Before </span><a href="https://example.test/"><span>link</span></a></span></p>');
  });

  it.each([
    ['nonzero left indentation', '<p style="margin-left:36pt">Text</p>'],
    ['nonzero right indentation', '<p style="margin-right:2cm">Text</p>'],
    ['horizontal margins in a shorthand', '<p style="margin:0cm 0cm 0cm 36pt">Text</p>'],
    ['horizontal padding', '<div style="padding-left:12pt"><p>Text</p></div>'],
    ['a first line indent', '<p style="text-indent:-18pt">Text</p>'],
    ['a paragraph border', '<p style="border:solid black 1pt">Text</p>'],
    ['a paragraph side border', '<p style="border-bottom:solid windowtext 1.5pt">Text</p>'],
    ['a background shorthand with an image', '<p><span style="background:url(https://example.test/x.png) yellow">Text</span></p>'],
    ['a background image', '<p style="background-image:linear-gradient(red,blue)">Text</p>'],
    ['hidden text', '<p><span style="display:none">Text</span></p>'],
    ['invisible text', '<p><span style="visibility:hidden">Text</span></p>'],
    ['Office hidden text', '<p><span style="mso-hide:all">Text</span></p>'],
    ['a font shorthand', '<p><span style=\'font:7.0pt "Times New Roman"\'>Text</span></p>'],
    ['letter spacing', '<p><span style="letter-spacing:2pt">Text</span></p>'],
    ['a case transform', '<p><span style="text-transform:uppercase">Text</span></p>'],
    ['small caps', '<p><span style="font-variant:small-caps">Text</span></p>'],
    ['positioning', '<p style="position:fixed">Text</p>'],
    ['an image box that crops its image', imageBox('width:100px;height:50px', 'margin-left:0px;margin-top:0px')],
    ['an image moved up inside its box', imageBox('width:200px;height:100px', 'margin-left:0px;margin-top:-20px')],
  ])('keeps warning about %s', (_name, html) => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.html).toContain('Text');
      expect(warnings(result.diagnostics).map(diagnostic => `${diagnostic.code}:${diagnostic.severity}`)).toEqual(['unsupported-formatting:warning']);
    }
  });

  it('never classifies inherited object keys as routine declarations', () => {
    const result = normalizePasteHTML('<p style="__proto__:none;constructor:normal;toString:0;hasOwnProperty:none">Text</p>');
    expect(result.html).toBe('<p>Text</p>');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported-formatting']);
  });

  it('strips level geometry from reconstructed Office list paragraphs without a warning', () => {
    const item = (marker: string, text: string): string => "<p class=MsoListParagraphCxSpMiddle style='margin-top:0cm;margin-right:0cm;"
      + "margin-bottom:0cm;margin-left:36.0pt;mso-add-space:auto;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]>"
      + `<span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>${text}<o:p></o:p></p>`;
    const result = normalizePasteHTML(item('1.', 'First') + item('2.', 'Second'));
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toBe('<ol style="list-style-type:decimal" start="1"><li><p>First</p></li><li><p>Second</p></li></ol>');
  });
});
