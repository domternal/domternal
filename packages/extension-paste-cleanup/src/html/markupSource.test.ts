// @vitest-environment node
/**
 * The source of a paste is read from the markup an application writes, never from text. A web page whose text, title,
 * alt text, link, code or free comment names Word's classes, properties or namespace, Google Docs' copy wrapper or
 * LibreOffice was cleaned with that application's rules (F10-P9-1): Word's routine spacing dropped line height 1.15,
 * the Docs rules divided line heights by 1.2 and dropped black text, and a real Google Docs copy whose text named a
 * Word property was cleaned as Word.
 */
import { describe, expect, it, vi } from 'vitest';
import { defaultTreeAdapter } from 'parse5';
import { normalizePasteHTML } from './index.js';
import type { NormalizePasteHTMLResult } from './types.js';

// Word's routine spacing drops 1.15, the Docs rules read it as Docs' own (1.15 / 1.2) and drop it, plain HTML keeps it.
const SPACED = '<p style="line-height:1.15">Spaced</p>';
const KEPT = '<p style="line-height:1.15">Spaced</p>';
const clean = (html: string): NormalizePasteHTMLResult => normalizePasteHTML(html, { allowRemoteImages: false, allowDataImages: false });
const attribute = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const escaped = (text: string): string => attribute(text).replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** The words each application's markup carries, as a page mentions them in its text. */
const MENTIONS: readonly (readonly [application: string, mention: string])[] = [
  ['Word', 'mso-list: l0 level1 lfo1'],
  ['Word', 'mso-hide: all'],
  ['Word', 'MsoNormal'],
  ['Word', 'p.MsoNormal { margin: 0 }'],
  ['Word', 'urn:schemas-microsoft-com:office:word'],
  ['Word', 'xmlns:w="urn:schemas-microsoft-com:office:word"'],
  ['Word', '<p class="MsoNormal" style="mso-list:l0 level1 lfo1">'],
  ['Word', 'MSO-LIST: L0'],
  ['Word', 'msonormal'],
  ['Google Docs', 'id="docs-internal-guid-8bbc85bd-7fff-c6dc-7178-040c7fffecf3"'],
  ['Google Docs', "id='docs-internal-guid-1'"],
  ['Google Docs', 'ID=DOCS-INTERNAL-GUID-1'],
  ['Google Docs', '<b id="docs-internal-guid-1">'],
  ['LibreOffice', 'LibreOffice'],
  ['LibreOffice', 'OpenOffice.org'],
  ['LibreOffice', '<meta name="generator" content="LibreOffice 7.6">'],
];

/** Where a page carries text: each place a mention lands without becoming markup. */
const PLACES: readonly (readonly [place: string, html: (mention: string) => string])[] = [
  ['a paragraph', mention => `<p>Word and Docs write ${escaped(mention)} in their HTML.</p>`],
  ['an attribute-free text run', mention => `Notes: ${escaped(mention)}`],
  ['a heading', mention => `<h2>${escaped(mention)}</h2>`],
  ['a table cell', mention => `<table><tr><td>${escaped(mention)}</td></tr></table>`],
  ['a code block', mention => `<pre><code>${escaped(mention)}</code></pre>`],
  ['preformatted text', mention => `<pre>${escaped(mention)}</pre>`],
  ['a title attribute', mention => `<p title="${attribute(mention)}">x</p>`],
  ['an image alt text', mention => `<p><img src="https://example.com/a.png" alt="${attribute(mention)}"></p>`],
  ['a link', mention => `<p><a href="https://example.com/?q=${encodeURIComponent(mention)}">x</a></p>`],
  ['a data attribute', mention => `<p data-note="${attribute(mention)}">x</p>`],
  ['a title element', mention => `<title>${mention}</title><p>x</p>`],
  ['a text area', mention => `<p>x</p><textarea>${mention}</textarea>`],
  ['a script', mention => `<p>x</p><script>const note = ${JSON.stringify(mention)};</script>`],
  ['a comment', mention => `<p>x</p><!-- copied from a page about ${mention.replaceAll('--', '- -')} -->`],
  ['CDATA', mention => `<p>x</p><![CDATA[ ${mention} ]]>`],
  ['CDATA in SVG', mention => `<p>x</p><svg><![CDATA[ ${mention} ]]></svg>`],
  ['a comment closed by --!>', mention => `<p>x</p><!-- ${mention.replaceAll('--', '- -')} --!>`],
  ['a raw "<" in text', mention => `<p>1 < 2 ${escaped(mention)}</p>`],
];

