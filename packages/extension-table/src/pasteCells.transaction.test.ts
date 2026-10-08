/**
 * Cells pasted into a table, and any content pasted over a cell selection, are a paste: the
 * transaction carries the paste and uiEvent metadata every other paste carries, so paste receipts
 * and observers see it, and it scrolls the pasted cells into view. Without them PasteCleanup
 * reported every cell paste as untracked, with no affected references.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import type { Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import { CellSelection } from '@domternal/pm/tables';
import { pasteClipboard } from '@domternal/tests-clipboard-slices';
import { Table, TableCell, TableHeader, TableRow } from './index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

const GRID = '<table><tr><td><p>x1</p></td><td><p>x2</p></td></tr><tr><td><p>x3</p></td><td><p>x4</p></td></tr></table>';

function mount(): { editor: Editor; changes: Transaction[] } {
  const editor = new Editor({ content: GRID, extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader] });
  editors.push(editor);
  const changes: Transaction[] = [];
  editor.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes.push(transaction); });
  return { editor, changes };
}

function cellText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text === text) found = pos; });
  return found;
}

const meta = (transaction: Transaction): unknown[] => [transaction.getMeta('paste'), transaction.getMeta('uiEvent'), transaction.scrolledIntoView];

describe('a cell paste is a paste transaction', () => {
  it('tags cells pasted into a table', () => {
    const { editor, changes } = mount();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellText(editor, 'x1') + 1)));

    pasteClipboard(editor.view, { html: '<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>', text: 'a\tb' });

    expect(editor.state.doc.textContent).toBe('abx3x4');
    expect(changes.map(meta)).toEqual([[true, 'paste', true]]);
  });

  it('tags content pasted over a cell selection', () => {
    const { editor, changes } = mount();
    const $from = editor.state.doc.resolve(cellText(editor, 'x1') - 2);
    const $to = editor.state.doc.resolve(cellText(editor, 'x4') - 2);
    editor.view.dispatch(editor.state.tr.setSelection(new CellSelection($from, $to)));

    pasteClipboard(editor.view, { html: '<p>z</p>', text: 'z' });

    expect(editor.state.doc.textContent).toBe('zzzz');
    expect(changes.map(meta)).toEqual([[true, 'paste', true]]);
  });
});
