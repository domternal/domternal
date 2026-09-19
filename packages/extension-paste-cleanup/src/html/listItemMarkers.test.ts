// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { DEFAULT_PASTE_HTML_LIMITS, normalizeClipboardHTML, normalizePasteHTML } from './normalize.js';
import { parseBoundedHTML } from './parse.js';
import { hoistListItemMarkers } from './listItemMarkers.js';
import type { NormalizePasteHTMLOptions, PasteDiagnostic } from './types.js';

// The Google Docs shapes below are authored in the form Google Docs is expected to write lists, with the
// marker as list-style-type on each li and a nested list placed directly in its parent list. They are not
// native captures: the Google Docs captures confirm or correct them.
const run = (text: string): string => '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;'
  + 'font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">'
  + `${text}</span>`;
const googleItem = (marker: string, text: string, level = 1): string => `<li dir="ltr" style="list-style-type:${marker};font-size:11pt;`
  + 'font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;'
  + `text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="${String(level)}"><p dir="ltr" style="line-height:1.38;`
  + `margin-top:0pt;margin-bottom:0pt;" role="presentation">${run(text)}</p></li>`;
const googleList = (tag: 'ul' | 'ol', ...content: string[]): string =>
  `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${content.join('')}</${tag}>`;
const google = (body: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-00000000-7fff-4000-8000-000000000002">${body}</b>`;

const warnings = (diagnostics: readonly PasteDiagnostic[]): string[] =>
  diagnostics.filter(diagnostic => diagnostic.severity !== 'info').map(diagnostic => diagnostic.code);
/** The opening tag of every list in document order. */
const lists = (html: string): string[] => [...html.matchAll(/<(?:ul|ol)\b[^>]*>/g)].map(match => match[0]);
/** The opening tag of every list item in document order. */
const items = (html: string): string[] => [...html.matchAll(/<li\b[^>]*>/g)].map(match => match[0]);
const both = ['preserve', 'adapt'] as const;
function clean(html: string, options: NormalizePasteHTMLOptions = {}): { html: string; warnings: string[]; truncated: boolean } {
  const result = normalizePasteHTML(html, options);
  expect(result.status).toBe('cleaned');
  return { html: result.html, warnings: warnings(result.diagnostics), truncated: result.diagnosticsTruncated };
}

describe('list item markers moved to their list', () => {
  it.each(both)('keeps the markers of an authored Google Docs bullet list on the list, quietly, in %s', formatting => {
    const result = clean(google(googleList('ul', googleItem('disc', 'One'), googleItem('disc', 'Two'))), { formatting });
    expect(result.warnings).toEqual([]);
    const item = formatting === 'preserve' ? 'background-color:transparent;vertical-align:baseline;white-space:pre' : 'vertical-align:baseline;white-space:pre';
    const paragraph = formatting === 'preserve' ? ' style="line-height:1.38"' : '';
    const text = (value: string): string => formatting === 'preserve'
      ? `<span style="white-space:pre-wrap"><span style="font-family:Arial,sans-serif;font-size:11pt;color:#000000">${value}</span></span>`
      : `<span style="white-space:pre-wrap">${value}</span>`;
    expect(result.html).toBe('<span id="docs-internal-guid-00000000-7fff-4000-8000-000000000002"><ul style="list-style-type:disc">'
      + `<li style="${item}" dir="ltr"><p${paragraph} dir="ltr">${text('One')}</p></li>`
      + `<li style="${item}" dir="ltr"><p${paragraph} dir="ltr">${text('Two')}</p></li></ul></span>`);
  });

  it.each(both)('gives each authored Google Docs nested bullet list its own marker in %s', formatting => {
    const html = google(googleList('ul', googleItem('disc', 'One'),
      googleList('ul', googleItem('circle', 'Two', 2), googleList('ul', googleItem('square', 'Three', 3))), googleItem('disc', 'Four')));
    const result = clean(html, { formatting });
    expect(result.warnings).toEqual([]);
    expect(lists(result.html)).toEqual(['<ul style="list-style-type:disc">', '<ul style="list-style-type:circle">', '<ul style="list-style-type:square">']);
    expect(items(result.html).filter(tag => tag.includes('list-style'))).toEqual([]);
    expect(result.html.match(/One|Two|Three|Four/g)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it.each(both)('gives each authored Google Docs nested numbered list its own marker in %s', formatting => {
    const html = google(googleList('ol', googleItem('decimal', 'One'),
      googleList('ol', googleItem('lower-alpha', 'Two', 2), googleList('ol', googleItem('lower-roman', 'Three', 3)))));
    const result = clean(html, { formatting });
    expect(result.warnings).toEqual([]);
    expect(lists(result.html)).toEqual(['<ol style="list-style-type:decimal">', '<ol style="list-style-type:lower-alpha">', '<ol style="list-style-type:lower-roman">']);
    expect(items(result.html).filter(tag => tag.includes('list-style'))).toEqual([]);
  });

  it.each(both)('keeps an authored Google Docs numbered list with a nested bullet list apart by kind in %s', formatting => {
    const html = google(googleList('ol', googleItem('decimal', 'One'), googleList('ul', googleItem('circle', 'Two', 2)), googleItem('decimal', 'Three')));
    const result = clean(html, { formatting });
    expect(result.warnings).toEqual([]);
    expect(lists(result.html)).toEqual(['<ol style="list-style-type:decimal">', '<ul style="list-style-type:circle">']);
  });

  it.each(both)('moves the presets Google Docs is expected to write, upper-alpha and upper-roman, in %s', formatting => {
    const html = google(googleList('ol', googleItem('upper-alpha', 'One'), googleList('ol', googleItem('upper-roman', 'Two', 2))));
    const result = clean(html, { formatting });
    expect(result.warnings).toEqual([]);
    expect(lists(result.html)).toEqual(['<ol style="list-style-type:upper-alpha">', '<ol style="list-style-type:upper-roman">']);
  });

  it.each(both)('moves the markers of an authored Google Docs list inside a table cell in %s', formatting => {
    const html = google('<div dir="ltr" style="margin-left:0pt;" align="left"><table style="border:none;border-collapse:collapse;"><tbody><tr style="height:0pt">'
      + '<td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;'
      + `vertical-align:top;padding:5pt 5pt 5pt 5pt;overflow:hidden;overflow-wrap:break-word;">${googleList('ul', googleItem('square', 'Cell'))}</td>`
      + '</tr></tbody></table></div>');
    const result = clean(html, { formatting });
    expect(result.warnings).toEqual([]);
    expect(result.html).toMatch(/<td[^>]*><ul style="list-style-type:square"><li[^>]*>/);
  });

  it('keeps a long authored Google Docs list quiet instead of filling the diagnostic allowance', () => {
    const labels = Array.from({ length: 120 }, (_, index) => `Item ${String(index + 1)}`);
    const result = clean(google(googleList('ul', ...labels.map(label => googleItem('disc', label)))));
    expect(result.warnings).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(lists(result.html)).toEqual(['<ul style="list-style-type:disc">']);
    expect(items(result.html)).toHaveLength(120);
  });

  it.each(both)('keeps an ordered start and an item value next to the moved marker in %s', formatting => {
    expect(clean('<ol start="3"><li style="list-style-type:decimal"><p>A</p></li><li style="list-style-type:decimal"><p>B</p></li></ol>', { formatting }))
      .toEqual({ html: '<ol style="list-style-type:decimal" start="3"><li><p>A</p></li><li><p>B</p></li></ol>', warnings: [], truncated: false });
    expect(clean('<ol><li value="5" style="list-style-type:decimal"><p>A</p></li><li style="list-style-type:decimal"><p>B</p></li></ol>', { formatting }))
      .toEqual({ html: '<ol style="list-style-type:decimal"><li value="5"><p>A</p></li><li><p>B</p></li></ol>', warnings: [], truncated: false });
  });

  it.each([
    ['every item overrides the list marker', '<ul style="list-style-type:square"><li style="list-style-type:circle"><p>A</p></li><li style="list-style-type:circle"><p>B</p></li></ul>',
      '<ul style="list-style-type:circle"><li><p>A</p></li><li><p>B</p></li></ul>'],
    ['every item overrides a list marker of none', '<ul style="list-style-type:none"><li style="list-style-type:disc"><p>A</p></li><li style="list-style-type:disc"><p>B</p></li></ul>',
      '<ul style="list-style-type:disc"><li><p>A</p></li><li><p>B</p></li></ul>'],
    ['an unstyled item takes the marker of the HTML type', '<ol type="a"><li style="list-style-type:lower-alpha"><p>A</p></li><li><p>B</p></li></ol>',
      '<ol style="list-style-type:lower-alpha" type="a"><li><p>A</p></li><li><p>B</p></li></ol>'],
    ['an unstyled item takes the marker of the list style', '<ul style="list-style-type:square"><li style="list-style-type:square"><p>A</p></li><li><p>B</p></li></ul>',
      '<ul style="list-style-type:square"><li><p>A</p></li><li><p>B</p></li></ul>'],
    ['the last of several item declarations wins', '<ul><li style="list-style-type:square;list-style-type:circle"><p>A</p></li></ul>',
      '<ul style="list-style-type:circle"><li><p>A</p></li></ul>'],
    ['the declaration name and value are read without case', '<ul><li style="LIST-STYLE-TYPE: DISC"><p>A</p></li></ul>',
      '<ul style="list-style-type:disc"><li><p>A</p></li></ul>'],
  ])('moves the marker when %s', (_name, html, expected) => {
    for (const formatting of both) expect(clean(html, { formatting })).toEqual({ html: expected, warnings: [], truncated: false });
  });

  it('still reports the indentation of an item whose marker moved', () => {
    const result = clean('<ul><li style="list-style-type:disc;margin-left:15pt"><p>A</p></li><li style="list-style-type:disc"><p>B</p></li></ul>');
    expect(result.html).toBe('<ul style="list-style-type:disc"><li><p>A</p></li><li><p>B</p></li></ul>');
    expect(result.warnings).toEqual(['unsupported-formatting']);
  });
});

describe('list item markers that stay a reported loss', () => {
  it.each([
    ['a list marker of none next to an unstyled item', '<ul style="list-style-type:none"><li style="list-style-type:disc"><p>A</p></li><li><p>B</p></li></ul>',
      '<ul><li><p>A</p></li><li><p>B</p></li></ul>', 2],
    ['an item that disagrees with the HTML type', '<ol type="i"><li style="list-style-type:lower-alpha"><p>A</p></li><li><p>B</p></li></ol>',
      '<ol type="i"><li><p>A</p></li><li><p>B</p></li></ol>', 1],
    ['an unstyled item in a list without a marker', '<ul><li style="list-style-type:disc"><p>A</p></li><li><p>B</p></li></ul>',
      '<ul><li><p>A</p></li><li><p>B</p></li></ul>', 1],
    ['items with different markers', '<ul><li style="list-style-type:circle"><p>A</p></li><li style="list-style-type:square"><p>B</p></li></ul>',
      '<ul><li><p>A</p></li><li><p>B</p></li></ul>', 2],
    ['an ordered marker in a bullet list', '<ul><li style="list-style-type:decimal"><p>A</p></li></ul>', '<ul><li><p>A</p></li></ul>', 1],
    ['a bullet marker in an ordered list', '<ol><li style="list-style-type:disc"><p>A</p></li></ol>', '<ol><li><p>A</p></li></ol>', 1],
    ['a last declaration outside the vocabulary', '<ul><li style="list-style-type:disc;list-style-type:url(x)"><p>A</p></li></ul>', '<ul><li><p>A</p></li></ul>', 1],
    ['a list style item outside a list', '<li style="list-style-type:square">A</li>', '<li>A</li>', 1],
    ['an item that is not a direct child of its list', '<ul><div><li style="list-style-type:disc"><p>A</p></li></div></ul>',
      '<ul><div><li><p>A</p></li></div></ul>', 1],
    ['the list-style shorthand on an item', '<ul><li style="list-style:disc"><p>A</p></li></ul>', '<ul><li><p>A</p></li></ul>', 1],
    ['task items', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false" style="list-style-type:disc"><p>A</p></li>'
      + '<li data-type="taskItem" data-checked="true" style="list-style-type:disc"><p>B</p></li></ul>',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>A</p></li><li data-type="taskItem" data-checked="true"><p>B</p></li></ul>', 2],
    // CSS reads each of these styles otherwise than a split on semicolons: an important declaration outranks a later one, a
    // no-break space is part of the name, and a comment, escape, string or bracket hides the semicolons it holds.
    ['an earlier item marker marked important', '<ul><li style="list-style-type:square !important;list-style-type:disc"><p>A</p></li>'
      + '<li style="list-style-type:disc"><p>B</p></li></ul>', '<ul><li><p>A</p></li><li><p>B</p></li></ul>', 2],
    ['an earlier list marker marked important that an unstyled item takes', '<ul style="list-style-type:circle !important;list-style-type:disc">'
      + '<li style="list-style-type:disc"><p>A</p></li><li><p>B</p></li></ul>', '<ul style="list-style-type:disc"><li><p>A</p></li><li><p>B</p></li></ul>', 2],
    ['a marker name after a no-break space', '<ul><li style="\u00a0list-style-type:circle"><p>A</p></li><li style="\u00a0list-style-type:circle"><p>B</p></li></ul>',
      '<ul><li><p>A</p></li><li><p>B</p></li></ul>', 2],
    ...[['a comment', 'mso-a:x/*;list-style-type:lower-roman;mso-b:*/'], ['an escaped semicolon', 'list-style-type:decimal;mso-a:\\;list-style-type:lower-roman'],
      ['a string', 'mso-a:"x;list-style-type:lower-roman;mso-b:"'], ['a bracket', 'mso-a:f(x;list-style-type:lower-roman;mso-b:)'],
      ['mismatched brackets', 'mso-a:(];list-style-type:lower-roman;mso-b:)']].map(([name, style]): [string, string, string, number] => [`a marker hidden by ${String(name)}`,
      `<ol><li style='${String(style)}'><p>A</p></li><li style='${String(style)}'><p>B</p></li></ol>`, '<ol><li><p>A</p></li><li><p>B</p></li></ol>', 2]),
  ])('reports %s', (_name, html, expected, count) => {
    for (const formatting of both) {
      expect(clean(html, { formatting })).toEqual({ html: expected, warnings: Array<string>(count).fill('unsupported-formatting'), truncated: false });
    }
  });

  it.each([['ul', 'none'], ['ul', '"\\2022"'], ['ol', 'decimal-leading-zero'], ['ul', 'disc !important'], ['ul', 'd\\69 sc'],
    ['ul', 'url(https://example.test/marker)'], ['ul', 'var(--marker)']])('reports %s items with the marker %s', (tag, marker) => {
    const result = clean(`<${tag}><li style='list-style-type:${marker}'><p>A</p></li><li style='list-style-type:${marker}'><p>B</p></li></${tag}>`);
    expect(result.html).toBe(`<${tag}><li><p>A</p></li><li><p>B</p></li></${tag}>`);
    expect(result.warnings).toEqual(['unsupported-formatting', 'unsupported-formatting']);
  });

  it('still moves the markers of other lists in the same paste', () => {
    const result = clean('<ul><li style="list-style-type:circle"><p>A</p></li><li style="list-style-type:square"><p>B</p></li></ul>'
      + '<ol><li style="list-style-type:upper-roman"><p>C</p></li></ol>');
    expect(result.html).toBe('<ul><li><p>A</p></li><li><p>B</p></li></ul><ol style="list-style-type:upper-roman"><li><p>C</p></li></ol>');
    expect(result.warnings).toEqual(['unsupported-formatting', 'unsupported-formatting']);
  });

  it('leaves reconstructed Word lists and verified own copies to their own rules', () => {
    const office = "<p class=MsoListParagraphCxSpFirst style='margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]>"
      + "<span style='mso-list:Ignore'>1.<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp; </span></span><![endif]>First<o:p></o:p></p>";
    expect(clean(office)).toEqual({ html: '<ol style="list-style-type:decimal" start="1"><li><p>First</p></li></ol>', warnings: [], truncated: false });
    const nonce = 'OwnCopyNonceOwnCopy_-A';
    const { result } = normalizeClipboardHTML(`<ul data-domternal-copy="v1.${nonce}" data-pm-slice="0 0 []"><li style="list-style-type:disc"><p>A</p></li></ul>`,
      {}, undefined, undefined, undefined, value => value === nonce);
    expect(result.html).toBe('<ul data-pm-slice="0 0 []"><li><p>A</p></li></ul>');
    expect(warnings(result.diagnostics)).toEqual(['unsupported-formatting']);
  });
});

describe('hoistListItemMarkers', () => {
  const parse = (html: string): Root => parseBoundedHTML(html, DEFAULT_PASTE_HTML_LIMITS);
  const styleLength = (tree: Root): number => {
    let total = 0;
    const pending: (Root | Element)[] = [tree];
    for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
      if (node.type === 'element' && typeof node.properties.style === 'string') total += node.properties.style.length;
      for (const child of node.children) if (child.type === 'element') pending.push(child);
    }
    return total;
  };

  it('removes every marker declaration from the items and keeps their other declarations in order', () => {
    const tree = parse('<ul style="margin:0;list-style-type:square;padding:0">\n<li style="color:red; LIST-STYLE-TYPE:square ;list-style-type:circle;white-space:pre">A</li>\n'
      + '<li style="list-style-type:circle">B</li>\n</ul>');
    hoistListItemMarkers(tree);
    expect(toHtml(tree)).toBe('<ul style="margin:0;padding:0;list-style-type:circle">\n<li style="color:red;white-space:pre">A</li>\n<li>B</li>\n</ul>');
  });

  it('leaves a list unchanged when no item declares a marker or an item cannot keep one', () => {
    for (const html of ['<ul style="list-style-type:square"><li style="color:red">A</li></ul>', '<ul><li style="list-style-type:disc">A</li><li>B</li></ul>',
      '<ul style="list-style-type:disc"><li style="list-style-type:disc">A</li><li style="list-style-type:circle">B</li></ul>', '<ol type="x"><li style="list-style-type:decimal">A</li><li>B</li></ol>',
      '<ul data-type="taskList"><li style="list-style-type:disc">A</li></ul>', '<ol data-type="taskList"><li style="list-style-type:decimal">A</li></ol>', '<ul></ul>',
      '<ul><li style="list-style-typedisc">A</li></ul>', '<ul><li style="color:red !important;list-style-type:disc">A</li></ul>',
      '<ul style="margin:0 !important"><li style="list-style-type:disc">A</li></ul>']) {
      const tree = parse(html);
      hoistListItemMarkers(tree);
      expect(toHtml(tree)).toBe(html);
    }
  });

  it('reads quoted font names and bracketed values that hold no semicolon', () => {
    const tree = parse(`<ul><li style="font-family:'Times New Roman',serif;color:rgb(0, 0, 0);list-style-type:circle">A</li></ul>`);
    hoistListItemMarkers(tree);
    expect(toHtml(tree)).toBe('<ul style="list-style-type:circle"><li style="font-family:&#x27;Times New Roman&#x27;,serif;color:rgb(0, 0, 0)">A</li></ul>');
  });

  it('writes the marker once per list, so the style text grows by one separator at most', () => {
    const tree = parse(google(googleList('ul', googleItem('disc', 'One'), googleItem('disc', 'Two'))));
    const before = styleLength(tree);
    hoistListItemMarkers(tree);
    expect(styleLength(tree)).toBeLessThan(before);
    // The one case that grows: a list with other declarations and a single item that declares only the marker.
    const worst = parse('<ul style="margin:0"><li style="list-style-type:disc">A</li></ul>');
    const length = styleLength(worst);
    hoistListItemMarkers(worst);
    expect(toHtml(worst)).toBe('<ul style="margin:0;list-style-type:disc"><li>A</li></ul>');
    expect(styleLength(worst)).toBe(length + 1);
  });
});
