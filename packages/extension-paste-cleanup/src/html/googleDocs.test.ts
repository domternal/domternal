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

describe('Google Docs empty paragraphs', () => {
  it('reads each line break Docs writes between blocks as the empty paragraph it stands for', () => {
    // Two empty paragraphs between GB21 and GB22: Docs writes two breaks, which the editor would make one paragraph of two lines.
    const html = docs(paragraph('GB21 Paragraph with a first-line indent.') + '<br /><br />' + paragraph('GB22 After two empty paragraphs.'));
    const result = normalizePasteHTML(html);
    expect(warnings(result)).toEqual([]);
    expect(result.html.replace(/<span[^>]*>|<\/span>/gu, '')).toBe('<p dir="ltr">GB21 Paragraph with a first-line indent.</p><p></p><p></p><p dir="ltr">GB22 After two empty paragraphs.</p><br>');
  });

  it('reads the empty paragraph Docs keeps before a table, between lists and at the end of a copy the same way', () => {
    const list = (tag: string, marker: string, text: string): string => `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">`
      + `<li dir="ltr" style="list-style-type:${marker};${RUN}" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${run(text)}</p></li></${tag}>`;
    const html = docs(`<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;">${run('GT01 Table')}</h1><br />`
      + table(cell(paragraph('GT02 Column A', '1.2'))) + list('ol', 'decimal', 'GL21 Second number') + '<br />' + list('ul', 'disc', 'GL22 Bullet') + '<br />');
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(warnings(result)).toEqual([]);
    // The blocks of the copy in order, each table and list as its tag: Chrome's break after the wrapper stays a break.
    const outline = result.html.replace(/<(table|ol|ul)\b[^>]*>[\s\S]*?<\/\1>/gu, '<$1>').replace(/<\/?span[^>]*>| dir="ltr"/gu, '');
    expect(outline).toBe('<h1>GT01 Table</h1><p></p><div><table></div><ol><p></p><ul><p></p><br>');
  });

  it('keeps a line break inside a paragraph, beside inline content and after the copy, and another source\'s break between blocks', () => {
    const inside = normalizePasteHTML(docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GB40 First line<br />second line')}</p>`
      + `${run('GB41 Partial')}<br />${run('paragraph')}`)).html;
    expect(inside.match(/<br>/gu)).toHaveLength(3);
    expect(inside).not.toContain('<p></p>');
    // Chrome's break after the wrapper is no paragraph of Docs: the editor's parse ignores it.
    expect(normalizePasteHTML(docs(paragraph('GB04 A'))).html.endsWith('</p></span><br>')).toBe(true);
    expect(normalizePasteHTML('<p>Web</p><br><br><p>Page</p>').html).toBe('<p>Web</p><br><br><p>Page</p>');
  });
});

describe('Google Docs image paragraphs', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const image = (alt: string): string => `<img alt="${alt}" src="${PNG}" width="320" height="200" style="border:none;" />`;
  const imageParagraph = (alt: string, extra = ''): string =>
    `<p dir="ltr" style="line-height:1.38;${extra}margin-top:0pt;margin-bottom:0pt;"><span style="${RUN}">${image(alt)}</span></p>`;
  const outline = (html: string): string => html.replace(/<\/?span[^>]*>| dir="ltr"/gu, '').replace(/<img[^>]*alt="([^"]*)"[^>]*>/gu, '[$1]');

  it('writes a paragraph that holds only an image as a division, so a block image closes no empty paragraph before it', () => {
    // Docs places an in line image in a paragraph of its own; an editor whose images are blocks closed that paragraph empty.
    const html = docs(paragraph('GI02 Text before the picture.') + imageParagraph('GI03 Blue rectangle') + paragraph('GI04 Text after the picture.')
      + table(cell(paragraph('GI11 Left cell', '1.2') + imageParagraph('GI12 Red picture in a cell').replace('line-height:1.38', 'line-height:1.2'))));
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(warnings(result)).toEqual([]);
      // The table's own wrappers and the cell's attributes aside.
      expect(outline(result.html).replace(/<(table|td)\b[^>]*>/gu, '<$1>').replace(/<\/?(?:tbody|tr|colgroup|col)\b[^>]*>|<div>(?=<table)|(?<=<\/table>)<\/div>/gu, ''))
        .toBe('<p>GI02 Text before the picture.</p><div>[GI03 Blue rectangle]</div><p>GI04 Text after the picture.</p>'
          + '<table><td><p>GI11 Left cell</p><div>[GI12 Red picture in a cell]</div></td></table><br>');
    }
  });

  it('leaves the alt text it stands in for a removed image in that division, where the editor opens a paragraph for it', () => {
    const result = normalizePasteHTML(docs(imageParagraph('GI03 Blue rectangle')), { allowDataImages: false });
    expect(warnings(result)).toEqual(['image-removed']);
    expect(outline(result.html)).toBe('<div>GI03 Blue rectangle</div><br>');
  });

  it('keeps a paragraph that holds text beside its image, an aligned image paragraph, and another source\'s image paragraph', () => {
    const mixed = docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GI30 Text ')}<span style="${RUN}">${image('GI31 Picture')}</span></p>`);
    expect(outline(normalizePasteHTML(mixed).html)).toBe('<p>GI30 Text [GI31 Picture]</p><br>');
    // Docs aligns an image by its paragraph, which a destination with in line images keeps.
    expect(outline(normalizePasteHTML(docs(imageParagraph('GI32 Picture', 'text-align: center;'))).html)).toBe('<p style="text-align:center">[GI32 Picture]</p><br>');
    expect(outline(normalizePasteHTML(`<p>${image('Web')}</p>`).html)).toBe('<p>[Web]</p>');
  });
});

