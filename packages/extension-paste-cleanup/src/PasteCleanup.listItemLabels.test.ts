/**
 * A list item whose content starts with a list pastes with its nested list in it, as one list, with
 * PasteCleanup and with or without SmartPaste. Before, it pasted as an empty item and separate
 * lists, and a numbered list's later items became bullets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, Document, Editor, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function pasted(html: string, extra: AnyExtension[]): string {
  const editor = new Editor({
    content: '<p></p>',
    extensions: [Document, Paragraph, Text, Blockquote, BulletList, OrderedList, ListItem, PasteCleanup, ...extra],
  });
  editors.push(editor);
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
});
