import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, History, Paragraph, Text, generateHTML } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import type { TableCellLayout, TableLayoutSettings, TableRowLayout } from './TableLayout.js';
import { TextSelection } from '@domternal/pm/state';
import { Table } from './Table.js';
import { TableLayout } from './TableLayout.js';
import { getNodeTableCellLayout, getNodeTableLayout, getNodeTableRowLayout, readTableCellLayout, readTableLayout, readTableRowLayout, tableLength } from './helpers/tableLayout.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function create(content = '<table><tr><th>Heading</th><th>Other</th></tr><tr><td>Body</td><td>Other</td></tr></table>', layout = true): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text, History, Table, ...(layout ? [TableLayout] : [])], content });
  editors.push(editor);
  return editor;
}
function selectFirst(editor: Editor): void { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4))); }

describe('optional table layout', () => {
  it('accepts typed layout values in the public JSON content format', () => {
    const tableLayout: TableLayoutSettings = { breakBefore: 'page' };
    const rowLayout: TableRowLayout = { height: 80, allowSplit: false };
    const cellLayout: TableCellLayout = { padding: { left: 12 }, borders: { top: { width: 2, style: 'dashed', color: '#123456' } } };
    const content: JSONContent = { type: 'table', attrs: { tableLayout }, content: [
      { type: 'tableRow', attrs: { rowLayout }, content: [{ type: 'tableCell', attrs: { cellLayout }, content: [{ type: 'paragraph' }] }] },
    ] };
    const editor = create(); editor.commands.setContent({ type: 'doc', content: [content] });
    expect(getNodeTableRowLayout(editor.state.doc.child(0).child(0))).toEqual(rowLayout);
    expect(getNodeTableCellLayout(editor.state.doc.child(0).child(0).child(0))).toEqual(cellLayout);
  });

  it('does not change the default Table schema or stored content', () => {
    const editor = create(undefined, false);
    expect(editor.schema.nodes['table']?.spec.attrs ?? {}).not.toHaveProperty('tableLayout');
    expect(editor.schema.nodes['tableRow']?.spec.attrs ?? {}).not.toHaveProperty('rowLayout');
    expect(editor.schema.nodes['tableCell']?.spec.attrs).not.toHaveProperty('cellLayout');
    expect(editor.commands.setTableRowLayout({ height: 20 })).toBe(false);
    expect(getNodeTableLayout(editor.state.doc.child(0))).toBeNull();
  });

  it('sets and clears row, cell and table geometry with commands, dry runs and undo', () => {
    const editor = create(); selectFirst(editor);
    const before = editor.getJSON();
    expect(editor.can().setTableRowLayout({ height: 64, heightRule: 'exact', allowSplit: false })).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.commands.setTableRowLayout({ height: 64, heightRule: 'exact', allowSplit: false })).toBe(true);
    expect(getNodeTableRowLayout(editor.state.doc.child(0).child(0))).toEqual({ height: 64, heightRule: 'exact', allowSplit: false });
    expect(editor.view.dom.querySelector('tr')?.style.height).toBe('64px');
    editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
    editor.commands.setTableCellLayout({ padding: { left: 0, top: 12 }, borders: { right: { width: 2, style: 'dashed', color: '#aabbcc' } } });
    expect(getNodeTableCellLayout(editor.state.doc.child(0).child(0).child(0))?.padding).toEqual({ top: 12, left: 0 });
    expect(editor.view.dom.querySelector('th')?.style.paddingLeft).toBe('0px');
    editor.commands.setTableLayout({ breakBefore: 'page' });
    expect(editor.view.dom.querySelector<HTMLElement>('.dm-table-container')?.style.breakBefore).toBe('page');
    editor.commands.setTableLayout(null); editor.commands.setTableCellLayout(null);
    expect(editor.view.dom.querySelector<HTMLElement>('.dm-table-container')?.style.breakBefore).toBe('');
    expect(editor.view.dom.querySelector('th')?.style.paddingLeft).toBe('');
  });

  it('applies a cell selection to every selected cell and row without touching neighbours', () => {
    const editor = create(); const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') cells.push(pos); });
    editor.commands.setCellSelection({ anchorCell: cells[0] ?? 2, headCell: cells[2] ?? 20 });
    editor.commands.setTableCellLayout({ padding: { bottom: 7 } });
    editor.commands.setTableRowLayout({ allowSplit: false });
    const table = editor.state.doc.child(0);
    for (let row = 0; row < 2; row++) {
      expect(getNodeTableRowLayout(table.child(row))).toEqual({ allowSplit: false });
      expect(getNodeTableCellLayout(table.child(row).child(0))).toEqual({ padding: { bottom: 7 } });
      expect(getNodeTableCellLayout(table.child(row).child(1))).toBeNull();
    }
  });

  it('roundtrips all stored settings through HTML while preserving cell background', () => {
    const editor = create(); selectFirst(editor);
    editor.commands.setCellAttribute('background', '#ffeedd');
    editor.commands.setTableLayout({ breakBefore: 'page' });
    editor.commands.setTableRowLayout({ height: 80, heightRule: 'exact', allowSplit: false });
    editor.commands.setTableCellLayout({ padding: { top: 1, right: 2, bottom: 3, left: 4 }, borders: {
      top: { width: 2, style: 'double', color: '#112233' }, bottom: { width: 0, style: 'none', color: '#000000' },
    } });
    expect(editor.view.dom.querySelector('th')?.style.backgroundColor).toBe('rgb(255, 238, 221)');
    const html = editor.getHTML(); const loaded = create(html);
    expect(loaded.getJSON()).toEqual(editor.getJSON());
    expect(create(generateHTML(editor.getJSON(), [Document, Paragraph, Text, Table, TableLayout])).getJSON()).toEqual(editor.getJSON());
  });

  it('parses bounded explicit physical HTML sizes and opaque border colors', () => {
    const editor = create('<table style="page-break-before:always"><tr style="height:36pt;break-inside:avoid"><td style="padding:2mm 3px;border-left:2px dashed #abcdef">Text</td></tr></table>');
    const table = editor.state.doc.child(0); const row = table.child(0);
    expect(getNodeTableLayout(table)).toEqual({ breakBefore: 'page' });
    expect(getNodeTableRowLayout(row)).toEqual({ height: 48, allowSplit: false });
    expect(getNodeTableCellLayout(row.child(0))).toEqual({ padding: { top: 7.5591, right: 3, bottom: 7.5591, left: 3 }, borders: { left: { width: 2, style: 'dashed', color: '#abcdef' } } });
  });

  it.each([NaN, Infinity, -1, 0, 5000, '20px', [], {}, { height: 10, extra: true }])('rejects invalid row layout %j without a transaction', value => {
    const editor = create(); selectFirst(editor); const before = editor.getJSON();
    expect(editor.commands.setTableRowLayout(value as never)).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it('drops malformed HTML data and never writes unsafe CSS or resource URLs', () => {
    const editor = create('<table><tr data-dm-rowLayout="{&quot;height&quot;:&quot;1px;background:url(https://bad.example)&quot;}"><td data-dm-cellLayout="{&quot;padding&quot;:{&quot;left&quot;:99999}}">Safe</td></tr></table>');
    expect(getNodeTableRowLayout(editor.state.doc.child(0).child(0))).toBeNull();
    expect(getNodeTableCellLayout(editor.state.doc.child(0).child(0).child(0))).toBeNull();
    expect(editor.getHTML()).not.toContain('bad.example');
    expect(editor.getHTML()).not.toContain('99999');
  });
});

describe('bounded layout contract', () => {
  it.each([['1in', 96], ['2.54cm', 96], ['25.4mm', 96], ['72pt', 96], ['3px', 3], ['0', 0], ['10%', undefined], ['calc(1px)', undefined], ['-1px', undefined]])('parses %s as %s', (value, expected) => {
    expect(tableLength(value, 0, 256)).toBe(expected);
  });
  it('validates all geometry dimensions, keys, colors and styles', () => {
    expect(readTableRowLayout({ height: 4096, heightRule: 'atLeast', allowSplit: true })).not.toBeNull();
    expect(readTableRowLayout({ heightRule: 'exact' })).toBeNull();
    expect(readTableRowLayout({ height: 24, allowSplit: 'no' })).toBeNull();
    expect(readTableLayout({ breakBefore: 'always' })).toBeNull();
    for (const value of [{ padding: { left: 257 } }, { padding: { bogus: 2 } }, { borders: { top: { width: 17, style: 'solid', color: '#000000' } } }, { borders: { top: { width: 1, style: 'solid', color: 'red;display:none' } } }, { borders: { top: { width: 1, style: { toString: () => 'solid' }, color: '#000000' } } }]) expect(readTableCellLayout(value)).toBeNull();
  });
});
