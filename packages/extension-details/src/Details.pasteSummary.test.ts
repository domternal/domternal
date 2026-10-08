/**
 * Blocks pasted into a details summary. The summary holds text only, and the paste fitted blocks
 * there by closing the details and opening a new one: the summary's text after the caret and the
 * original content moved to a second details with an empty summary, collapsed and so hidden. A
 * paste that brings blocks now goes where Enter in the summary puts the caret: a new block at the
 * start of the content, which opens. The block and the paste are one transaction, which every
 * paste handler starts from the placement Details registers. Inline content, a single textblock,
 * a line copied with its line break, and text copied from inside a list item, quote or another
 * summary still join the summary's text. Markdown lines are tested in the Markdown package, which
 * depends on this one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockquote, CharacterCount, CodeBlock, Document, Editor, Heading, History, Link, Paragraph, Text, BulletList, ListItem, TaskItem, TaskList } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { undo } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import { copySelection, pasteClipboard } from '@domternal/tests-clipboard-slices';
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
    extensions: [Document, Paragraph, Text, Heading, BulletList, ListItem, Blockquote, CodeBlock, TaskList, TaskItem, History, details, DetailsSummary, DetailsContent, ...extra],
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

  it('joins text copied from inside a list item, task item, quote, code block or another summary to the summary text', () => {
    const sources: [string, string][] = [
      ['list item', '<ul><li><p>alpha beta</p></li></ul>'],
      ['task item', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>alpha beta</p></li></ul>'],
      ['quote', '<blockquote><p>alpha beta</p></blockquote>'],
      ['code block', '<pre><code>alpha beta</code></pre>'],
      ['summary', '<details><summary>alpha beta</summary><div data-details-content><p>other</p></div></details>'],
    ];
    for (const [name, html] of sources) {
      for (const extra of [[], [PasteCleanup]] as AnyExtension[][]) {
        const source = mount(extra);
        source.commands.setContent(html);
        let from = 0;
        source.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'alpha beta') from = pos + 6; });
        source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, from, from + 4)));
        const copied = copySelection(source.view);
        const editor = mount(extra);
        caret(editor, 'Title');
        pasteClipboard(editor.view, copied);
        expect(editor.state.doc.toString(), `${name} ${String(extra.length)}`)
          .toBe('doc(details(detailsSummary("Titlebeta"), detailsContent(paragraph("body"))))');
      }
    }
  });

  it('joins a line copied with its line break to the summary text', () => {
    for (const clipboard of [{ text: 'word\n' }, { text: 'word\r\n' }, { html: '<p>word</p><p></p>', text: 'word\n' }]) {
      const editor = mount();
      caret(editor, 'Title');
      pasteClipboard(editor.view, clipboard);
      expect(editor.state.doc.toString(), JSON.stringify(clipboard)).toBe('doc(details(detailsSummary("Titleword"), detailsContent(paragraph("body"))))');
      expect(isOpen(editor)).toBe(false);
    }
  });

  it('pastes in one transaction, so a refused paste leaves the details as it was and closed', () => {
    const editor = mount([CharacterCount.configure({ limit: 12 })]);
    const before = editor.state.doc;
    caret(editor, 'Title');
    pasteClipboard(editor.view, { html: '<p>aaaaaaaaaa</p><p>bbbbbbbbbb</p>', text: 'aaaaaaaaaa\n\nbbbbbbbbbb' });
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(isOpen(editor)).toBe(false);

    const changes: number[] = [];
    const counted = mount();
    counted.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes.push(transaction.steps.length); });
    caret(counted, 'Title');
    pasteClipboard(counted.view, { html: '<p>a</p><p>b</p>', text: 'a\n\nb' });
    expect(changes).toHaveLength(1);
  });

  for (const [name, extra, clipboard] of [
    ['with Paste Cleanup', [PasteCleanup], (file: File) => ({ files: [file] })],
    ['with its address, as a browser copies an image', [], (file: File) => ({ html: '<img src="https://example.com/a.png">', text: 'https://example.com/a.png', files: [file] })],
  ] as const) {
    it(`puts a pasted image file in the content ${name}`, async () => {
      const editor = mount([...extra, Link, Image.configure({ uploadHandler: () => Promise.resolve('https://example.com/b.png') })]);
      caret(editor, 'Title');
      pasteClipboard(editor.view, clipboard(new File(['x'], 'a.png', { type: 'image/png' })));
      expect(isOpen(editor)).toBe(true);
      await vi.waitFor(() => { expect(editor.state.doc.toString()).toContain('image'); });
      expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(image, paragraph("body"))))');
    });
  }

  it('leaves the details as it was for image files the image node does not store', () => {
    for (const [image, file] of [
      [Image.configure({ allowBase64: false }), new File(['x'], 'a.png', { type: 'image/png' })],
      [Image, new File(['x'], 'a.bmp', { type: 'image/bmp' })],
    ] as const) {
      const editor = mount([image]);
      const before = editor.state.doc;
      caret(editor, 'Title');
      pasteClipboard(editor.view, { files: [file] });
      expect(editor.state.doc.eq(before), file.name).toBe(true);
      expect(isOpen(editor), file.name).toBe(false);
    }
  });

  it('applies a paste whose images Paste Cleanup prepares first, checking the document it captured', async () => {
    const results: string[] = [];
    const editor = mount([
      Image.configure({ uploadHandler: () => Promise.resolve('https://example.com/b.png') }),
      PasteCleanup.configure({
        imageAssets: {
          mode: 'embedded',
          match: context => context.references.map(reference => ({
            placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host' as const, matcherId: 'test' },
          })),
        },
        onPasteResult: result => { results.push(result.status); },
      }),
    ]);
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
    const file = new File([png], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(png.buffer) });
    caret(editor, 'Title');
    pasteClipboard(editor.view, { html: '<p>one</p><p>two<img src="cid:chart" alt="Chart"></p>', files: [file] });
    await vi.waitFor(() => { expect(results).toHaveLength(1); });
    expect(results).toEqual(['applied']);
    expect(editor.state.doc.toString()).toBe('doc(details(detailsSummary("Title"), detailsContent(paragraph("one"), paragraph("two"), image, paragraph("body"))))');
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