describe('the source of a paste is read from markup, never from text', () => {
  for (const [place, html] of PLACES) {
    it(`cleans a page that names an application's markup in ${place} as plain HTML`, () => {
      for (const [application, mention] of MENTIONS) {
        const result = clean(SPACED + html(mention));
        expect(result.source, `${application}: ${mention}`).toBe('html');
        expect(result.html.startsWith(KEPT), `${application}: ${mention}`).toBe(true);
      }
    });
  }

  it('cleans a page whose text names a character reference of a marker, or whose own class or link merely starts with mso-, as plain HTML', () => {
    for (const html of [
      '<p>mso&#45;list: l0 level1 lfo1</p>', '<p>Mso&#78;ormal</p>', '<p class="mso-btn">Button</p>', '<p><a href="https://example.com/mso-list-guide">Guide</a></p>',
      '<p id="intro-docs-internal-guid-1">x</p>', '<p data-id="docs-internal-guid-1">x</p>', '<p><a href="https://example.com/?id=docs-internal-guid-1">x</a></p>', '<meta name="description" content="Made in LibreOffice"><p>x</p>',
      '<style>/* written like mso-list: l0 and p.MsoNormal */ p { color: red }</style><p>x</p>',
    ]) {
      const result = clean(SPACED + html);
      expect(result.source, html).toBe('html');
      expect(result.html.startsWith(KEPT), html).toBe(true);
    }
  });

  it('keeps a red Safari web copy whose text names a Word property red, and a MsoTitle paragraph a paragraph', () => {
    // Word's caret color rule takes a color equal to the caret color for Word's automatic color, in a Word source only.
    expect(clean('<p style="caret-color: rgb(200, 0, 0); color: rgb(200, 0, 0);">Red text about mso- styles</p>').html)
      .toBe('<p><span style="color:rgb(200, 0, 0)">Red text about mso- styles</span></p>');
    expect(clean('<p class="MsoTitle">Title</p><p>Exported with mso-ansi-language: HR</p>').html).toBe('<p>Title</p><p>Exported with mso-ansi-language: HR</p>');
  });

  it('cleans Google Docs copies whose text names Word markup as Google Docs, and Word copies whose text names Google Docs as Word', () => {
    const docs = (text: string): string => `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-8bbc85bd-7fff-c6dc-7178-040c7fffecf3">`
      + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;`
      + `background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;`
      + `white-space:pre-wrap;">${text}</span></p></b><br class="Apple-interchange-newline">`;
    const plain = clean(docs('GB01 Plain paragraph.'));
    expect(plain.source).toBe('google-docs');
    for (const mention of ['Word writes mso-list: l0 level1 lfo1', 'class MsoNormal', 'xmlns:o=urn:schemas-microsoft-com:office:office', 'LibreOffice']) {
      const result = clean(docs(mention));
      expect(result.source, mention).toBe('google-docs');
      expect(result.html, mention).toBe(plain.html.replace('GB01 Plain paragraph.', mention));
      expect(result.diagnostics, mention).toEqual(plain.diagnostics);
    }
    const word = '<p class=MsoNormal style="line-height:1.15">Word paragraph about id="docs-internal-guid-1" and LibreOffice<o:p></o:p></p>';
    expect(clean(word)).toMatchObject({ source: 'word', html: '<p>Word paragraph about id="docs-internal-guid-1" and LibreOffice</p>' });
  });
});

