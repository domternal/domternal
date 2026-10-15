import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, CharacterCount, Document, Editor, Heading, History, ListItem, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { redo, undo } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Details, DetailsContent, DetailsSummary } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
const source = '<details><summary>Title</summary><div data-details-content><p>body</p><p>after</p></div></details>';
function mount(content = source, extra: AnyExtension[] = []): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), content,
    extensions: [Document, Paragraph, Text, Heading, History, Blockquote, BulletList, ListItem, Details, DetailsSummary, DetailsContent, ...extra] });
  editor.view.setProps({ handleScrollToSelection: () => true });
  editors.push(editor);
  return editor;
}
function cross(editor: Editor, tail = 2, reverse = false): void {
  let summary = 0;
  let body = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'Title') summary = pos + 2;
    if (node.isText && node.text === 'body') body = pos + tail;
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, reverse ? body : summary, reverse ? summary : body)));
}

describe('paste across the boundary between one details summary and its body', () => {
  it.each([
    ['inline', 'add', 'doc(details(detailsSummary("Ti"), detailsContent(paragraph("adddy"), paragraph("after"))))'],
    ['one paragraph', '<p>add</p>', 'doc(details(detailsSummary("Ti"), detailsContent(paragraph("adddy"), paragraph("after"))))'],
    ['several blocks', '<p>a</p><p>b</p>', 'doc(details(detailsSummary("Ti"), detailsContent(paragraph("a"), paragraph("bdy"), paragraph("after"))))'],
  ])('keeps the same disclosure and the unselected text with %s', (_name, html, expected) => {
    for (const reverse of [false, true]) {
      const editor = mount();
      cross(editor, 2, reverse);
      const before = editor.state.doc;
      const selection = editor.state.selection.toJSON();
      let changes = 0;
      editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes++; });
      pasteClipboard(editor.view, { html, text: 'add' });
      expect(editor.state.doc.toString()).toBe(expected);
      expect(changes).toBe(1);
      expect(editor.view.dom.querySelectorAll('[data-type="details"]')).toHaveLength(1);
      expect((editor.view.nodeDOM(0) as HTMLElement).classList.contains('is-open')).toBe(true);
      expect(undo(editor.state, editor.view.dispatch)).toBe(true);
      expect(editor.state.doc.eq(before)).toBe(true);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(redo(editor.state, editor.view.dispatch)).toBe(true);
      expect(editor.state.doc.toString()).toBe(expected);
    }
  });

  it('keeps an empty selected body tail and the following block', () => {
    const editor = mount();
    cross(editor, 4);
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\nb' });
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Ti"), detailsContent(paragraph("a"), paragraph("b"), paragraph("after"))))');
  });

  it('changes only the selected inner disclosure', () => {
    const editor = mount(`<details><summary>Outer</summary><div data-details-content><p>before</p>${source}<p>last</p></div></details>`);
    cross(editor);
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\nb' });
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Outer"), detailsContent(paragraph("before"), details(detailsSummary("Ti"), detailsContent(paragraph("a"), paragraph("bdy"), paragraph("after"))), paragraph("last"))))');
  });

  it.each([
    ['quote', '<blockquote><p>body</p></blockquote>', 'paragraph("a"), paragraph("bdy"), paragraph("after")'],
    ['list', '<ul><li><p>body</p></li><li><p>kept</p></li></ul>', 'paragraph("a"), paragraph("bdy"), bulletList(listItem(paragraph("kept"))), paragraph("after")'],
    ['nested disclosure', '<details><summary>Inner</summary><div data-details-content><p>body</p></div></details>', 'paragraph("a"), paragraph("bdy"), paragraph("after")'],
  ])('preserves the unselected body suffix when the selection ends in a %s', (_name, body, expected) => {
    const editor = mount(`<details><summary>Title</summary><div data-details-content>${body}<p>after</p></div></details>`);
    cross(editor);
    const before = editor.state.doc;
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\nb' });
    editor.state.doc.check();
    expect(editor.state.doc.toString()).toBe(`doc(details(detailsSummary("Ti"), detailsContent(${expected})))`);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('does not change content or open a disclosure when a filter rejects the transaction', () => {
    const editor = mount(source, [CharacterCount.configure({ limit: 14 })]);
    cross(editor);
    const before = editor.state.doc;
    pasteClipboard(editor.view, { html: '<p>long text that exceeds the limit</p>', text: 'long text that exceeds the limit' });
    expect(editor.state.doc.eq(before)).toBe(true);
    expect((editor.view.nodeDOM(0) as HTMLElement).classList.contains('is-open')).toBe(false);
  });
});
