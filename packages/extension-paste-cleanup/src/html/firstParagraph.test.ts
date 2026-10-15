import { describe, expect, it } from 'vitest';
import { firstParagraphFormat } from './firstParagraph.js';
import { normalizePasteHTML } from './normalize.js';

describe('private first paragraph formatting intent', () => {
  it.each([
    ['<p style="text-align:left">First</p>', { textAlign: 'left', lineHeight: undefined, text: 'First' }],
    ['<p style="line-height:1.5">First</p>', { textAlign: undefined, lineHeight: '1.5', text: 'First' }],
    ['\n<!-- copied -->\n<div><div><p style="text-align:center;line-height:2">First</p></div></div>', { textAlign: 'center', lineHeight: '2', text: 'First' }],
  ])('records only retained source properties in %s', (html, expected) => {
    const result = normalizePasteHTML(html);
    expect(firstParagraphFormat(result)).toEqual(expected);
    expect(Object.keys(result)).not.toContain('firstParagraph');
    expect(firstParagraphFormat({ ...result })).toBeUndefined();
  });

  it.each([
    '<p>First</p><p style="text-align:center">Second</p>',
    '<p style="text-align:expression(alert(1));line-height:var(--spacing)">First</p>',
    '<p style="text-align:start;line-height:normal">First</p>',
    '<h2 style="text-align:center">Heading</h2>',
    '<blockquote><p style="text-align:center">Quote</p></blockquote>',
    '<ul><li><p style="text-align:center">Item</p></li></ul>',
    '<table><tr><td><p style="text-align:center">Cell</p></td></tr></table>',
    '<p></p><p style="text-align:center">Second</p>',
    '<div></div><p style="text-align:center">Second</p>',
  ])('does not infer paragraph intent from %s', html => {
    expect(firstParagraphFormat(normalizePasteHTML(html))).toBeUndefined();
  });

  it.each([false, true])('keeps Adapt policy even when preserveTextAlignment=%s', preserveTextAlignment => {
    const result = normalizePasteHTML('<p style="text-align:center;line-height:2">First</p>', { formatting: 'adapt', preserveTextAlignment });
    expect(firstParagraphFormat(result)).toBeUndefined();
  });
});