describe('the markup each application writes still names it', () => {
  const WORD_ROOT = '<html xmlns:o="urn:schemas-microsoft-com:office:office"\r\nxmlns:w="urn:schemas-microsoft-com:office:word"\r\n'
    + 'xmlns:m="http://schemas.microsoft.com/office/2004/12/omml"\r\nxmlns="http://www.w3.org/TR/REC-html40">';
  it.each([
    ['the Office namespaces on the html element, as Safari keeps them', `${WORD_ROOT}<head><meta charset="UTF-8"></head><p style="line-height:1.15">Spaced<o:p></o:p></p>`],
    ['an Office namespace on another element', '<div xmlns:o="urn:schemas-microsoft-com:office:office"><p style="line-height:1.15">Spaced</p></div>'],
    ['a MsoNormal class', '<p class=MsoNormal style="line-height:1.15">Spaced<o:p></o:p></p>'],
    ['a MsoNormalTable class', '<table class="MsoNormalTable"><tr><td><p style="line-height:1.15">Spaced</p></td></tr></table>'],
    ['a MsoNormal class among others, in capitals', '<p CLASS="Lead MSONORMAL" style="line-height:1.15">Spaced</p>'],
    ['a MsoNormal class with a prefix, as Gmail writes a quoted Word message\'s', '<p class="gmail-MsoNormal" style="line-height:1.15">Spaced</p>'],
    ['an Office declaration in a style attribute', '<p style="line-height:1.15;mso-pagination:widow-orphan">Spaced</p>'],
    ['an Office declaration on a later line of a style attribute', "<p style='line-height:1.15;\r\nmso-bidi-font-size:12.0pt'>Spaced</p>"],
    ['an unquoted Office declaration', '<p style=mso-spacerun:yes>Spaced</p><p style="line-height:1.15">Spaced</p>'],
    ['Word\'s stylesheet', '<style><!--\n/* Style Definitions */\n p.MsoNormal, li.MsoNormal, div.MsoNormal\n\t{mso-style-unhide:no;\n\tline-height:115%;}\n--></style><p style="line-height:1.15">Spaced</p>'],
    ['Word\'s stylesheet in a conditional comment', '<!--[if gte mso 10]>\n<style>\n /* Style Definitions */\n table.MsoNormalTable\n\t{mso-style-name:"Table Normal";}\n</style>\n<![endif]--><p style="line-height:1.15">Spaced</p>'],
    ['a MsoNormal paragraph in a conditional comment', '<!--[if gte mso 9]><p class=MsoNormal>Office</p><![endif]--><p style="line-height:1.15">Spaced</p>'],
  ])('reads Word from %s', (_name, html) => {
    const result = clean(html);
    expect(result.source).toBe('word');
    expect(result.html).toContain('<p>Spaced</p>');
    expect(result.html).not.toContain('line-height');
  });

  it.each([
    ['a bold wrapper, as Chrome writes it', '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-8bbc85bd-7fff-c6dc-7178-040c7fffecf3">%</b>'],
    ['a span wrapper', '<span id="docs-internal-guid-1">%</span>'],
    ['a paragraph', '<p id=\'docs-internal-guid-1\'>Docs</p>%'],
    ['an unquoted id in capitals', '<DIV ID=DOCS-INTERNAL-GUID-1>%</DIV>'],
  ])('reads Google Docs from its copy wrapper on %s', (_name, html) => {
    // Docs writes its default spacing, 1.15, as 1.38 on every block, which plain HTML keeps.
    const result = clean(html.replace('%', '<p style="line-height:1.38">Spaced</p>'));
    expect(result.source).toBe('google-docs');
    expect(result.html).not.toContain('line-height');
  });

  it.each([
    ['LibreOffice\'s generator meta', '<meta name="generator" content="LibreOffice 7.6.4.1 (MacOSX)"/>'],
    ['OpenOffice\'s generator meta, in capitals', '<META NAME="GENERATOR" CONTENT="OpenOffice.org 3.4  (Win32)">'],
  ])('reads LibreOffice from %s, which changes only the reported source', (_name, meta) => {
    expect(clean(`<html><head>${meta}<title></title></head><body>${SPACED}</body></html>`)).toMatchObject({ source: 'libreoffice', html: KEPT });
  });

  it('reads Word before Google Docs and LibreOffice, as before', () => {
    expect(clean('<meta name="generator" content="LibreOffice"><b id="docs-internal-guid-1"><p class=MsoNormal>Mixed</p></b>').source).toBe('word');
    expect(clean('<meta name="generator" content="LibreOffice"><b id="docs-internal-guid-1"><p>Mixed</p></b>').source).toBe('google-docs');
  });

  it('reads the markup as the HTML parser reads it, so a character reference in an attribute value spells its character', () => {
    expect(clean('<p class="Mso&#78;ormal" style="line-height:1.15">Spaced</p>')).toMatchObject({ source: 'word', html: '<p>Spaced</p>' });
    expect(clean('<b id="docs&#45;internal-guid-1"><p style="line-height:1.38">Spaced</p></b>').source).toBe('google-docs');
    expect(clean('<meta name="generator" content="Libre&#79;ffice"><p>x</p>').source).toBe('libreoffice');
  });

  it('reports the source of a paste it rejects', () => {
    const result = normalizePasteHTML(`<p class=MsoNormal>${'<b>'.repeat(200)}deep</p>`, { limits: { maxDepth: 32 } });
    expect(result).toMatchObject({ status: 'rejected', source: 'word' });
  });

  // A fragment parse drops the rows after a leading col, as Excel's fragment between StartFragment and EndFragment
  // starts; the rows are read from the parse that reads them as a table's content.
  it('reads Word from the rows and cells after a leading column', () => {
    const list = "<col style='width:48pt'><tr><td><p class=MsoListParagraph style='mso-list:l0 level1 lfo1'>"
      + "<span style='mso-list:Ignore'>1.<span>&nbsp; </span></span>first</p></td></tr>";
    expect(clean(list)).toMatchObject({
      source: 'word',
      html: '<table><colgroup><col style="width:48pt"></colgroup><tbody><tr><td><ol style="list-style-type:decimal" start="1"><li><p>first</p></li></ol></td></tr></tbody></table>',
    });
    const cells = "<col width=64 style='width:48pt'><tr height=20 style='height:15.0pt'><td height=20 width=64 style='height:15.0pt;width:48pt'>"
      + "<p style='line-height:1.15;mso-pagination:none'>1.50</p></td></tr>";
    expect(clean(cells)).toMatchObject({ source: 'word', html: expect.stringContaining('<td style="height:15.0pt;width:48pt"><p>1.50</p></td>') });
  });

  it('ignores a tag the input ends in, which a browser never builds', () => {
    expect(clean('<p>x</p><p class="MsoNormal"').source).toBe('html');
    expect(clean('<p>x</p><p class="MsoNormal">').source).toBe('word');
  });
});

