/**
 * A list item whose content starts with a list pastes with its nested list in it, as one list, with
 * PasteCleanup and with or without SmartPaste. Before, it pasted as an empty item and separate
 * lists, and a numbered list's later items became bullets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, Document, Editor, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function pasted(html: string, extra: AnyExtension[], content = '<p></p>'): string {
  const editor = new Editor({
    content,
    extensions: [Document, Paragraph, Text, Blockquote, BulletList, OrderedList, ListItem, PasteCleanup, ...extra],
  });
  editors.push(editor);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
  pasteClipboard(editor.view, { html, text: 'fallback' });
  return editor.state.doc.toString();
}

const nested = (kind: string, outer: string, inner: string): string =>
  `${kind}(listItem(paragraph, ${kind}(listItem(paragraph("${outer}")))), listItem(paragraph("${inner}")))`;

describe('PasteCleanup and a list item whose content starts with a list', () => {
  for (const [name, extra] of [['SmartPaste', [SmartPaste]], ['ProseMirror\'s paste', []]] as const) {
    it.each([
      ['after a paragraph', '<p>p</p><ul><li><ul><li>a</li></ul></li><li>b</li></ul>', `doc(paragraph("p"), ${nested('bulletList', 'a', 'b')})`],
      ['numbered, after a paragraph', '<p>p</p><ol><li><ol><li>a</li></ol></li><li>b</li></ol>', `doc(paragraph("p"), ${nested('orderedList', 'a', 'b')})`],
      ['in a later item', '<ul><li>a</li><li><ul><li>b</li></ul></li></ul>',
        'doc(bulletList(listItem(paragraph("a")), listItem(paragraph, bulletList(listItem(paragraph("b"))))))'],
      // A container, as a details body is; Details' own package depends on this one, so its tests cannot load Details.
      ['in a quote', '<p>p</p><blockquote><ul><li><ul><li>a</li></ul></li><li>b</li></ul></blockquote>',
        `doc(paragraph("p"), blockquote(${nested('bulletList', 'a', 'b')}))`],
    ])(`keeps the nested list in its item %s, through ${name}`, (_shape, html, doc) => {
      expect(pasted(html, [...extra])).toBe(doc);
    });
  }

  it('pastes a copy that starts items deep in a list as ProseMirror does without PasteCleanup, so its first line joins the paragraph', () => {
    // From inside the third level of a list to the end of the next top-level item, as a ProseMirror editor copies it.
    for (const [html, doc] of [
      ['<ul data-pm-slice="7 3 []"><li><ul><li><ul><li><p>1</p></li><li><p>c2</p></li></ul></li></ul></li><li><p>a2</p></li></ul>',
        'doc(paragraph("x1"), bulletList(listItem(paragraph("c2"))), bulletList(listItem(paragraph("a2"))))'],
      ['<ol data-pm-slice="7 3 []"><li><ol><li><ol><li><p>deep</p></li></ol></li></ol></li><li><p>top</p></li></ol>',
        'doc(paragraph("xdeep"), orderedList(listItem(paragraph("top"))))'],
    ] as const) expect(pasted(html, [], '<p>x</p>'), html).toBe(doc);
  });
});
