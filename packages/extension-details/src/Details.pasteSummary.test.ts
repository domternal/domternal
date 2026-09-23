/**
 * Blocks pasted into a details summary. The summary holds text only, and the paste fitted blocks
 * there by closing the details and opening a new one: the summary's text after the caret and the
 * original content moved to a second details with an empty summary, collapsed and so hidden. A
 * paste that brings blocks now goes where Enter in the summary puts the caret: a new block at the
 * start of the content, which opens, and every paste handler places it there. Inline content and
 * a single textblock still join the summary's text. Markdown lines are tested in the Markdown
 * package, which depends on this one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Heading, History, Paragraph, Text, BulletList, ListItem } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { undo } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from '../../extension-paste-cleanup/dist/index.js';
import { Details, DetailsContent, DetailsSummary } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

const SOURCE = '<details><summary>Title</summary><div data-details-content><p>body</p></div></details>';

function mount(extra: AnyExtension[] = [], details = Details): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    content: SOURCE,
    extensions: [Document, Paragraph, Text, Heading, BulletList, ListItem, History, details, DetailsSummary, DetailsContent, ...extra],
  });
  editors.push(editor);
  return editor;
}

/** Puts the caret after `before` in the summary, or selects `before` itself with `select`. */
function caret(editor: Editor, before: string, select = false): void {
  const start = 2;
  const end = start + before.length;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, select ? start : end, end)));
}

function isOpen(editor: Editor): boolean {
  return (editor.view.nodeDOM(0) as HTMLElement).classList.contains('is-open');
}

const pasted = (body: string): string => `doc(details(detailsSummary("Title"), detailsContent(${body}, paragraph("body"))))`;

describe('pasting blocks into a details summary', () => {
  for (const [name, before] of [['at its end', 'Title'], ['in its middle', 'Ti']] as const) {
    it(`keeps the summary whole and puts two pasted paragraphs at the start of the open content, ${name}`, () => {
      const editor = mount();
      caret(editor, before);
      pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\n\nb' });

      expect(editor.state.doc.toString()).toBe(pasted('paragraph("a"), paragraph("b")'));
      expect(isOpen(editor)).toBe(true);
      expect(editor.state.selection.$head.parent.textContent).toBe('b');
      expect(editor.state.selection.$head.parentOffset).toBe(1);
    });
  }

  it('puts a pasted list, and plain text lines, at the start of the content', () => {
    const editor = mount();
    caret(editor, 'Title');
    pasteClipboard(editor.view, { html: '<ul><li>l1</li><li>l2</li></ul>', text: 'l1\nl2' });
    expect(editor.state.doc.toString()).toBe(pasted('bulletList(listItem(paragraph("l1")), listItem(paragraph("l2")))'));

    const plain = mount();
    caret(plain, 'Title');
    pasteClipboard(plain.view, { text: 'one\n\ntwo' });
    expect(plain.state.doc.toString()).toBe(pasted('paragraph("one"), paragraph("two")'));
  });

  it('replaces selected summary text, and puts the paste in the content', () => {
    const editor = mount();
    caret(editor, 'Ti', true);
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\n\nb' });
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("tle"), detailsContent(paragraph("a"), paragraph("b"), paragraph("body"))))');
  });

  it('still joins inline content and a single textblock to the summary text', () => {
    for (const html of ['<p>add</p>', '<h2>add</h2>', '<strong>add</strong>']) {
      const editor = mount();
      caret(editor, 'Title');
      pasteClipboard(editor.view, { html, text: 'add' });
      expect(editor.state.doc.toString(), html).toBe('doc(details(detailsSummary("Titleadd"), detailsContent(paragraph("body"))))');
      expect(isOpen(editor), html).toBe(false);
    }
  });

  for (const [name, extra] of [['SmartPaste', [SmartPaste]], ['PasteCleanup', [PasteCleanup]], ['SmartPaste and PasteCleanup', [SmartPaste, PasteCleanup]]] as const) {
    it(`keeps the summary whole with ${name}`, () => {
      const editor = mount([...extra]);
      caret(editor, 'Ti');
      pasteClipboard(editor.view, { html: '<p>a</p><ul><li>l1</li></ul>', text: 'a\nl1' });
      expect(editor.state.doc.toString()).toBe(pasted('paragraph("a"), bulletList(listItem(paragraph("l1")))'));
      expect(isOpen(editor)).toBe(true);
    });
  }

  it('puts a pasted image file, which the image node places as a block, in the content', async () => {
    const editor = mount([Image.configure({ uploadHandler: () => Promise.resolve('https://example.com/a.png') })]);
    caret(editor, 'Title');
    pasteClipboard(editor.view, { files: [new File(['x'], 'a.png', { type: 'image/png' })] });
    await vi.waitFor(() => { expect(editor.state.doc.toString()).toContain('image'); });
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(image, paragraph("body"))))');
  });

  it('opens a details whose open state the document keeps', () => {
    const editor = mount([], Details.configure({ persist: true }));
    caret(editor, 'Title');
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\n\nb' });
    expect(editor.state.doc.firstChild?.attrs['open']).toBe(true);
    expect(isOpen(editor)).toBe(true);
  });

  it('undoes the paste and the block it went into in one step', () => {
    const editor = mount();
    const before = editor.getJSON();
    caret(editor, 'Title');
    pasteClipboard(editor.view, { html: '<p>a</p><p>b</p>', text: 'a\n\nb' });
    undo(editor.state, editor.view.dispatch);
    expect(editor.getJSON()).toEqual(before);
  });
});
