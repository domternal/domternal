// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './normalize.js';

// A partial Google Docs selection that starts in a nested item is expected to write the nested list
// directly in its parent list, with list-style-type on each item. Authored, not a native capture.
const GUID = 'docs-internal-guid-00000000-7fff-4000-8000-000000000011';
const google = (content: string): string => `<meta charset="utf-8"><b style="font-weight:normal;" id="${GUID}">${content}</b>`;
const item = (marker: string, level: number, text: string): string =>
  `<li dir="ltr" style="list-style-type:${marker};font-size:11pt;" aria-level="${String(level)}"><p dir="ltr"><span>${text}</span></p></li>`;
const cleanItem = (text: string): string => `<li dir="ltr"><p dir="ltr"><span><span style="font-size:11pt">${text}</span></span></p></li>`;

describe('a list whose content starts with a list', () => {
  it.each([
    ['one leading list', '<ul><ul><li>a</li></ul><li>b</li></ul>', '<ul><li><ul><li>a</li></ul></li><li>b</li></ul>'],
    ['only a list', '<ol><ol><li>a</li></ol></ol>', '<ol><li><ol><li>a</li></ol></li></ol>'],
    ['two leading lists and the white space between them', '<ul> <ul><li>a</li></ul> <ol><li>c</li></ol><li>b</li></ul>',
      '<ul><li> <ul><li>a</li></ul> <ol><li>c</li></ol></li><li>b</li></ul>'],
  ])('puts %s in a new first item', (_name, html, expected) => {
    const result = normalizePasteHTML(html);
    expect(result.html).toBe(expected);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps a numbered Google Docs list one numbered list after moving the item markers to the lists', () => {
    const result = normalizePasteHTML(google(`<ol><ol>${item('lower-alpha', 2, 'a')}</ol>${item('decimal', 1, 'b')}</ol>`));
    expect(result.html).toBe(`<span id="${GUID}"><ol style="list-style-type:decimal"><li><ol style="list-style-type:lower-alpha">`
      + `${cleanItem('a')}</ol></li>${cleanItem('b')}</ol></span>`);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['a list after an item, which ProseMirror moves into that item', '<ul><li>x</li><ul><li>a</li></ul></ul>'],
    ['a task list, whose items carry a checked state', '<ul data-type="taskList"><ul data-type="taskList"><li data-type="taskItem">a</li></ul></ul>'],
  ])('leaves %s as written', (_name, html) => {
    expect(normalizePasteHTML(html).html).toBe(html);
  });
});
