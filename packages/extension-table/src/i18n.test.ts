import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text, type I18nOptions } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import { Table } from './Table.js';
import { tableViewMap } from './TableView.js';
import { tableMessages } from './messages.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
function createEditor(i18n?: I18nOptions): Editor {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  hosts.push(host);
  const editor = new Editor({ element: host, extensions: [Document, Paragraph, Text, Table],
    content: '<table><tr><td><p>Original cell</p></td><td><p>B</p></td></tr></table>',
    ...(i18n ? { i18n } : {}),
  });
  editors.push(editor);
  return editor;
}
function element(root: ParentNode, selector: string): HTMLElement {
  const result = root.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing element: ${selector}`);
  return result;
}
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  hosts.splice(0).forEach(host => { host.remove(); });
  vi.restoreAllMocks();
});

describe('table UI localization', () => {
  it.each(['row', 'column'] as const)('patches an open %s menu without replacing focused buttons or the document', (kind) => {
    const editor = createEditor();
    const container = element(editor.view.dom, '.dm-table-container');
    const cell = element(container, 'td');
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);
    cell.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    element(container, kind === 'row' ? '.dm-table-row-handle' : '.dm-table-col-handle').click();
    const menu = element(document, '.dm-table-controls-dropdown');
    const button = element(menu, 'button');
    button.focus();
    const view = tableViewMap.get(container);
    const state = editor.state;
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    editor.i18n.set({ locale: 'hr', messages: {
      'table.controls.rowOptions': 'Opcije retka', 'table.controls.columnOptions': 'Opcije stupca',
      'table.row.insertAbove': '<b>Redak iznad</b>', 'table.column.insertLeft': '<b>Stupac lijevo</b>',
    } });
    expect(element(document, '.dm-table-controls-dropdown')).toBe(menu);
    expect(element(menu, 'button')).toBe(button);
    expect(button.textContent).toBe(kind === 'row' ? '<b>Redak iznad</b>' : '<b>Stupac lijevo</b>');
    expect(button.lang).toBe('hr');
    expect(menu.querySelector('b')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(tableViewMap.get(container)).toBe(view);
    expect(editor.state).toBe(state);
    expect(editor.state.doc.textContent).toBe('Original cellB');
    expect(transaction).not.toHaveBeenCalled();
    button.click();
    expect(editor.state.doc.firstChild?.childCount).toBe(kind === 'row' ? 2 : 1);
    expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(kind === 'column' ? 3 : 2);
  });

  it('updates color and alignment menus, releases closed controls, and keeps schema values stable', () => {
    const editor = createEditor();
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 2)));
    const toolbar = element(editor.view.dom, '.dm-table-cell-toolbar');
    element(toolbar, '[aria-label="Cell color"]').click();
    const palette = element(document, '.dm-color-palette');
    const reset = element(palette, '.dm-color-palette-reset');
    const swatch = element(palette, '.dm-color-swatch');
    const color = swatch.style.backgroundColor;
    const state = editor.state;
    editor.i18n.set({ locale: 'hr', messages: {
      'table.cell.backgroundColor': 'Boja ćelije', 'table.cell.defaultColor': 'Zadana boja',
      'table.cell.defaultColorText': '<b>Zadano</b>', 'table.cell.color': ({ color: value }) => `Boja ${value}`,
      'table.controls.alignment': 'Poravnanje', 'table.cell.alignRight': 'Desno',
    } });
    expect(reset.textContent).toBe(' <b>Zadano</b>');
    expect(reset.getAttribute('aria-label')).toBe('Zadana boja');
    expect(swatch.getAttribute('aria-label')).toBe('Boja #fef08a');
    expect(swatch.style.backgroundColor).toBe(color);
    expect(editor.state).toBe(state);
    expect(palette.querySelector('b')).toBeNull();
    element(toolbar, '[aria-label="Poravnanje"]').click();
    expect(palette.isConnected).toBe(false);
    const right = element(document, '.dm-table-align-item[aria-label="Desno"]');
    editor.i18n.set({ locale: 'de', messages: { 'table.cell.alignRight': 'Rechts' } });
    expect(right.getAttribute('aria-label')).toBe('Rechts');
    expect(reset.textContent).toBe(' <b>Zadano</b>');
    right.click();
    expect(editor.state.doc.nodeAt(2)?.attrs['textAlign']).toBe('right');
  });

  it('localizes actions and isolates node-view labels between editor instances', () => {
    const first = createEditor();
    const second = createEditor();
    first.i18n.set({ locale: 'hr', messages: {
      'table.toolbar.insert': 'Umetni tablicu', 'table.insert.label': 'Tablica',
      'table.controls.cellOptions': 'Opcije ćelije',
    }, searchAliases: { 'table.insert.label': ['mreža'] } });
    expect(first.toolbarItems.find(item => item.name === 'table')).toMatchObject({ label: 'Umetni tablicu', command: 'insertTable' });
    expect(first.floatingMenuItems.find(item => item.name === 'table')).toMatchObject({ label: 'Tablica', keywords: ['mreža', 'table'] });
    const firstHandle = element(first.view.dom, '.dm-table-cell-handle');
    expect(firstHandle.getAttribute('aria-label')).toBe('Opcije ćelije');
    expect(element(second.view.dom, '.dm-table-cell-handle').getAttribute('aria-label')).toBe('Cell options');
    expect(first.i18n.resolve(tableMessages.deleteRow)).toMatchObject({ text: 'Delete Row', language: 'en' });
    first.destroy();
    second.i18n.set({ locale: 'de', messages: { 'table.controls.cellOptions': 'Zellenoptionen' } });
    expect(firstHandle.getAttribute('aria-label')).toBe('Opcije ćelije');
    expect(element(second.view.dom, '.dm-table-cell-handle').getAttribute('aria-label')).toBe('Zellenoptionen');
  });
});
