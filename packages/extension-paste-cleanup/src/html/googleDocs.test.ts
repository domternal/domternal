// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './types.js';
import type { PasteDestinationFeature } from './destinationDemand.js';

/*
 * The shapes Google Docs web writes to the clipboard, from the owner's native captures in Google Chrome on macOS of
 * 2026-10-05 (e2e/native-office-capture/fixtures/gdocs-*-chrome): one bold wrapper of normal weight whose id names
 * the copy, every run a span with its whole typography, block spacing as a CSS line height, and Chrome's own break
 * after the copy. These English text variants retain those recorded shapes and are not new native captures.
 */
const RUN = 'font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;'
  + 'font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;';
const run = (text: string, style = RUN): string => `<span style="${style}">${text}</span>`;
const paragraph = (text: string, spacing = '1.38', extra = ''): string =>
  `<p dir="ltr" style="line-height:${spacing};${extra}margin-top:0pt;margin-bottom:0pt;">${run(text)}</p>`;
const docs = (content: string): string =>
  `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-8bbc85bd-7fff-c6dc-7178-040c7fffecf3">${content}</b><br class="Apple-interchange-newline">`;
const cell = (content: string, extra = ''): string =>
  `<td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;vertical-align:top;${extra}padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;">${content}</td>`;
const table = (cells: string): string =>
  `<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;table-layout:fixed;width:468pt"><colgroup><col /></colgroup><tbody><tr style="height:0pt">${cells}</tr></tbody></table></div>`;
const warnings = (result: { diagnostics: readonly { severity: string; code: string }[] }): string[] =>
  result.diagnostics.filter(diagnostic => diagnostic.severity !== 'info').map(diagnostic => diagnostic.code);
/** The cleanup the editor runs, with a destination that lacks the given features, as one without LineHeight lacks line-height. */
const pasted = (html: string, missing: readonly PasteDestinationFeature[], options: NormalizePasteHTMLOptions = {}): NormalizePasteHTMLResult =>
  normalizeClipboardHTML(html, options, undefined, undefined, features => features.filter(feature => missing.includes(feature))).result;
