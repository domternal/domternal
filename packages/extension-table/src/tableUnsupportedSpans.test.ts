/**
 * A table that holds a span loading would replace, such as one a 1.2.0 client or a crafted update
 * wrote into a shared document: 0, -1, NaN, the string "2", 1.5 or a million. prosemirror-tables
 * builds its table map from the stored spans, cell by cell for every spanned row and column, so
 * such a map is wrong (a paste deletes a neighbouring cell or throws "No cell with offset") or
 * huge (a colspan of a million takes gigabytes). Until normalizeContentAttributes replaces the
 * span, the table is left to text editing: no table map is built for it, a paste of cells puts
 * their content at the caret, and cell selections, table commands, the row and column handles and
 * column resizing leave it alone. After the migration everything works on it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { EditorState, NodeSelection, TextSelection } from '@domternal/pm/state';
import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import { CellSelection, TableMap, columnResizingPluginKey, tableEditingKey } from '@domternal/pm/tables';
import { Table, TableRow, TableCell, TableHeader } from './index.js';
import { tableHoldsUnsupportedSpan } from './helpers/guardedTableEditing.js';

const extensions = [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader];
const editors: Editor[] = [];
const mapped: PMNode[] = [];
beforeEach(() => {
  // Building a table map for an unsupported table is the failure: record it and refuse it, so a
  // span of a million cannot exhaust memory here.
  const get = TableMap.get.bind(TableMap);
  vi.spyOn(TableMap, 'get').mockImplementation(table => {
    if (tableHoldsUnsupportedSpan(table)) {
      mapped.push(table);
      throw new Error('A table map of a table that holds an unsupported span');
    }
    return get(table);
  });
});
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  mapped.length = 0;
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function nodeType(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`No ${name} node`);
  return type;
}

const SPANS: [string, unknown][] = [['0', 0], ['-1', -1], ['NaN', NaN], ['"2"', '2'], ['1.5', 1.5], ['a million', 1_000_000]];

/** An editor holding a 2x3 table, rows a b c and d e f, whose cell b has the given colspan, built without validation. */
function mount(colspan: unknown): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions, content: '<p></p>' });
  editors.push(editor);
  const { schema } = editor;
  const cell = (text: string, attrs: Record<string, unknown> | null = null): PMNode =>
    nodeType(schema, 'tableCell').create(attrs, nodeType(schema, 'paragraph').create(null, schema.text(text)));
  const table = nodeType(schema, 'table').create(null, [
    nodeType(schema, 'tableRow').create(null, [cell('a'), cell('b', { colspan }), cell('c')]),
    nodeType(schema, 'tableRow').create(null, [cell('d'), cell('e'), cell('f')]),
  ]);
  const doc = nodeType(schema, 'doc').create(null, [table, nodeType(schema, 'paragraph').create(null, schema.text('after'))]);
  editor.view.updateState(EditorState.create({ schema, doc, plugins: editor.state.plugins }));
  return editor;
}

/** The position of the cell that holds this text. */
function cellPos(editor: Editor, text: string): number {
  let found: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found === undefined && node.type.spec['tableRole'] === 'cell' && node.textContent === text) found = pos;
  });
  if (found === undefined) throw new Error(`No cell ${text}`);
  return found;
}

function caretIn(editor: Editor, text: string): void {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, cellPos(editor, text) + 2)));
}

const words = (editor: Editor): string => {
  const texts: string[] = [];
  editor.state.doc.descendants(node => { if (node.isTextblock) texts.push(node.textContent); });
  return texts.join('|');
};

function pasteHTML(editor: Editor, html: string): void {
  editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent);
}

