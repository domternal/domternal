import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, History, Paragraph, Text, type ChainedCommands, type Command } from '@domternal/core';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { Table } from './Table.js';

const ASYMMETRIC_TABLE = '<table><tr><td data-colwidth="400">A</td><td data-colwidth="100">B</td><td data-colwidth="100">C</td></tr></table>';

describe('column insertion command integration', () => {
  let editor: Editor;
  let host: HTMLDivElement;

  afterEach(() => {
    editor.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  function mount(content = ASYMMETRIC_TABLE, constrainToContainer = true, capacities = [600]): void {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, History, Table.configure({ constrainToContainer })],
      content,
    });
    host.querySelectorAll('.tableWrapper').forEach((wrapper, index) => {
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, capacities[index]! + 1, 100));
    });
  }

  function findCell(doc: PMNode, text: string): number {
    let position = -1;
    doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' && node.textContent === text) position = pos;
    });
    if (position < 0) throw new Error(`Cell ${text} was not found`);
    return position;
  }

  function selectCell(text: string): void {
    const pos = findCell(editor.state.doc, text);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos + 1))));
  }

  function customChain(chain = editor.chain()): ChainedCommands & { command: (command: Command) => ChainedCommands } {
    // The runtime proxy supports custom commands beyond the public chain type.
    return chain as ChainedCommands & { command: (command: Command) => ChainedCommands };
  }

  function widths(tableIndex = 0): number[] {
    const tables: PMNode[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'table') tables.push(node);
    });
    const result: number[] = [];
    tables[tableIndex]!.firstChild!.forEach((cell) => {
      result.push(...((cell.attrs['colwidth'] as number[] | null) ?? [0]));
    });
    return result;
  }

  it.each([
    { side: 'before' as const, expected: [100, 300, 100, 100] },
    { side: 'after' as const, expected: [300, 100, 100, 100] },
  ])('applies the width policy through addColumn $side', ({ side, expected }) => {
    mount();
    selectCell('A');
    const result = side === 'before' ? editor.commands.addColumnBefore() : editor.commands.addColumnAfter();
    expect(result).toBe(true);
    expect(widths()).toEqual(expected);
  });

  it('keeps all existing widths through an unconstrained editor command', () => {
    mount(ASYMMETRIC_TABLE, false);
    selectCell('A');
    expect(editor.commands.addColumnAfter()).toBe(true);
    expect(widths()).toEqual([400, 100, 100, 100]);
  });

  it('does not dispatch a chained insertion before run', () => {
    mount();
    selectCell('A');
    const previous = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    const chain = editor.chain().addColumnAfter();
    expect(editor.state.doc.eq(previous)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(chain.run()).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(widths()).toEqual([300, 100, 100, 100]);
  });

  it('does not change the document when a later command fails', () => {
    mount();
    selectCell('A');
    const previous = editor.state.doc;
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    expect(customChain(editor.chain().addColumnAfter()).command(() => false).run()).toBe(false);
    expect(editor.state.doc.eq(previous)).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses a selection changed earlier in the same chain', () => {
    mount();
    selectCell('A');
    const result = customChain().command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(findCell(tr.doc, 'C') + 1)));
      return true;
    }).addColumnBefore().run();
    expect(result).toBe(true);
    expect(widths()).toEqual([400, 75, 100, 25]);
  });

  it('uses widths produced by the preceding insertion in a chain', () => {
    mount();
    selectCell('A');
    expect(editor.chain().addColumnAfter().addColumnAfter().run()).toBe(true);
    expect(widths()).toEqual([200, 100, 100, 100, 100]);
  });

  it('retains measurements when earlier chain edits move the table in the document', () => {
    mount('<p>Lead</p>' + ASYMMETRIC_TABLE);
    selectCell('A');
    expect(customChain().command(({ tr }) => {
      tr.insertText('A longer introduction. ', 1);
      return true;
    }).addColumnAfter().run()).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe('A longer introduction. Lead');
    expect(widths()).toEqual([300, 100, 100, 100]);
  });

  it('measures the selected table when preceding edits shift multiple tables', () => {
    mount('<p>Lead</p><table><tr><td data-colwidth="100">Other</td><td data-colwidth="100">Table</td></tr></table>' + ASYMMETRIC_TABLE, true, [250, 600]);
    selectCell('A');
    expect(customChain().command(({ tr }) => {
      tr.insertText('Introduction that moves both tables. ', 1);
      return true;
    }).addColumnAfter().run()).toBe(true);
    expect(widths(0)).toEqual([100, 100]);
    expect(widths(1)).toEqual([300, 100, 100, 100]);
  });

  it('retains the container constraint after replacing table markup in a chain', () => {
    mount();
    selectCell('A');
    expect(customChain().command(({ tr }) => {
      tr.setNodeMarkup(0, null, { ...tr.doc.firstChild!.attrs });
      return true;
    }).addColumnAfter().run()).toBe(true);
    expect(widths()).toEqual([300, 100, 100, 100]);
  });

  it('retains stored widths and the container constraint after inserting the first row in a chain', () => {
    mount();
    selectCell('A');
    expect(editor.chain().addRowBefore().addColumnAfter().run()).toBe(true);
    expect(widths()).toEqual([300, 100, 100, 100]);
    const table = editor.state.doc.firstChild!;
    expect(table.childCount).toBe(2);
    const originalRowWidths: number[] = [];
    table.child(1).forEach((cell) => {
      originalRowWidths.push(...(cell.attrs['colwidth'] as number[]));
    });
    expect(originalRowWidths).toEqual([300, 100, 100, 100]);
  });

  it('retains the container constraint through both table markup and first-row insertion steps', () => {
    mount();
    selectCell('A');
    expect(customChain().command(({ tr }) => {
      tr.setNodeMarkup(0, null, { ...tr.doc.firstChild!.attrs });
      return true;
    }).addRowBefore().addColumnAfter().run()).toBe(true);
    expect(widths()).toEqual([300, 100, 100, 100]);
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
  });

  it('supports inserting into a table created earlier in the same chain', () => {
    mount('<p></p>');
    expect(editor.chain().insertTable({ rows: 2, cols: 3, withHeaderRow: false }).addColumnAfter().run()).toBe(true);
    expect(widths()).toEqual([0, 0, 0, 0]);
  });

  it('undoes and redoes insertion with all affected widths as one document change', () => {
    mount();
    selectCell('A');
    const previous = editor.state.doc;
    expect(editor.commands.addColumnAfter()).toBe(true);
    const inserted = editor.state.doc;
    expect(widths()).toEqual([300, 100, 100, 100]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.eq(previous)).toBe(true);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.state.doc.eq(inserted)).toBe(true);
  });

  it('undoes a chain containing multiple insertions atomically', () => {
    mount();
    selectCell('A');
    const previous = editor.state.doc;
    expect(editor.chain().addColumnAfter().addColumnBefore().run()).toBe(true);
    const inserted = editor.state.doc;
    expect(widths()).toEqual([100, 200, 100, 100, 100]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.eq(previous)).toBe(true);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.state.doc.eq(inserted)).toBe(true);
  });

  it('can checks have no document side effects', () => {
    mount();
    selectCell('A');
    const previous = editor.state.doc;
    expect(editor.can().addColumnBefore()).toBe(true);
    expect(editor.can().addColumnAfter()).toBe(true);
    expect(editor.state.doc.eq(previous)).toBe(true);
  });
});
