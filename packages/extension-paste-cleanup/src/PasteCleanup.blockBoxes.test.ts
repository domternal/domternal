/**
 * Block elements cleanup does not keep, such as a definition list a browser copies from a web
 * page, paste their texts as separate paragraphs, as they do without PasteCleanup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function pasted(html: string, cleanup: boolean): string {
  const editor = new Editor({ content: '<p></p>', extensions: [Document, Paragraph, Text, Image, ...(cleanup ? [PasteCleanup] : [])] });
  editors.push(editor);
  pasteClipboard(editor.view, { html, text: 'fallback' });
  return editor.state.doc.toString();
}

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

describe('PasteCleanup and block elements it does not keep', () => {
  for (const [name, html, doc] of [
    ['a definition list', '<dl><dt>term</dt><dd>definition</dd></dl>', 'doc(paragraph("term"), paragraph("definition"))'],
    ['two sections', '<section>one</section><section>two</section>', 'doc(paragraph("one"), paragraph("two"))'],
    ['an article with a header and a footer', '<article><header>Title</header><p>Body</p><footer>Note</footer></article>',
      'doc(paragraph("Title"), paragraph("Body"), paragraph("Note"))'],
    ['a figure with a caption', `<figure><img src="${PNG}" alt="i"><figcaption>Caption</figcaption></figure>`, 'doc(image, paragraph("Caption"))'],
  ] as const) {
    it(`pastes ${name} as separate blocks, as without PasteCleanup`, () => {
      expect(pasted(html, true)).toBe(doc);
      expect(pasted(html, false)).toBe(doc);
    });
  }
});