describe.each(SPANS)('a table whose cell holds a colspan of %s', (_name, colspan) => {
  it('pastes copied cells as their content at the caret, deleting no cell and building no table map', () => {
    for (const target of ['a', 'd', 'f']) {
      const editor = mount(colspan);
      caretIn(editor, target);
      expect(() => { pasteHTML(editor, '<table><tbody><tr><td><p>S</p></td><td><p>T</p></td></tr></tbody></table>'); }).not.toThrow();
      expect(words(editor)).toBe(['a', 'b', 'c', 'd', 'e', 'f'].map(text => (text === target ? `S|T${text}` : text)).join('|') + '|after');
      expect(editor.state.doc.child(0).child(0).child(1).attrs['colspan']).toBe(colspan);
    }
    expect(mapped).toEqual([]);
  });

  it('pastes into a cell selection it cannot make, and into a paragraph of the cell, without a table map', () => {
    const editor = mount(colspan);
    caretIn(editor, 'e');
    pasteHTML(editor, '<p>plain</p>');
    expect(words(editor)).toBe('a|b|c|d|plaine|f|after');
    expect(mapped).toEqual([]);
  });

  it('refuses the table commands and cell selections, which would build its table map', () => {
    const editor = mount(colspan);
    caretIn(editor, 'e');
    const before = editor.state.doc;
    for (const command of ['addRowBefore', 'addRowAfter', 'deleteRow', 'addColumnBefore', 'addColumnAfter', 'deleteColumn',
      'toggleHeaderRow', 'toggleHeaderColumn', 'toggleHeaderCell', 'mergeCells', 'splitCell'] as const) {
      expect(editor.can()[command](), command).toBe(false);
      expect(editor.commands[command](), command).toBe(false);
    }
    expect(editor.commands.setCellSelection({ anchorCell: cellPos(editor, 'a'), headCell: cellPos(editor, 'e') })).toBe(false);
    expect(editor.state.doc).toBe(before);
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(mapped).toEqual([]);
  });

  it('keeps typing, moving to the next cell and deleting the table working', () => {
    const editor = mount(colspan);
    caretIn(editor, 'a');
    editor.commands.insertContent('x');
    expect(editor.commands.goToNextCell()).toBe(true);
    expect(editor.state.selection.$from.parent.textContent).toBe('b');
    expect(editor.commands.deleteTable()).toBe(true);
    expect(words(editor)).toBe('after');
    expect(mapped).toEqual([]);
  });

  it('leaves keys, triple clicks, shift clicks and a selected cell to plain text editing', () => {
    const editor = mount(colspan);
    const { view } = editor;
    const editing = editor.state.plugins.find(plugin => plugin.spec.key === tableEditingKey);
    if (!editing) throw new Error('No tableEditing plugin');
    caretIn(editor, 'b');
    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
      expect(editing.props.handleKeyDown?.call(editing, view, new KeyboardEvent('keydown', { key, shiftKey: key === 'ArrowDown' }))).toBe(false);
    }
    expect(editing.props.handleTripleClick?.call(editing, view, cellPos(editor, 'e') + 2, new MouseEvent('click'))).toBe(false);
    const cell = view.nodeDOM(cellPos(editor, 'e')) as HTMLElement;
    const mousedown = editing.props.handleDOMEvents?.mousedown;
    const event = new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true });
    Object.defineProperty(event, 'target', { value: cell });
    expect(mousedown?.call(editing, view, event)).toBe(false);
    view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, cellPos(editor, 'e'))));
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
    expect(mapped).toEqual([]);
  });

  it('shows no row, column or cell handle and starts no column resize', () => {
    const editor = mount(colspan);
    const { view } = editor;
    const cell = view.nodeDOM(cellPos(editor, 'e')) as HTMLElement;
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    const container = view.dom.querySelector('.dm-table-container');
    expect(container?.querySelector<HTMLElement>('.dm-table-col-handle')?.style.display).toBe('');
    expect(container?.querySelector<HTMLElement>('.dm-table-row-handle')?.style.display).toBe('');
    caretIn(editor, 'e');
    expect(container?.querySelector<HTMLElement>('.dm-table-cell-handle')?.style.display ?? '').toBe('');
    view.dispatch(editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos(editor, 'e') }));
    // A handle set before the table held the span draws nothing and drags nothing.
    expect(view.dom.querySelector('.column-resize-handle')).toBeNull();
    const event = new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 1, clientY: 1 });
    Object.defineProperty(event, 'target', { value: cell });
    view.someProp('handleDOMEvents', handlers => { handlers.mousedown?.call(undefined, view, event); });
    // Moving over it clears the handle.
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(columnResizingPluginKey.getState(editor.state)?.activeHandle).toBe(-1);
    expect(mapped).toEqual([]);
  });

  it('keeps a text selection dragged across its cells within one cell, so typing or pasting over it deletes no cell', () => {
    const editor = mount(colspan);
    const { view } = editor;
    const inside = (text: string, offset: number): number => cellPos(editor, text) + 2 + offset;
    // As a mouse drag from a into e makes where no cell selection can be made.
    view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inside('a', 0), inside('e', 1))));
    expect(editor.state.selection.from).toBe(inside('a', 0));
    expect(editor.state.selection.to).toBe(inside('a', 1));
    pasteHTML(editor, '<table><tbody><tr><td><p>S</p></td></tr></tbody></table>');
    expect(words(editor)).toBe('S|b|c|d|e|f|after');

    // Backwards, from e into a, and from the paragraph after the table into it.
    view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inside('e', 1), inside('S', 0))));
    expect(editor.state.selection.from).toBe(inside('e', 0));
    view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1, inside('c', 0))));
    expect(editor.state.selection.from).toBeGreaterThan(cellPos(editor, 'f'));
    editor.commands.insertContent('x');
    expect(words(editor)).toBe('S|b|c|d|e|f|x');
    expect(editor.state.doc.child(0).child(0).childCount).toBe(3);
    expect(mapped).toEqual([]);
  });

  it('works as a table again once normalizeContentAttributes replaced the span', () => {
    const editor = mount(colspan);
    expect(editor.commands.normalizeContentAttributes()).toBe(true);
    caretIn(editor, 'e');
    expect(editor.commands.addRowAfter()).toBe(true);
    expect(editor.commands.setCellSelection({ anchorCell: cellPos(editor, 'a'), headCell: cellPos(editor, 'e') })).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    expect(mapped).toEqual([]);
  });
});

describe('a cell paste that fails', () => {
  it('reports the error through the editor and pastes the cells\' content at the caret, throwing nothing to the page', () => {
    const errors: { error: Error; context: string }[] = [];
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')), extensions,
      content: '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
      onError: ({ error, context }) => { errors.push({ error, context }); },
    });
    editors.push(editor);
    caretIn(editor, 'a');
    const failure = new Error('an unexpected table map failure');
    vi.spyOn(TableMap, 'get').mockImplementationOnce(() => { throw failure; });

    expect(() => { pasteHTML(editor, '<table><tbody><tr><td><p>S</p></td></tr></tbody></table>'); }).not.toThrow();

    expect(errors).toEqual([{ error: failure, context: 'Table.paste' }]);
    expect(words(editor)).toBe('Sa|b');
  });
});
