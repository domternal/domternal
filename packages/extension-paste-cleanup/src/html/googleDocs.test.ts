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
    expect(result.html.replace(/<span[^>]*>|<\/span>/gu, '')).toBe('<p dir="ltr">GB21 Paragraph with a first-line indent.</p><p></p><p></p><p dir="ltr">GB22 After two empty paragraphs.</p>');
  });

  it('reads the empty paragraph Docs keeps before a table, between lists and at the end of a copy the same way', () => {
    const list = (tag: string, marker: string, text: string): string => `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">`
      + `<li dir="ltr" style="list-style-type:${marker};${RUN}" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">${run(text)}</p></li></${tag}>`;
    const html = docs(`<h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;">${run('GT01 Table')}</h1><br />`
      + table(cell(paragraph('GT02 Column A', '1.2'))) + list('ol', 'decimal', 'GL21 Second number') + '<br />' + list('ul', 'disc', 'GL22 Bullet') + '<br />');
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(warnings(result)).toEqual([]);
    // The blocks of the copy in order, each table and list as its tag; Chrome's break after the copy goes.
    const outline = result.html.replace(/<(table|ol|ul)\b[^>]*>[\s\S]*?<\/\1>/gu, '<$1>').replace(/<\/?span[^>]*>| dir="ltr"/gu, '');
    expect(outline).toBe('<h1>GT01 Table</h1><p></p><div><table></div><ol><p></p><ul><p></p>');
  });

  it('keeps a line break inside a paragraph and beside inline content, and another source\'s break between blocks', () => {
    const inside = normalizePasteHTML(docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GB40 First line<br />second line')}</p>`
      + `${run('GB41 Partial')}<br />${run('paragraph')}`)).html;
    expect(inside.match(/<br>/gu)).toHaveLength(2);
    expect(inside).not.toContain('<p></p>');
    // Chrome's break after the copy is no paragraph of Docs: the editor's parse ignores it, and cleanup leaves it out.
    expect(normalizePasteHTML(docs(paragraph('GB04 A'))).html.endsWith('GB04 A</span></p>')).toBe(true);
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
          + '<table><td><p>GI11 Left cell</p><div>[GI12 Red picture in a cell]</div></td></table>');
    }
  });

  it('leaves the alt text it stands in for a removed image in the paragraph the image stood in', () => {
    const result = normalizePasteHTML(docs(imageParagraph('GI03 Blue rectangle')), { allowDataImages: false });
    expect(warnings(result)).toEqual(['image-removed']);
    expect(outline(result.html)).toBe('<p>GI03 Blue rectangle</p>');
  });

  it('carries the alignment of an image paragraph to its images, as Docs aligns an image, and to the alt text of a removed one', () => {
    // A paragraph centered or aligned to the end kept its paragraph, which a block image closed empty above it, and the image lost the alignment.
    const aligned = (align: string): string => docs(imageParagraph('GI32 Picture', `text-align: ${align};`)
      + table(cell(imageParagraph('GI33 Picture in a cell', `text-align: ${align};`).replace('line-height:1.38', 'line-height:1.2'))));
    const alignments = (html: string): string[] => [...html.matchAll(/<img [^>]*?data-align="([a-z]+)"/gu)].map(match => match[1] ?? '');
    const blocks = (html: string): string => outline(html).replace(/<(table|td)\b[^>]*>/gu, '<$1>')
      .replace(/<\/?(?:tbody|tr|colgroup|col)\b[^>]*>|<div>(?=<table)|(?<=<\/table>)<\/div>/gu, '');
    for (const align of ['center', 'right']) {
      const preserve = normalizePasteHTML(aligned(align));
      expect(warnings(preserve)).toEqual([]);
      expect(alignments(preserve.html)).toEqual([align, align]);
      // The division keeps the alignment too, for a reader of the HTML, where the image is in line.
      expect(blocks(preserve.html)).toBe(`<div style="text-align:${align}">[GI32 Picture]</div><table><td><div style="text-align:${align}">[GI33 Picture in a cell]</div></td></table>`);
      // Adapt removes source text alignment, the image's with its paragraph's, unless the host keeps it.
      const adapt = normalizePasteHTML(aligned(align), { formatting: 'adapt' });
      expect(warnings(adapt)).toEqual([]);
      expect(alignments(adapt.html)).toEqual([]);
      expect(blocks(adapt.html)).toBe('<div>[GI32 Picture]</div><table><td><div>[GI33 Picture in a cell]</div></td></table>');
      expect(alignments(normalizePasteHTML(aligned(align), { formatting: 'adapt', preserveTextAlignment: true }).html)).toEqual([align, align]);
      // A removed image leaves its alt text in its paragraph, aligned as the image was.
      const removed = normalizePasteHTML(aligned(align), { allowDataImages: false });
      expect(warnings(removed)).toEqual(['image-removed', 'image-removed']);
      expect(blocks(removed.html)).toBe(`<p style="text-align:${align}">GI32 Picture</p><table><td><p style="text-align:${align}">GI33 Picture in a cell</p></td></table>`);
    }
    // A paragraph aligned to the start or justified places its image where an unaligned one does.
    for (const align of ['left', 'justify']) expect(alignments(normalizePasteHTML(aligned(align)).html)).toEqual([]);
  });

  it('keeps a paragraph that holds text beside its image, and another source\'s image paragraph', () => {
    const mixed = docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GI30 Text ')}<span style="${RUN}">${image('GI31 Picture')}</span></p>`);
    // The space ending its text run needs the white space Docs writes on every run, which the paragraph holds for them.
    expect(outline(normalizePasteHTML(mixed).html)).toBe('<p style="white-space:pre-wrap">GI30 Text [GI31 Picture]</p>');
    expect(outline(normalizePasteHTML(`<p>${image('Web')}</p>`).html)).toBe('<p>[Web]</p>');
    expect(outline(normalizePasteHTML(`<p style="text-align:center">${image('Web')}</p>`).html)).toBe('<p style="text-align:center">[Web]</p>');
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
      expect(shape(result.html)).toBe('<ol><li>·<ol[lower-alpha]><li>\u00a0a</li><ol[lower-roman]><li>GL09 Roman i</li><li>GL10 Roman ii</li></ol><li>GL11 Letter</li></ol></li></ol>');
    }
    // One item of the second level, triple-clicked.
    expect(shape(normalizePasteHTML(docs(list('ul', item('circle', 2, 'GL03 Second level')))).html)).toBe('<ul><li>·<ul[circle]><li>GL03 Second level</li></ul></li></ul>');
    // An item of the third level stands two levels below the copy, with twice the indent.
    expect(shape(normalizePasteHTML(docs(list('ol', item('lower-roman', 3, 'GL09 Roman i').replace('36pt', '72pt')))).html))
      .toBe('<ol><li>·<ol><li>·<ol[lower-roman]><li>GL09 Roman i</li></ol></li></ol></li></ol>');
  });

  it('leaves a list whose items stand at their own depth, or at different offsets or indents, as written', () => {
    const full = normalizePasteHTML(docs(list('ul', item('disc', 1, 'GL02 First level'), list('ul', item('circle', 2, 'GL03 Second level', false)))));
    expect(warnings(full)).toEqual([]);
    expect(shape(full.html)).toBe('<ul[disc]><li>GL02 First level</li><ul[circle]><li>GL03 Second level</li></ul></ul>');
    // Items whose levels disagree with the copy's nesting, and an indent that is not the levels' own, keep their report.
    for (const html of [docs(list('ol', item('lower-alpha', 2, 'GL08 a'), item('decimal', 1, 'GL12 Second number', true))),
      docs(list('ul', item('circle', 2, 'GL03 Second level').replace('36pt', '20pt')))]) {
      expect([...new Set(warnings(normalizePasteHTML(html)))]).toEqual(['unsupported-formatting']);
    }
  });
});

