// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './normalize.js';

// The last paragraph of a partial Google Docs selection may arrive as bare spans after the blocks
// before it, inside the guid wrapper. The shape is authored, not a native capture.
const GUID = 'docs-internal-guid-00000000-7fff-4000-8000-000000000009';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const google = (content: string): string => `<meta charset="utf-8"><b style="font-weight:normal;" id="${GUID}">${content}</b>`;
const run = (style: string, text: string): string => `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;${style}white-space:pre-wrap;">${text}</span>`;
// The final run deliberately contains only the first three letters of "italic".
const partialLast = run('font-weight:400;', 'GB09 ') + run('font-weight:700;', 'bold') + run('font-weight:400;', ' ')
  + run('font-weight:400;font-style:italic;', 'ita');

describe('inline content that follows a block at the top of the pasted HTML', () => {
  it.each(['preserve', 'adapt'] as const)('is wrapped in a division when a space between its words is white space only, in %s', formatting => {
    const result = normalizePasteHTML('<p>x</p><b>a</b> <i>b</i>', { formatting });
    expect(result.html).toBe('<p>x</p><div><span><strong>a</strong></span> <span><em>b</em></span></div>');
    expect(result.diagnostics).toEqual([]);
  });

  it('is wrapped after the blocks of a Google Docs copy, whose guid wrapper goes, and inside an inline element that holds blocks', () => {
    const result = normalizePasteHTML(google(`<p dir="ltr"><span>First</span></p>${partialLast}`), { formatting: 'adapt' });
    // The division holds the white space every run of it writes, which its spaces need.
    expect(result.html).toBe('<p dir="ltr"><span>First</span></p><div style="white-space:pre-wrap">GB09 <strong>bold</strong> <em>ita</em></div>');
    // A wrapper that declares more than Docs' normal weight stays, without its id, and the run is wrapped inside it.
    const kept = normalizePasteHTML(google(`<p dir="ltr"><span>First</span></p>${partialLast}`).replace('font-weight:normal;', 'font-weight:normal;color:#123456;'),
      { formatting: 'adapt' });
    expect(kept.html).toBe('<span><p dir="ltr"><span>First</span></p><div style="white-space:pre-wrap">GB09 <strong>bold</strong> <em>ita</em></div></span>');
  });

  it('is wrapped after a list, a heading or a division, and in a wrapper after a block outside it', () => {
    expect(normalizePasteHTML('<ul><li>x</li></ul><b>a</b> <i>b</i>').html)
      .toBe('<ul><li>x</li></ul><div><span><strong>a</strong></span> <span><em>b</em></span></div>');
    expect(normalizePasteHTML('<h2>x</h2><b>a</b> <i>b</i>').html)
      .toBe('<h2>x</h2><div><span><strong>a</strong></span> <span><em>b</em></span></div>');
    expect(normalizePasteHTML('<div>x</div><b>a</b> <i>b</i>').html)
      .toBe('<div>x</div><div><span><strong>a</strong></span> <span><em>b</em></span></div>');
    expect(normalizePasteHTML('<p>x</p><span><b>a</b> <i>b</i><p>y</p></span>').html)
      .toBe('<p>x</p><span><div><span><strong>a</strong></span> <span><em>b</em></span></div><p>y</p></span>');
  });

  it('keeps the white space around the run inside the new division, where ProseMirror trims it', () => {
    expect(normalizePasteHTML('<p>x</p>\n<b>a</b> <i>b</i>\n<p>y</p>').html)
      .toBe('<p>x</p><div>\n<span><strong>a</strong></span> <span><em>b</em></span>\n</div><p>y</p>');
  });

  // A division, unlike a paragraph, opens no block of its own: ProseMirror puts its inline content in a
  // paragraph it opens there, which an image ends when the destination's image is a block and holds
  // when it is inline. A paragraph wrapper left a block image an empty paragraph before it.
  it('keeps an image in the run inside the division', () => {
    expect(normalizePasteHTML(`<p>x</p><img src="${PNG}" alt="i"><span>a</span><span> </span><span>b</span>`).html)
      .toBe(`<p>x</p><div><img src="${PNG}" alt="i"><span>a</span><span> </span><span>b</span></div>`);
    expect(normalizePasteHTML(`<p>x</p><span>a</span><span> </span><img src="${PNG}" alt="i"><span>b</span>`).html)
      .toBe(`<p>x</p><div><span>a</span><span> </span><img src="${PNG}" alt="i"><span>b</span></div>`);
  });

  // The wrapper is generated, so it uses the shared depth and node allowance like every other.
  it.each([
    ['depth', { maxDepth: 5 }, { maxDepth: 6 }],
    ['node', { maxNodes: 14 }, { maxNodes: 15 }],
  ])('rejects a run whose wrapper would pass the %s limit', (_name, short, enough) => {
    const html = '<p>x</p><b><i>a</i></b> <b><i>b</i></b>';
    expect(normalizePasteHTML(html, { limits: enough }).status).toBe('cleaned');
    expect(normalizePasteHTML(html, { limits: short })).toEqual({
      status: 'rejected', html: '', source: 'html', diagnosticsTruncated: false,
      diagnostics: [{ code: 'structure-limit', severity: 'error' }],
    });
    // Without a wrapper the same limit holds the content.
    expect(normalizePasteHTML('<p>x</p><b><i>a</i></b><b><i>b</i></b>', { limits: short }).status).toBe('cleaned');
  });

  it.each([
    ['before the first block', 'Loose <b>a</b> <i>b</i><p>A</p>', 'Loose <span><strong>a</strong></span> <span><em>b</em></span><p>A</p>'],
    ['without white space between its words', '<p>x</p><b>a</b><i>b</i>', '<p>x</p><span><strong>a</strong></span><span><em>b</em></span>'],
    ['with only one word', '<p>x</p><b>a</b> ', '<p>x</p><span><strong>a</strong></span> '],
    ['of line breaks', '<p>x</p><br> <br>', '<p>x</p><br> <br>'],
    ['of an empty span', '<p>x</p><span> </span>', '<p>x</p><span> </span>'],
    ['with a non-breaking space', '<p>x</p><b>a</b>&nbsp;<i>b</i>', '<p>x</p><span><strong>a</strong></span> <span><em>b</em></span>'],
    ['inside a division', '<p>x</p><div><b>a</b> <i>b</i></div>', '<p>x</p><div><span><strong>a</strong></span> <span><em>b</em></span></div>'],
    ['inside a list item', '<ul><li><p>x</p><b>a</b> <i>b</i></li></ul>', '<ul><li><p>x</p><span><strong>a</strong></span> <span><em>b</em></span></li></ul>'],
  ])('is left as written %s', (_name, html, expected) => {
    expect(normalizePasteHTML(html).html).toBe(expected);
  });
});