const lineHeights = (html: string): string[] => [...html.matchAll(/line-height:([^;"]+)/gu)].map(match => match[1] ?? '');

describe('Google Docs line spacing', () => {
  it('reads the Docs spacing the line height stands for, 1.2 times it, and drops the defaults of text and table cells', () => {
    // Normal text 1.15 is written 1.38 on every paragraph, heading and list item; single, a table cell's default, 1.2.
    const html = docs(`<h3 dir="ltr" style="line-height:1.38;margin-top:16pt;margin-bottom:4pt;">${run('GB15 Alignment and spacing')}</h3>`
      + paragraph('GB16 Centered paragraph.', '1.38', 'text-align: center;') + paragraph('GB19 Paragraph with 1.5 line spacing.', '1.7999999999999998')
      + `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;${RUN}" aria-level="1">`
      + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${run('GL02 First level')}</p></li></ul>`
      + table(cell(paragraph('GT06 Plain cell', '1.2'))));
    const preserve = normalizePasteHTML(html);
    expect(warnings(preserve)).toEqual([]);
    // Only GB19's 1.5 is the paragraph's own, the ratio LineHeight renders.
    expect(lineHeights(preserve.html)).toEqual(['1.5']);
    const adapt = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(warnings(adapt)).toEqual([]);
    expect(lineHeights(adapt.html)).toEqual([]);
  });

  it('keeps a spacing other than the default of its place, outside and inside a table', () => {
    const html = docs(paragraph('GB30 Single line spacing.', '1.2') + paragraph('GB31 Double line spacing.', '2.4') + paragraph('GB32 Line spacing 1.25.', '1.5')
      + table(cell(paragraph('GT30 Cell with 1.15 line spacing.', '1.38'))));
    expect(lineHeights(normalizePasteHTML(html).html)).toEqual(['1', '2', '1.25', '1.15']);
  });

  it('leaves the notice to real spacing in a destination without LineHeight', () => {
    // The routine envelope is quiet; GB19's 1.5 is a loss there.
    const routine = docs(`<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;">${run('GB01 Paste test document')}</h1>`
      + paragraph('GB04 Plain paragraph without formatting.'));
    expect(warnings(pasted(routine, ['line-height']))).toEqual([]);
    expect(warnings(pasted(docs(paragraph('GB19 Paragraph with 1.5 line spacing.', '1.7999999999999998')), ['line-height']))).toEqual(['destination-formatting-unconfirmed']);
  });

  it('reads another source\'s line height as written', () => {
    const result = normalizePasteHTML('<p style="line-height:1.38">Web</p><table><tbody><tr><td><p style="line-height:1.2">Cell</p></td></tr></tbody></table>');
    expect(lineHeights(result.html)).toEqual(['1.38', '1.2']);
  });
});

describe('Google Docs default text color', () => {
  const colors = (html: string): string[] => [...html.matchAll(/(?<![-\w])color:([^;"]+)/gu)].map(match => match[1] ?? '');

  it('reads the black Docs writes on every run as the default text color, which no run keeps', () => {
    // The export names no run color: black is Docs' default, which the copy spells out on every run and list item.
    const html = docs(paragraph('GB04 Plain paragraph without formatting.')
      + `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;${RUN}" aria-level="1">`
      + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${run('GL02 First level')}</p></li></ul>`
      + `<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;table-layout:fixed;width:468pt"><thead><tr style="height:0pt">`
      + `<th style="vertical-align:top;padding:5pt 5pt 5pt 5pt;" scope="col">${paragraph('GT02 Column A', '1.2')}</th></tr></thead><tbody><tr style="height:0pt">`
      + cell(paragraph('GT05 Gray cell', '1.2'), 'background-color:#efefef;') + '</tr></tbody></table></div>');
    const result = normalizePasteHTML(html);
    expect(warnings(result)).toEqual([]);
    expect(colors(result.html)).toEqual([]);
    // The typography the runs carry stays, and so does the cell's shading.
    expect(result.html.match(/font-family:Arial,sans-serif;font-size:11pt/gu)).toHaveLength(4);
    expect(result.html).toContain('background-color:#efefef');
  });

  it('keeps every other color: a heading style\'s gray, an applied red, the link blue and a highlight', () => {
    const html = docs(`<h3 dir="ltr" style="line-height:1.38;margin-top:16pt;margin-bottom:4pt;">${run('GB03 Level three heading', RUN.replace('font-size:11pt', 'font-size:13.999999999999998pt').replace('#000000', '#434343'))}</h3>`
      + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GB10 ')}${run('red', RUN.replace('#000000', '#ff0000'))}`
      + run('highlighted', RUN.replace('background-color:transparent', 'background-color:#ffff00'))
      + `<a href="https://example.com/domternal/gdocs-v1" style="text-decoration:none;">${run('an example page', RUN.replace('#000000', '#1155cc').replace('text-decoration:none', 'text-decoration:underline'))}</a></p>`);
    const result = normalizePasteHTML(html);
    expect(warnings(result)).toEqual([]);
    expect(colors(result.html)).toEqual(['#434343', '#ff0000', '#1155cc']);
    expect(result.html).toContain('background-color:#ffff00');
  });

  it('reads black in another notation the same way, and another source\'s black as its own', () => {
    expect(colors(normalizePasteHTML(docs(paragraph('GB04 A').replace('color:#000000', 'color:rgb(0, 0, 0)'))).html)).toEqual([]);
    expect(colors(normalizePasteHTML(docs(paragraph('GB04 A').replace('color:#000000', 'color:#000'))).html)).toEqual([]);
    expect(colors(normalizePasteHTML('<p><span style="color:#000000">Web</span></p>').html)).toEqual(['#000000']);
  });
});