describe('Google Docs checklists', () => {
  const BOX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const STRUCK = RUN.replace('text-decoration:none;', 'text-decoration:line-through;-webkit-text-decoration-skip:none;text-decoration-skip-ink:none;');
  const task = (checked: boolean, text: string): string => `<li dir="ltr" role="checkbox" aria-checked="${String(checked)}" style="list-style-type:none;`
    + `${(checked ? STRUCK : RUN).replace('white-space:pre-wrap;', '')}" aria-level="1"><img src="${BOX}" width="17.599999999999998px" height="17.599999999999998px" `
    + `alt="${checked ? 'checked' : 'unchecked'}" aria-roledescription="checkbox" style="margin-right:3px;" /><p dir="ltr" style="line-height:1.38;margin-top:0pt;`
    + `margin-bottom:0pt;display:inline-block;vertical-align:top;margin-top:0;" role="presentation">${run(text, checked ? STRUCK : RUN)}</p></li>`;
  const checklist = (...items: string[]): string => `<ul style="margin-top:0;margin-bottom:0;padding-inline-start:28px;">${items.join('')}</ul>`;
  const outline = (html: string): string => html.replace(/<span[^>]*>|<\/span>| dir="ltr"| style="[^"]*"/gu, '');

  it('pastes a checklist as a task list, each item checked as Docs shows it, without the pictures Docs draws its boxes with', () => {
    const html = docs(checklist(task(false, 'GL62 Unchecked task'), task(true, 'GL63 Checked task')));
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(warnings(result)).toEqual([]);
      // The strikethrough Docs draws a checked item with is the checked state, which the task item holds: kept, it stayed when the item was unchecked.
      expect(outline(result.html)).toBe('<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>GL62 Unchecked task</p></li>'
        + '<li data-type="taskItem" data-checked="true"><p>GL63 Checked task</p></li></ul>');
    }
    // No picture is left for image preparation or a destination to receive.
    expect(normalizePasteHTML(html).html).not.toContain('<img');
  });

  it('keeps a strikethrough that is not how Docs draws a checked item: on part of its text, on an unchecked item, or where the destination has no task lists', () => {
    const struck = (html: string): string[] => [...html.matchAll(/<s>([^<]*)<\/s>/gu)].map(match => match[1] ?? '');
    // A checked item with one run struck and one not: Docs struck the whole text, so the author changed it, and the copy
    // keeps what it draws, the item's line over both runs.
    const partial = task(true, 'GL63 Checked').replace('</span></p></li>', `</span>${run(' task')}</p></li>`);
    expect(struck(normalizePasteHTML(docs(checklist(partial))).html)).toEqual(['GL63 Checked', ' task']);
    // An unchecked item the author struck through.
    const unchecked = task(false, 'GL62 Strikethrough').replace(/text-decoration:none;/gu, 'text-decoration:line-through;');
    expect(struck(normalizePasteHTML(docs(checklist(unchecked))).html)).toEqual(['GL62 Strikethrough']);
    // An editor without task lists pastes bullets, which lose the checked state: the strikethrough is what is left of it.
    const html = docs(checklist(task(false, 'GL62 Unchecked task'), task(true, 'GL63 Checked task')));
    for (const formatting of ['preserve', 'adapt'] as const) {
      expect(struck(pasted(html, ['task-list'], { formatting }).html)).toEqual(['GL63 Checked task']);
      expect(struck(pasted(html, [], { formatting }).html)).toEqual([]);
    }
    // An underline beside the strikethrough stays.
    const underlined = task(true, 'GL63 Underlined').replace(/text-decoration:line-through;/gu, 'text-decoration:underline line-through;');
    expect(outline(normalizePasteHTML(docs(checklist(underlined))).html)).toBe('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p><u>GL63 Underlined</u></p></li></ul>');
  });

  it('reports a checklist that a destination without task lists can only paste as bullets, which lose the checked state', () => {
    // It pasted as bullet items, the checked state lost, without a finding.
    const html = docs(checklist(task(false, 'GL62 Unchecked task'), task(true, 'GL63 Checked task')));
    for (const formatting of ['preserve', 'adapt'] as const) {
      expect(warnings(pasted(html, ['task-list'], { formatting }))).toEqual(['destination-formatting-unconfirmed']);
      expect(warnings(pasted(html, [], { formatting }))).toEqual([]);
    }
    // A task list asks for task lists, not bullet lists, so an editor with task lists alone holds it.
    expect(warnings(pasted(html, ['bullet-list']))).toEqual([]);
  });

  it('leaves a list that is not wholly a checklist, and another source\'s checkbox items, as written', () => {
    const mixed = normalizePasteHTML(docs(checklist(task(false, 'GL62 Unchecked task'),
      `<li dir="ltr" style="list-style-type:disc;${RUN}" aria-level="1"><p dir="ltr">${run('GL61 Diamond bullet')}</p></li>`))).html;
    expect(mixed).not.toContain('taskList');
    expect(normalizePasteHTML(`<ul><li role="checkbox" aria-checked="true"><p>Web</p></li></ul>`).html).toBe('<ul><li><p>Web</p></li></ul>');
  });
});

