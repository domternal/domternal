// @vitest-environment node
/**
 * A list item whose content starts with a list. ProseMirror's parse cannot open a Domternal list
 * item on a nested list, so it closed the item empty and put the nested list and every later item
 * in lists of their own. Cleanup gives such an item an empty paragraph first, its label.
 */
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './normalize.js';

describe('a list item whose content starts with a list', () => {
  it.each([
    ['after a paragraph', '<p>p</p><ul><li><ul><li>a</li></ul></li><li>b</li></ul>', '<p>p</p><ul><li><p></p><ul><li>a</li></ul></li><li>b</li></ul>'],
    ['in a later item', '<ul><li>a</li><li><ul><li>b</li></ul></li></ul>', '<ul><li>a</li><li><p></p><ul><li>b</li></ul></li></ul>'],
    ['first in the fragment', '<ol><li><ol><li>a</li></ol></li><li>b</li></ol>', '<ol><li><p></p><ol><li>a</li></ol></li><li>b</li></ol>'],
    ['after white space', '<ul><li> <ul><li>a</li></ul></li></ul>', '<ul><li><p></p> <ul><li>a</li></ul></li></ul>'],
    ['nested twice', '<ul><li><ul><li><ul><li>a</li></ul></li></ul></li></ul>', '<ul><li><p></p><ul><li><p></p><ul><li>a</li></ul></li></ul></li></ul>'],
  ])('gives the item an empty paragraph first, %s', (_name, html, expected) => {
    const result = normalizePasteHTML(html);
    expect(result.html).toBe(expected);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['text first', '<ul><li>x<ul><li>a</li></ul></li></ul>'],
    ['a paragraph first', '<ul><li><p>x</p><ul><li>a</li></ul></li></ul>'],
  ])('leaves an item with %s as written', (_name, html) => {
    expect(normalizePasteHTML(html).html).toBe(html);
  });

  it('leaves the first item of a fragment with a slice marker, whose open depths count its levels', () => {
    const html = '<ul data-pm-slice="3 3 []"><li><ul><li>a</li></ul></li><li><ul><li>b</li></ul></li></ul>';
    expect(normalizePasteHTML(html).html)
      .toBe('<ul data-pm-slice="3 3 []"><li><ul><li>a</li></ul></li><li><p></p><ul><li>b</li></ul></li></ul>');
  });
});
