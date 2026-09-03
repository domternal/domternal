// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import type { PasteDiagnostic } from './types.js';

const codes = (diagnostics: readonly PasteDiagnostic[]): string[] => diagnostics.map(diagnostic => `${diagnostic.code}:${diagnostic.severity}`);

// Authored approximation of the Word desktop clipboard head, not a native capture.
const wordHead = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">'
  + '<head><meta http-equiv=Content-Type content="text/html; charset=utf-8"><meta name=ProgId content=Word.Document>'
  + '<meta name=Generator content="Microsoft Word 15"><link rel=File-List href="file:///Users/x/clip_filelist.xml">'
  + '<title>Document</title><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/></o:OfficeDocumentSettings></xml><![endif]-->'
  + '<style><!-- p.MsoNormal {margin:0cm; font-size:12.0pt;} @page WordSection1 {size:595.3pt 841.9pt;} --></style></head>'
  + '<body lang=HR><!--StartFragment--><div class=WordSection1>';
const wordTail = '</div><!--EndFragment--></body></html>';

describe('routine clipboard envelope', () => {
  it.each([
    ['a Chrome charset prefix', "<meta charset='utf-8'><p>Plain</p>", '<p>Plain</p>'],
    ['Word generator metadata', '<meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15"><p>Plain</p>', '<p>Plain</p>'],
    ['a Word file list link', '<link rel=File-List href="file:///C:/x/clip_filelist.xml"><p>Plain</p>', '<p>Plain</p>'],
    ['a document title', '<title>Document</title><p>Plain</p>', '<p>Plain</p>'],
    ['a pasted base element', '<base href="https://example.test/"><p>Plain</p>', '<p>Plain</p>'],
    ['a clipboard stylesheet', '<style><!-- p.MsoNormal {margin:0cm} --></style><p class=MsoNormal>Plain</p>', '<p>Plain</p>'],
    ['a Word head and body envelope', `${wordHead}<p class=MsoNormal>Plain</p>${wordTail}`, '<div><p>Plain</p></div>'],
  ])('removes %s without a diagnostic', (_name, html, expected) => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(result.status).toBe('cleaned');
      expect(result.html).toBe(expected);
      expect(codes(result.diagnostics)).toEqual([]);
      expect(result.diagnosticsTruncated).toBe(false);
    }
  });

  it('removes a raw Office XML island with its content instead of leaking its text', () => {
    const result = normalizePasteHTML('<xml><w:WordDocument><w:View>Normal</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><p>Plain</p>');
    expect(result.html).toBe('<p>Plain</p>');
    expect(codes(result.diagnostics)).toEqual([]);
  });

  it.each([
    ['an empty paragraph mark', '<p class=MsoNormal>Text<o:p></o:p></p>', '<p>Text</p>'],
    ['a paragraph mark holding a space', '<p class=MsoNormal><o:p>&nbsp;</o:p></p>', '<p>\u00a0</p>'],
    ['smart tags', '<p><st1:place w:st="on"><st1:City w:st="on">Zagreb</st1:City></st1:place> i okolica</p>', '<p>Zagreb i okolica</p>'],
    ['a content control', '<w:Sdt ShowingPlcHdr="t" DocPart="x" ID="1"><p>Field value</p></w:Sdt>', '<p>Field value</p>'],
  ])('unwraps %s and keeps its content without a diagnostic', (_name, html, expected) => {
    const result = normalizePasteHTML(html);
    expect(result.html).toBe(expected);
    expect(codes(result.diagnostics)).toEqual([]);
  });

  it.each([
    ['script', '<script>alert(1)</script><p>Safe</p>'],
    ['iframe', '<iframe src="https://example.test"></iframe><p>Safe</p>'],
    ['object', '<object data="https://example.test/object"></object><p>Safe</p>'],
    ['template', '<template><p>Hidden</p></template><p>Safe</p>'],
    ['noscript', '<noscript><p>Fallback</p></noscript><p>Safe</p>'],
    ['textarea', '<textarea>Input</textarea><p>Safe</p>'],
    ['button', '<button>Press</button><p>Safe</p>'],
    ['svg', '<svg><text>Drawing</text></svg><p>Safe</p>'],
    ['math', '<math><mi>x</mi></math><p>Safe</p>'],
  ])('still reports removed %s content as unsafe', (_name, html) => {
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<p>Safe</p>');
    expect(codes(result.diagnostics)).toEqual(['unsafe-content-removed:warning']);
  });

  it.each([
    ['VML shapes', '<p><v:shape id="Picture 1"><v:imagedata src="file:///x.png"></v:imagedata></v:shape>Text</p>'],
    ['Office math', '<p><m:oMath><m:r>x</m:r></m:oMath> Text</p>'],
    ['font elements', '<p><font face="Arial" color="red">Text</font></p>'],
    ['unknown elements', '<p><custom-widget>Text</custom-widget></p>'],
  ])('keeps reporting %s as unsupported formatting', (_name, html) => {
    const result = normalizePasteHTML(html);
    expect(result.status).toBe('cleaned');
    expect(result.html).toContain('Text');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('unsupported-formatting');
    expect(result.diagnostics.every(diagnostic => diagnostic.severity === 'warning')).toBe(true);
  });

  it('does not let envelope elements hide other losses in the same fragment', () => {
    const result = normalizePasteHTML("<meta charset='utf-8'><style>p{}</style><p>Text<img src=\"file:///x.png\" alt=\"Chart\"></p><script>alert(1)</script>");
    expect(result.html).toBe('<p>TextChart</p>');
    expect(codes(result.diagnostics)).toEqual(['image-removed:warning', 'unsafe-content-removed:warning']);
  });
});
