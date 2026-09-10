import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { EditorState, TextSelection } from '@domternal/pm/state';
import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import { CellSelection, TableMap, tableEditingKey } from '@domternal/pm/tables';
import { Table, TableRow, TableCell, TableHeader } from '../index.js';
import { changedTableHoldsUnsupportedSpan, guardedTableEditing, tableHoldsUnsupportedSpan } from './guardedTableEditing.js';

const extensions = [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader];
/** A node type of the schema, which the table extensions always define. */
function nodeType(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`No ${name} node`);
  return type;
}

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); document.body.replaceChildren(); });

function mount(content = '<p></p>'): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions, content });
  editors.push(editor);
  return editor;
}

/** A 2x2 table whose first cell holds the given attributes, built without validation. */
function table(schema: Schema, first: Record<string, unknown>, inner?: PMNode): PMNode {
    const paragraph = (text: string): PMNode => nodeType(schema, 'paragraph').create(null, schema.text(text));
  const cell = (text: string, attrs: Record<string, unknown> | null = null): PMNode =>
    nodeType(schema, 'tableCell').create(attrs, text === 'nested' && inner ? [inner] : [paragraph(text)]);
  return nodeType(schema, 'table').create(null, [
    nodeType(schema, 'tableRow').create(null, [cell('a', first), cell('b')]),
    nodeType(schema, 'tableRow').create(null, [cell('c'), cell(inner ? 'nested' : 'd')]),
  ]);
}

function hold(editor: Editor, doc: PMNode): void {
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }));
}

function typeInCell(editor: Editor, text: string, target: string): void {
  let pos = 0;
  editor.state.doc.descendants((node, at) => { if (node.isText && node.text === target) pos = at + node.nodeSize; });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).insertText(text));
}

const cellTexts = (doc: PMNode): string[] => {
  const found: string[] = [];
  doc.descendants(node => { if (node.type.name === 'tableCell') found.push(node.textContent); });
  return found;
};

describe('tableHoldsUnsupportedSpan', () => {
  it.each([[-1], [0], [1.5], ['2'], [null], [1001], [1e6], [Number.NaN]])('finds a cell with span %j', value => {
    const { schema } = mount();
    expect(tableHoldsUnsupportedSpan(table(schema, { colspan: value }))).toBe(true);
    expect(tableHoldsUnsupportedSpan(table(schema, { rowspan: value }))).toBe(true);
  });

  it.each([[1], [2], [1000]])('accepts a table whose spans are all %j or 1', value => {
    const { schema } = mount();
    expect(tableHoldsUnsupportedSpan(table(schema, { colspan: value, rowspan: value }))).toBe(false);
  });

  it('judges only the cells of the table itself, not those of a nested table', () => {
    const { schema } = mount();
    const inner = table(schema, { colspan: -1 });
    expect(tableHoldsUnsupportedSpan(table(schema, {}, inner))).toBe(false);
  });
});

describe('changedTableHoldsUnsupportedSpan', () => {
  it('finds a changed table that holds an unsupported span, nested ones included', () => {
    const { schema } = mount();
    const doc = (t: PMNode): PMNode => nodeType(schema, 'doc').create(null, [t, nodeType(schema, 'paragraph').create(null, schema.text('tail'))]);
    const bad = table(schema, { colspan: -1 });
    const before = doc(bad);
    const after = doc(table(schema, { colspan: -1 }));
    expect(changedTableHoldsUnsupportedSpan(before, after)).toBe(true);
    expect(changedTableHoldsUnsupportedSpan(before, before)).toBe(false);

    const nestedBefore = doc(table(schema, {}, table(schema, { rowspan: 0 })));
    const nestedAfter = doc(table(schema, {}, table(schema, { rowspan: 0 })));
    expect(changedTableHoldsUnsupportedSpan(nestedBefore, nestedAfter)).toBe(true);
  });

  it('ignores a table that did not change', () => {
    const { schema } = mount();
    const bad = table(schema, { colspan: -1 });
    const para = (text: string): PMNode => nodeType(schema, 'paragraph').create(null, schema.text(text));
    const before = nodeType(schema, 'doc').create(null, [bad, para('tail')]);
    const after = nodeType(schema, 'doc').create(null, [bad, para('tail!')]);
    expect(changedTableHoldsUnsupportedSpan(before, after)).toBe(false);
  });
});

describe('guardedTableEditing', () => {
  it('keeps the tableEditing key, so cell selections and table commands work as before', () => {
    expect(guardedTableEditing().spec.key).toBe(tableEditingKey);
    const editor = mount('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    expect(editor.state.plugins.filter(plugin => plugin.spec.key === tableEditingKey)).toHaveLength(1);
    let first = 0;
    let last = 0;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') { if (!first) first = pos; last = pos; } });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, first, last)));
    expect(editor.commands.mergeCells()).toBe(true);
    expect(cellTexts(editor.state.doc)).toHaveLength(1);
  });

  it.each([[-1], [0], ['2'], [1.5], ['abc'], [null]])('leaves a table holding colspan %j to the migration when an edit changes it', value => {
    const editor = mount();
    const doc = nodeType(editor.schema, 'doc').create(null, [table(editor.schema, { colspan: value })]);
    hold(editor, doc);

    typeInCell(editor, '!', 'd');

    expect(cellTexts(editor.state.doc)).toEqual(['a', 'b', 'c', 'd!']);
    let span: unknown;
    editor.state.doc.descendants(node => { if (span === undefined && node.type.name === 'tableCell') span = node.attrs['colspan']; });
    expect(span).toEqual(value);
  });

  it('lets fixTables repair the table once normalizeContentAttributes replaced the span', () => {
    const editor = mount();
    hold(editor, nodeType(editor.schema, 'doc').create(null, [table(editor.schema, { colspan: '2' })]));

    expect(editor.commands.normalizeContentAttributes()).toBe(true);

    const repaired = editor.state.doc.child(0);
    expect(repaired.firstChild?.firstChild?.attrs['colspan']).toBe(2);
    expect(TableMap.get(repaired).problems ?? null).toBeNull();
    expect(editor.getText()).toContain('d');
  });

  it('still repairs a table whose spans are all supported', () => {
    const editor = mount();
    hold(editor, nodeType(editor.schema, 'doc').create(null, [table(editor.schema, { colspan: 3 })]));

    typeInCell(editor, '!', 'd');

    expect(TableMap.get(editor.state.doc.child(0)).problems ?? null).toBeNull();
  });

  it('repairs another changed table in the same document when its spans are supported', () => {
    const editor = mount();
    const { schema } = editor;
    hold(editor, nodeType(schema, 'doc').create(null, [table(schema, { colspan: -1 }), table(schema, { colspan: 3 })]));
    const [bad, good] = [editor.state.doc.child(0), editor.state.doc.child(1)];

    // An edit in the table with only supported spans leaves the other table untouched.
    let pos = 0;
    editor.state.doc.descendants((node, at) => { if (node.isText && node.text === 'd' && at > bad.nodeSize) pos = at + 1; });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).insertText('!'));

    expect(editor.state.doc.child(0)).toBe(bad);
    expect(editor.state.doc.child(1)).not.toBe(good);
    expect(TableMap.get(editor.state.doc.child(1)).problems ?? null).toBeNull();
  });
});