describe('Google Docs subscript and superscript', () => {
  it('reads the relative size Docs draws a script with as the script\'s own, so the run keeps its size and the mark draws it', () => {
    // H2O and x2: Docs wraps each 2 in a span of 0.6em aligned to sub or super inside the 11 pt run.
    const html = docs(`<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">${run('GB10 H')}`
      + `<span style="${RUN}"><span style="font-size:0.6em;vertical-align:sub;">2</span></span>${run('O x')}`
      + `<span style="${RUN}"><span style="font-size:0.6em;vertical-align:super;">2</span></span></p>`);
    const preserve = normalizePasteHTML(html);
    expect(warnings(preserve)).toEqual([]);
    expect(preserve.html).not.toContain('6.6pt');
    expect(preserve.html).toContain('<span style="font-family:Arial,sans-serif;font-size:11pt"><sub>2</sub></span>');
    expect(preserve.html).toContain('<span style="font-family:Arial,sans-serif;font-size:11pt"><sup>2</sup></span>');
    expect(warnings(normalizePasteHTML(html, { formatting: 'adapt' }))).toEqual([]);
  });

  it('keeps an absolute size on a script run, and a relative size on a run that is no script', () => {
    const absolute = normalizePasteHTML(docs(`<p dir="ltr">${run('GB50 x')}<span style="${RUN}"><span style="font-size:8pt;vertical-align:super;">2</span></span></p>`)).html;
    expect(absolute).toContain('font-size:8pt"><sup>2</sup>');
    const relative = normalizePasteHTML(docs(`<p dir="ltr"><span style="${RUN}"><span style="font-size:0.5em;">half</span></span></p>`)).html;
    expect(relative).toContain('font-size:5.5pt');
  });
});

