// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './normalize.js';

// The last paragraph of a partial Google Docs selection may arrive as bare spans after the blocks
// before it, inside the guid wrapper. The shape is authored, not a native capture.
const GUID = 'docs-internal-guid-00000000-7fff-4000-8000-000000000009';
const google = (content: string): string => `<meta charset="utf-8"><b style="font-weight:normal;" id="${GUID}">${content}</b>`;
const run = (style: string, text: string): string => `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;${style}white-space:pre-wrap;">${text}</span>`;
// The final run deliberately contains only the first three letters of "italic".
const partialLast = run('font-weight:400;', 'GB09 ') + run('font-weight:700;', 'bold') + run('font-weight:400;', ' ')
  + run('font-weight:400;font-style:italic;', 'ita');

describe('inline content that follows a block at the top of the pasted HTML', () => {
  it.each(['preserve', 'adapt'] as const)('is wrapped in a paragraph when a space between its words is white space only, in %s', formatting => {
    const result = normalizePasteHTML('<p>x</p><b>a</b> <i>b</i>', { formatting });
    expect(result.html).toBe('<p>x</p><p><span><strong>a</strong></span> <span><em>b</em></span></p>');
    expect(result.diagnostics).toEqual([]);
  });

  it('is wrapped inside the Google Docs guid wrapper, which holds the blocks before it', () => {
    const result = normalizePasteHTML(google(`<p dir="ltr"><span>First</span></p>${partialLast}`), { formatting: 'adapt' });
    const pre = '<span style="white-space:pre-wrap">';
    expect(result.html).toBe(`<span id="${GUID}"><p dir="ltr"><span>First</span></p><p>${pre}GB09 </span>`
      + `${pre}<strong>bold</strong></span>${pre} </span>${pre}<em>ita</em></span></p></span>`);
  });

  it('is wrapped after a list, a heading or a division, and in a wrapper after a block outside it', () => {
    expect(normalizePasteHTML('<ul><li>x</li></ul><b>a</b> <i>b</i>').html)
      .toBe('<ul><li>x</li></ul><p><span><strong>a</strong></span> <span><em>b</em></span></p>');
    expect(normalizePasteHTML('<h2>x</h2><b>a</b> <i>b</i>').html)
      .toBe('<h2>x</h2><p><span><strong>a</strong></span> <span><em>b</em></span></p>');
    expect(normalizePasteHTML('<div>x</div><b>a</b> <i>b</i>').html)
      .toBe('<div>x</div><p><span><strong>a</strong></span> <span><em>b</em></span></p>');
    expect(normalizePasteHTML('<p>x</p><span><b>a</b> <i>b</i><p>y</p></span>').html)
      .toBe('<p>x</p><span><p><span><strong>a</strong></span> <span><em>b</em></span></p><p>y</p></span>');
  });

  it('keeps the white space around the run inside the new paragraph, where ProseMirror trims it', () => {
    expect(normalizePasteHTML('<p>x</p>\n<b>a</b> <i>b</i>\n<p>y</p>').html)
      .toBe('<p>x</p><p>\n<span><strong>a</strong></span> <span><em>b</em></span>\n</p><p>y</p>');
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
