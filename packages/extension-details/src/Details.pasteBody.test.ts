/**
 * A copy of blocks from inside a details body, without its summary, records the details as the
 * slice's context, and the paste rebuilt it around the blocks: a collapsed details with an empty
 * summary, which hid them. The paste now drops that wrapper, so the blocks paste as blocks, also
 * when the details sits in a list item or quote the copy recorded too. A copy that holds the
 * summary keeps its details.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Blockquote, BulletList, Document, Editor, ListItem, Paragraph, Text } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { copySelection, describeSlice, pasteClipboard, pastedSlice } from '@domternal/tests-clipboard-slices';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { PasteCleanup } from '../../extension-paste-cleanup/dist/index.js';
import { Details, DetailsContent, DetailsSummary } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(content: string, extra: AnyExtension[] = []): Editor {
  const editor = new Editor({ content, extensions: [Document, Paragraph, Text, BulletList, ListItem, Blockquote, Details, DetailsSummary, DetailsContent, ...extra] });
  editors.push(editor);
  return editor;
}

function textPos(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text) === true) found = pos + (node.text.indexOf(text));
  });
  if (found < 0) throw new Error(`No text ${text}`);
  return found;
}

/** Copies the editor's text from the start of `from` to the end of `to`. */
function copy(editor: Editor, from: string, to: string): { html: string; text: string } {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, textPos(editor, from), textPos(editor, to) + to.length)));
  return copySelection(editor.view);
}

const SOURCE = '<details><summary>Sum</summary><div data-details-content><p>one</p><p>two</p></div></details><p>after</p>';

describe('pasting blocks copied from a details body', () => {
  it('drops the details the copy recorded as its context, so the blocks do not paste hidden', () => {
    const copied = copy(mount(SOURCE), 'one', 'two');
    expect(copied.html).toContain('data-pm-slice="2 2 [&quot;details&quot;');
    const target = mount('<p></p>');

    expect(describeSlice(pastedSlice(target.view, copied))).toBe('1 1 <paragraph("one"), paragraph("two")>');
    pasteClipboard(target.view, copied);

    expect(target.state.doc.toString()).toBe('doc(paragraph("one"), paragraph("two"))');
  });

  for (const [name, extra] of [['SmartPaste', [SmartPaste]], ['PasteCleanup', [PasteCleanup]], ['SmartPaste and PasteCleanup', [SmartPaste, PasteCleanup]]] as const) {
    it(`pastes them as blocks with ${name}`, () => {
      const copied = copy(mount(SOURCE, [...extra]), 'one', 'two');
      const target = mount('<p>x</p><p></p>', [...extra]);
      target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, 4)));
      pasteClipboard(target.view, copied);
      expect(target.state.doc.toString()).toBe('doc(paragraph("x"), paragraph("one"), paragraph("two"))');
    });
  }

  it('keeps the blocks after the details in the slice after the unwrapped ones', () => {
    const copied = copy(mount(SOURCE), 'two', 'after');
    const target = mount('<p></p>');
    expect(describeSlice(pastedSlice(target.view, copied))).toBe('1 1 <paragraph("two"), paragraph("after")>');
  });

  it('unwraps a details body copied from inside the body of another details', () => {
    const source = mount('<details><summary>Outer</summary><div data-details-content>'
      + '<details><summary>Inner</summary><div data-details-content><p>one</p><p>two</p></div></details></div></details>');
    const target = mount('<p></p>');
    pasteClipboard(target.view, copy(source, 'one', 'two'));
    expect(target.state.doc.toString()).toBe('doc(paragraph("one"), paragraph("two"))');
  });

  for (const [name, html, doc] of [
    ['a list item', '<ul><li><p>item</p><details><summary>Sum</summary><div data-details-content><p>one</p><p>two</p></div></details></li></ul>',
      'doc(paragraph("x"), bulletList(listItem(paragraph("one"), paragraph("two"))))'],
    ['a quote', '<blockquote><details><summary>Sum</summary><div data-details-content><p>one</p><p>two</p></div></details></blockquote>',
      'doc(paragraph("x"), blockquote(paragraph("one"), paragraph("two")))'],
  ] as const) {
    it(`unwraps a details body copied from a details in ${name}, which the copy also recorded`, () => {
      for (const extra of [[], [SmartPaste], [PasteCleanup], [SmartPaste, PasteCleanup]] as AnyExtension[][]) {
        const copied = copy(mount(html, extra), 'one', 'two');
        const target = mount('<p>x</p><p></p>', extra);
        target.view.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, 4)));
        pasteClipboard(target.view, copied);
        expect(target.state.doc.toString(), String(extra.length)).toBe(doc);
      }
    });
  }

  it('keeps the details of a copy that holds its summary', () => {
    const source = mount(SOURCE);
    const target = mount('<p></p>');
    pasteClipboard(target.view, copy(source, 'Sum', 'two'));
    expect(target.state.doc.firstChild?.type.name).toBe('details');
    expect(target.state.doc.textContent).toBe('Sumonetwo');
  });
});