describe('Google Docs table cells', () => {
  it('stores no vertical alignment for the top Docs aligns every cell to, which is the table\'s own', () => {
    // Docs writes vertical-align:top on every cell and header cell; the table draws a cell at the top and stores nothing for it.
    const html = docs('<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;table-layout:fixed;width:468pt">'
      + '<colgroup><col /><col /></colgroup><thead><tr style="height:0pt">'
      + `<th style="vertical-align:top;padding:5pt 5pt 5pt 5pt;" scope="col">${paragraph('GT02 Column A', '1.2')}</th>`
      + `<th style="vertical-align:top;padding:5pt 5pt 5pt 5pt;" scope="col">${paragraph('GT03 Column B', '1.2')}</th></tr></thead><tbody><tr style="height:0pt">`
      + cell(paragraph('GT05 Gray cell', '1.2'), 'background-color:#efefef;') + cell(paragraph('GT06 Plain cell', '1.2')) + '</tr></tbody></table></div>');
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(warnings(result)).toEqual([]);
      expect(result.html).not.toContain('data-vertical-align');
    }
    // A cell Docs aligns to the middle or the bottom keeps that alignment.
    const middle = normalizePasteHTML(docs(table(cell(paragraph('GT40 Middle', '1.2')).replace('vertical-align:top', 'vertical-align:middle'))
      + table(cell(paragraph('GT41 Bottom', '1.2')).replace('vertical-align:top', 'vertical-align:bottom')))).html;
    expect([...middle.matchAll(/data-vertical-align="([a-z]+)"/gu)].map(match => match[1])).toEqual(['middle', 'bottom']);
  });
});

describe('Google Docs copy envelope', () => {
  it('leaves out the wrapper whose id names the copy and the break Chrome ends the copy with, so the cleaned HTML holds neither', () => {
    // The bold of normal weight Docs wraps every copy in, its id a guid made per copy, and Chrome's break after it.
    const html = docs(paragraph('GB04 Plain paragraph without formatting.') + paragraph('GB06 Second sentence.'));
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(html, { formatting });
      expect(warnings(result)).toEqual([]);
      expect(result.html).not.toContain('docs-internal-guid');
      expect(result.html.replace(/<span[^>]*>|<\/span>/gu, '')).toBe('<p dir="ltr">GB04 Plain paragraph without formatting.</p><p dir="ltr">GB06 Second sentence.</p>');
    }
  });

  it('keeps a wrapper that declares more than its weight, without the id, and every other break', () => {
    // A color on the wrapper reaches the run that declares none, as it did with the wrapper's id.
    const styled = normalizePasteHTML(docs('<p dir="ltr"><span>GB04 A</span></p>').replace('style="font-weight:normal;"', 'style="font-weight:normal;color:#ff0000;"')).html;
    expect(styled).not.toContain('docs-internal-guid');
    expect(styled).toBe('<span><p dir="ltr"><span><span style="color:#ff0000">GB04 A</span></span></p></span>');
    // A break inside the copy, one after it without the class, and one with the class that does not end the copy stay.
    expect(normalizePasteHTML(docs(paragraph('GB04 A')).replace('<br class="Apple-interchange-newline">', '<br>')).html.endsWith('</p><br>')).toBe(true);
    expect(normalizePasteHTML(`<br class="Apple-interchange-newline">${docs(paragraph('GB04 A'))}`).html.startsWith('<br>')).toBe(true);
  });

  it('leaves out the break that ends another source\'s copy too, which the editor\'s parse ignores', () => {
    expect(normalizePasteHTML('<p>Web</p><br class="Apple-interchange-newline">').html).toBe('<p>Web</p>');
    expect(normalizePasteHTML('<p>Web</p><br class="Apple-interchange-newline">\n').html).toBe('<p>Web</p>\n');
    expect(normalizePasteHTML('<p>Web</p><br>').html).toBe('<p>Web</p><br>');
  });
});