describe('Google Docs list levels of a partial selection', () => {
  const item = (marker: string, level: number, text: string, indent = level > 1): string =>
    `<li dir="ltr" style="list-style-type:${marker};${RUN.replace('white-space:pre-wrap;', '')}${indent ? 'margin-left: 36pt;' : ''}" aria-level="${String(level)}">`
    + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${run(text)}</p></li>`;
  const list = (tag: string, ...content: string[]): string => `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${content.join('')}</${tag}>`;
  /** Each list with its marker and items, an item as its text and the lists it holds, from the cleaned HTML. */
  const shape = (html: string): string => html.replace(/<span[^>]*>|<\/span>| dir="ltr"| style="(?!list-style-type)[^"]*"/gu, '')
    .replace(/<p><\/p>/gu, '·').replace(/<\/?p>/gu, '').replace(/ style="list-style-type:([a-z-]+)"/gu, '[$1]');

  it('nests a selection that starts below the first level as deep as Docs shows it, the levels above opening with one empty item', () => {
    // From inside GL08 to inside GL11: the copy's top list is Docs' second level, its nested list the third, each item indented 36 pt.
    const html = docs(list('ol', item('lower-alpha', 2, '&nbsp;a'), list('ol', item('lower-roman', 3, 'GL09 Roman i'), item('lower-roman', 3, 'GL10 Roman ii')),
      item('lower-alpha', 2, 'GL11 Letter')));
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(warnings(result)).toEqual([]);
      // Google Docs nests a list directly in its parent list, after the item it belongs to, which the editor's parse moves into that item.
      expect(shape(result.html)).toBe('<ol><li>·<ol[lower-alpha]><li>\u00a0a</li><ol[lower-roman]><li>GL09 Roman i</li><li>GL10 Roman ii</li></ol><li>GL11 Letter</li></ol></li></ol><br>');
    }
    // One item of the second level, triple-clicked.
    expect(shape(normalizePasteHTML(docs(list('ul', item('circle', 2, 'GL03 Second level')))).html)).toBe('<ul><li>·<ul[circle]><li>GL03 Second level</li></ul></li></ul><br>');
    // An item of the third level stands two levels below the copy, with twice the indent.
    expect(shape(normalizePasteHTML(docs(list('ol', item('lower-roman', 3, 'GL09 Roman i').replace('36pt', '72pt')))).html))
      .toBe('<ol><li>·<ol><li>·<ol[lower-roman]><li>GL09 Roman i</li></ol></li></ol></li></ol><br>');
  });

  it('leaves a list whose items stand at their own depth, or at different offsets or indents, as written', () => {
    const full = normalizePasteHTML(docs(list('ul', item('disc', 1, 'GL02 First level'), list('ul', item('circle', 2, 'GL03 Second level', false)))));
    expect(warnings(full)).toEqual([]);
    expect(shape(full.html)).toBe('<ul[disc]><li>GL02 First level</li><ul[circle]><li>GL03 Second level</li></ul></ul><br>');
    // Items whose levels disagree with the copy's nesting, and an indent that is not the levels' own, keep their report.
    for (const html of [docs(list('ol', item('lower-alpha', 2, 'GL08 a'), item('decimal', 1, 'GL12 Second number', true))),
      docs(list('ul', item('circle', 2, 'GL03 Second level').replace('36pt', '20pt')))]) {
      expect([...new Set(warnings(normalizePasteHTML(html)))]).toEqual(['unsupported-formatting']);
    }
  });
});
