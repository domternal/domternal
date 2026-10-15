import { afterEach, expect, it, vi } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { CellSelection } from '@domternal/pm/tables';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); vi.restoreAllMocks(); });

it('builds table controls and their menus when HTML string sinks are unavailable', () => {
  const rejectHTML = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(() => {
    throw new TypeError('TrustedHTML required');
  });
  editor = new Editor({
    extensions: [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader],
    content: { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] },
    ] }] }] },
  });
  const root = editor.view.dom;
  const buttons = [
    ['.dm-table-row-handle', '.dm-table-controls-dropdown-icon', 3],
    ['.dm-table-col-handle', '.dm-table-controls-dropdown-icon', 3],
    ['button[aria-label="Cell color"]', '.dm-color-palette-reset', 1],
    ['button[aria-label="Alignment"]', '.dm-table-align-item-icon', 6],
  ] as const;
  for (const [selector, menuIcon, count] of buttons) {
    const button = root.querySelector<HTMLButtonElement>(selector);
    expect(button, selector).not.toBeNull();
    expect(button?.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 2, 2)));
    button?.click();
    const icons = document.querySelectorAll(`${menuIcon} svg`);
    expect(icons.length, selector).toBe(count);
    for (const icon of Array.from(icons)) {
      expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(icon.firstElementChild?.namespaceURI).toBe(icon.namespaceURI);
    }
  }
  expect(rejectHTML).not.toHaveBeenCalled();
});