// Each conditional comment read again with an allowance of its own let a page of comments that each hold almost
// maxNodes elements make the parser build them all: 22 comments of 29,000 paragraphs took seconds where 1.2 took 0.1.
describe('Office\'s conditional comments are read again within the parser limits', () => {
  const COMMENT = `<!--[if gte mso 9]>mso-${'<p>'.repeat(900)}<![endif]-->`;

  it.each([
    ['a paste it cleans', COMMENT.repeat(20), 'cleaned'],
    ['a paste the parse refused', COMMENT.repeat(20) + '<i>x</i>'.repeat(600), 'rejected'],
  ] as const)('shares one allowance of maxNodes between them in %s', (_name, html, status) => {
    const created = vi.spyOn(defaultTreeAdapter, 'createElement');
    try {
      expect(normalizePasteHTML(html, { limits: { maxNodes: 1_000 } })).toMatchObject({ status, source: 'html' });
      // The parse of the paste and the comments' one allowance, each at most maxNodes.
      expect(created.mock.calls.length).toBeLessThanOrEqual(2 * 1_000);
    } finally {
      created.mockRestore();
    }
  });

  it('still reads Word from a conditional comment read before the allowance is spent', () => {
    const word = '<!--[if gte mso 10]><style>table.MsoNormalTable{mso-style-name:"Table Normal";}</style><![endif]-->';
    expect(normalizePasteHTML(word + COMMENT, { limits: { maxNodes: 1_000 } }).source).toBe('word');
  });
});
