/**
 * Bare table rows and cells pasted with PasteCleanup paste the table they paste without it, in a
 * paragraph and in a table, instead of one run of the cells' texts. An editor without tables
 * pastes their texts, as it does without PasteCleanup, instead of refusing them as a table.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { describeSlice, pasteClipboard, pastedSlice } from '@domternal/tests-clipboard-slices';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup } from './index.js';
import type { PasteOperationResult } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(content: string, cleanup: boolean): Editor {
  const editor = new Editor({
    content,
    extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader, ...(cleanup ? [PasteCleanup] : [])],
  });
  editors.push(editor);
  return editor;
}

function caretAt(editor: Editor, text: string): void {
  let pos = -1;
  editor.state.doc.descendants((node, at) => { if (pos < 0 && node.isText && node.text === text) pos = at + text.length; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
}

const rows = '<tr><td>ra</td><td>rb</td></tr><tr><td>rc</td><td>rd</td></tr>';
const table = (cells: string[][]): string => `table(${cells.map(row => `tableRow(${row.map(text => `tableCell(paragraph("${text}"))`).join(', ')})`).join(', ')})`;

describe('PasteCleanup and bare table rows and cells', () => {
  for (const [name, html, cells] of [
    ['rows', rows, [['ra', 'rb'], ['rc', 'rd']]],
    ['cells', '<td>ta</td><td>tb</td>', [['ta', 'tb']]],
    ['rows after a column group, as a spreadsheet may write them', `<colgroup><col><col></colgroup>${rows}`, [['ra', 'rb'], ['rc', 'rd']]],
    ['rows after the meta element Chrome writes first', `<meta charset="utf-8">${rows}`, [['ra', 'rb'], ['rc', 'rd']]],
  ] as const) {
    it(`pastes ${name} as the table they paste without PasteCleanup`, () => {
      const cleaned = mount('<p></p>', true);
      const plain = mount('<p></p>', false);
      const expected = table(cells.map(row => [...row]));

      expect(describeSlice(pastedSlice(cleaned.view, { html }))).toBe(`0 0 <${expected}>`);
      expect(pasteClipboard(cleaned.view, { html, text: 'fallback' }).defaultPrevented).toBe(true);
      pasteClipboard(plain.view, { html, text: 'fallback' });

      expect(cleaned.state.doc.child(0).toString()).toBe(expected);
      expect(cleaned.getJSON()).toEqual(plain.getJSON());
    });
  }

  it('pastes the texts of bare rows into an editor without tables, as without PasteCleanup', async () => {
    const results: PasteOperationResult[] = [];
    const cleaned = new Editor({ content: '<p></p>', extensions: [Document, Paragraph, Text, PasteCleanup.configure({ onPasteResult: result => { results.push(result); } })] });
    const plain = new Editor({ content: '<p></p>', extensions: [Document, Paragraph, Text] });
    editors.push(cleaned, plain);
    pasteClipboard(cleaned.view, { html: rows, text: 'fallback' });
    pasteClipboard(plain.view, { html: rows, text: 'fallback' });
    expect(cleaned.state.doc.toString()).toBe('doc(paragraph("rarbrcrd"))');
    expect(cleaned.getJSON()).toEqual(plain.getJSON());
    await vi.waitFor(() => { expect(results.map(result => result.status)).toEqual(['applied']); });
  });

  it('keeps the paragraph after bare rows, which ProseMirror alone drops', () => {
    const editor = mount('<p></p>', true);
    pasteClipboard(editor.view, { html: `${rows}<p>after</p>`, text: 'fallback' });
    expect(editor.state.doc.toString()).toBe(`doc(${table([['ra', 'rb'], ['rc', 'rd']])}, paragraph("after"))`);
  });

  it('pastes bare rows into a table cell by cell, as without PasteCleanup', () => {
    const content = '<table><tr><td><p>x1</p></td><td><p>x2</p></td></tr><tr><td><p>x3</p></td><td><p>x4</p></td></tr></table>';
    const cleaned = mount(content, true);
    const plain = mount(content, false);
    caretAt(cleaned, 'x1');
    caretAt(plain, 'x1');

    pasteClipboard(cleaned.view, { html: rows, text: 'fallback' });
    pasteClipboard(plain.view, { html: rows, text: 'fallback' });

    expect(cleaned.state.doc.child(0).toString()).toBe(table([['ra', 'rb'], ['rc', 'rd']]));
    expect(cleaned.getJSON()).toEqual(plain.getJSON());
  });
});
