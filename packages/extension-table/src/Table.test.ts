
import { describe, it, expect, afterEach } from 'vitest';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { TableView } from './TableView.js';
import { createTable } from './helpers/createTable.js';
import { cellAttributes } from './helpers/cellAttributes.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';

type AnyJson = any;

const allExtensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];

// === Table Node Configuration ===

describe('Table', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Table.name).toBe('table');
    });

    it('is a node type', () => {
      expect(Table.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Table.config.group).toBe('block');
    });

    it('has correct content spec', () => {
      expect(Table.config.content).toBe('tableRow+');
    });

    it('has table tableRole', () => {
      expect(Table.config.tableRole).toBe('table');
    });

    it('is isolating', () => {
      expect(Table.config.isolating).toBe(true);
    });

    it('has default options', () => {
      expect(Table.options).toEqual({
        HTMLAttributes: {},
        cellMinWidth: 25,
        defaultCellMinWidth: 100,
        allowTableNodeSelection: false,
        View: TableView,
      });
    });

    it('can configure HTMLAttributes', () => {
      const Custom = Table.configure({ HTMLAttributes: { class: 'my-table' } });
      expect(Custom.options.HTMLAttributes).toEqual({ class: 'my-table' });
    });

    it('can configure allowTableNodeSelection', () => {
      const Custom = Table.configure({ allowTableNodeSelection: true });
      expect(Custom.options.allowTableNodeSelection).toBe(true);
    });

    it('can configure cellMinWidth', () => {
      const Custom = Table.configure({ cellMinWidth: 50 });
      expect(Custom.options.cellMinWidth).toBe(50);
    });

    it('can disable View', () => {
      const Custom = Table.configure({ View: null });
      expect(Custom.options.View).toBeNull();
    });
  });

  describe('parseHTML', () => {
    it('returns rule for table tag', () => {
      const rules = Table.config.parseHTML?.call(Table);
      expect(rules).toEqual([{ tag: 'table' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders table with tbody', () => {
      const spec = Table.createNodeSpec();
      const mockNode = { attrs: {} } as AnyJson;
      const result = spec.toDOM?.(mockNode) as unknown as AnyJson[];
      expect(result[0]).toBe('table');
      expect(result[2]).toEqual(['tbody', 0]);
    });

    it('merges HTMLAttributes', () => {
      const Custom = Table.configure({ HTMLAttributes: { class: 'styled' } });
      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: {} } as AnyJson;
      const result = spec.toDOM?.(mockNode) as unknown as AnyJson[];
      expect(result[1].class).toBe('styled');
    });
  });

  describe('createNodeSpec', () => {
    it('includes tableRole in spec', () => {
      const spec = Table.createNodeSpec();
      expect((spec as AnyJson).tableRole).toBe('table');
    });

    it('is isolating', () => {
      const spec = Table.createNodeSpec();
      expect(spec.isolating).toBe(true);
    });
  });
});

// === TableRow Node ===

describe('TableRow', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TableRow.name).toBe('tableRow');
    });

    it('is a node type', () => {
      expect(TableRow.type).toBe('node');
    });

    it('has correct content spec', () => {
      expect(TableRow.config.content).toBe('(tableCell | tableHeader)*');
    });

    it('has row tableRole', () => {
      expect(TableRow.config.tableRole).toBe('row');
    });

    it('has default options', () => {
      expect(TableRow.options).toEqual({
        HTMLAttributes: {},
      });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for tr tag', () => {
      const rules = TableRow.config.parseHTML?.call(TableRow);
      expect(rules).toEqual([{ tag: 'tr' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders tr element', () => {
      const spec = TableRow.createNodeSpec();
      const mockNode = { attrs: {} } as AnyJson;
      const result = spec.toDOM?.(mockNode) as unknown as AnyJson[];
      expect(result[0]).toBe('tr');
      expect(result[2]).toBe(0);
    });
  });

  describe('createNodeSpec', () => {
    it('includes tableRole in spec', () => {
      const spec = TableRow.createNodeSpec();
      expect((spec as AnyJson).tableRole).toBe('row');
    });
  });
});

// === TableCell Node ===

describe('TableCell', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TableCell.name).toBe('tableCell');
    });

    it('is a node type', () => {
      expect(TableCell.type).toBe('node');
    });

    it('has correct content spec', () => {
      expect(TableCell.config.content).toBe('block+');
    });

    it('has cell tableRole', () => {
      expect(TableCell.config.tableRole).toBe('cell');
    });

    it('is isolating', () => {
      expect(TableCell.config.isolating).toBe(true);
    });

    it('has default options', () => {
      expect(TableCell.options).toEqual({
        HTMLAttributes: {},
      });
    });
  });

  describe('attributes', () => {
    it('defines colspan with default 1', () => {
      const spec = TableCell.createNodeSpec();
      expect(spec.attrs?.['colspan']?.default).toBe(1);
    });

    it('defines rowspan with default 1', () => {
      const spec = TableCell.createNodeSpec();
      expect(spec.attrs?.['rowspan']?.default).toBe(1);
    });

    it('defines colwidth with default null', () => {
      const spec = TableCell.createNodeSpec();
      expect(spec.attrs?.['colwidth']?.default).toBeNull();
    });
  });

  describe('parseHTML', () => {
    it('returns rule for td tag', () => {
      const rules = TableCell.config.parseHTML?.call(TableCell);
      expect(rules).toEqual([{ tag: 'td' }]);
    });

    it('parses colspan from DOM', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const el = document.createElement('td');
      el.setAttribute('colspan', '3');
      const value = attrs?.['colspan']?.parseHTML?.(el);
      expect(value).toBe(3);
    });

    it('parses rowspan from DOM', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const el = document.createElement('td');
      el.setAttribute('rowspan', '2');
      const value = attrs?.['rowspan']?.parseHTML?.(el);
      expect(value).toBe(2);
    });

    it('parses colwidth from data-colwidth', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const el = document.createElement('td');
      el.setAttribute('data-colwidth', '100,200');
      const value = attrs?.['colwidth']?.parseHTML?.(el);
      expect(value).toEqual([100, 200]);
    });

    it('returns null for missing colwidth', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const el = document.createElement('td');
      const value = attrs?.['colwidth']?.parseHTML?.(el);
      expect(value).toBeNull();
    });

    it('returns default colspan when attribute missing', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const el = document.createElement('td');
      const value = attrs?.['colspan']?.parseHTML?.(el);
      expect(value).toBe(1);
    });
  });

  describe('renderHTML attributes', () => {
    it('omits colspan when 1', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['colspan']?.renderHTML?.({ colspan: 1 });
      expect(result).toBeNull();
    });

    it('renders colspan when > 1', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['colspan']?.renderHTML?.({ colspan: 3 });
      expect(result).toEqual({ colspan: 3 });
    });

    it('omits rowspan when 1', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['rowspan']?.renderHTML?.({ rowspan: 1 });
      expect(result).toBeNull();
    });

    it('renders rowspan when > 1', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['rowspan']?.renderHTML?.({ rowspan: 2 });
      expect(result).toEqual({ rowspan: 2 });
    });

    it('renders colwidth as data-colwidth', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['colwidth']?.renderHTML?.({ colwidth: [100, 200] });
      expect(result).toEqual({ 'data-colwidth': '100,200' });
    });

    it('omits colwidth when null', () => {
      const attrs = TableCell.config.addAttributes?.call(TableCell);
      const result = attrs?.['colwidth']?.renderHTML?.({ colwidth: null });
      expect(result).toBeNull();
    });
  });

  describe('renderHTML', () => {
    it('renders td element', () => {
      const spec = TableCell.createNodeSpec();
      const mockNode = { attrs: { colspan: 1, rowspan: 1, colwidth: null } } as AnyJson;
      const result = spec.toDOM?.(mockNode) as unknown as AnyJson[];
      expect(result[0]).toBe('td');
      expect(result[2]).toBe(0);
    });
  });

  describe('createNodeSpec', () => {
    it('includes tableRole in spec', () => {
      const spec = TableCell.createNodeSpec();
      expect((spec as AnyJson).tableRole).toBe('cell');
    });

    it('is isolating', () => {
      const spec = TableCell.createNodeSpec();
      expect(spec.isolating).toBe(true);
    });
  });
});

// === TableHeader Node ===

describe('TableHeader', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TableHeader.name).toBe('tableHeader');
    });

    it('is a node type', () => {
      expect(TableHeader.type).toBe('node');
    });

    it('has correct content spec', () => {
      expect(TableHeader.config.content).toBe('block+');
    });

    it('has header_cell tableRole', () => {
      expect(TableHeader.config.tableRole).toBe('header_cell');
    });

    it('is isolating', () => {
      expect(TableHeader.config.isolating).toBe(true);
    });
  });

  describe('attributes', () => {
    it('defines colspan with default 1', () => {
      const spec = TableHeader.createNodeSpec();
      expect(spec.attrs?.['colspan']?.default).toBe(1);
    });

    it('defines rowspan with default 1', () => {
      const spec = TableHeader.createNodeSpec();
      expect(spec.attrs?.['rowspan']?.default).toBe(1);
    });

    it('defines colwidth with default null', () => {
      const spec = TableHeader.createNodeSpec();
      expect(spec.attrs?.['colwidth']?.default).toBeNull();
    });
  });

  describe('parseHTML', () => {
    it('returns rule for th tag', () => {
      const rules = TableHeader.config.parseHTML?.call(TableHeader);
      expect(rules).toEqual([{ tag: 'th' }]);
    });

    it('parses colspan from DOM', () => {
      const attrs = TableHeader.config.addAttributes?.call(TableHeader);
      const el = document.createElement('th');
      el.setAttribute('colspan', '4');
      const value = attrs?.['colspan']?.parseHTML?.(el);
      expect(value).toBe(4);
    });

    it('parses rowspan from DOM', () => {
      const attrs = TableHeader.config.addAttributes?.call(TableHeader);
      const el = document.createElement('th');
      el.setAttribute('rowspan', '3');
      const value = attrs?.['rowspan']?.parseHTML?.(el);
      expect(value).toBe(3);
    });
  });

  describe('renderHTML', () => {
    it('renders th element', () => {
      const spec = TableHeader.createNodeSpec();
      const mockNode = { attrs: { colspan: 1, rowspan: 1, colwidth: null } } as AnyJson;
      const result = spec.toDOM?.(mockNode) as unknown as AnyJson[];
      expect(result[0]).toBe('th');
      expect(result[2]).toBe(0);
    });
  });

  describe('createNodeSpec', () => {
    it('includes tableRole in spec', () => {
      const spec = TableHeader.createNodeSpec();
      expect((spec as AnyJson).tableRole).toBe('header_cell');
    });
  });
});

// === Editor Integration ===

describe('Editor Integration', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  it('creates editor with table extensions', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });
    expect(editor).toBeDefined();
    expect(editor.schema.nodes['table']).toBeDefined();
    expect(editor.schema.nodes['tableRow']).toBeDefined();
    expect(editor.schema.nodes['tableCell']).toBeDefined();
    expect(editor.schema.nodes['tableHeader']).toBeDefined();
  });

  it('has tableRole on node specs', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });
    expect(editor.schema.nodes['table']!.spec['tableRole']).toBe('table');
    expect(editor.schema.nodes['tableRow']!.spec['tableRole']).toBe('row');
    expect(editor.schema.nodes['tableCell']!.spec['tableRole']).toBe('cell');
    expect(editor.schema.nodes['tableHeader']!.spec['tableRole']).toBe('header_cell');
  });

  it('parses table HTML content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td><p>Cell 1</p></td><td><p>Cell 2</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
    expect(tableNode).toBeDefined();
    expect(tableNode?.content?.[0]?.type).toBe('tableRow');
    expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableCell');
  });

  it('parses table with header row', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
    expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(tableNode?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('parses colspan and rowspan attributes', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td colspan="2" rowspan="3"><p>Wide cell</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.find((n: AnyJson) => n.type === 'table')
      ?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.colspan).toBe(2);
    expect(cell?.attrs?.rowspan).toBe(3);
  });

  it('parses colwidth from data-colwidth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td data-colwidth="150"><p>Sized</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.find((n: AnyJson) => n.type === 'table')
      ?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.colwidth).toEqual([150]);
  });
});

// === Commands ===

describe('Commands', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  describe('insertTable', () => {
    it('inserts a default 3x3 table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });
      // Select all so the empty paragraph is the selection
      editor.commands.selectAll();
      const result = editor.commands.insertTable();
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
      expect(tableNode).toBeDefined();
      // 3 rows (1 header + 2 data)
      expect(tableNode?.content?.length).toBe(3);
      // First row has header cells
      expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
      // Second row has data cells
      expect(tableNode?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
      // 3 cells per row
      expect(tableNode?.content?.[0]?.content?.length).toBe(3);
    });

    it('inserts table with custom size', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const result = editor.commands.insertTable({ rows: 2, cols: 4, withHeaderRow: false });
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
      expect(tableNode).toBeDefined();
      expect(tableNode?.content?.length).toBe(2);
      expect(tableNode?.content?.[0]?.content?.length).toBe(4);
      // No header row
      expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableCell');
    });

    it('inserts table without header row', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const result = editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
      expect(tableNode).toBeDefined();
      expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableCell');
    });
  });

  describe('deleteTable', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      const result = editor.commands.deleteTable();
      expect(result).toBe(false);
    });

    it('deletes table when cursor inside', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>Cell</p></td></tr></table>',
      });

      // Place cursor inside table cell
      const { state } = editor;
      const tableNode = state.doc.firstChild;
      if (tableNode) {
        // Position inside the paragraph inside the cell
        const pos = 4; // doc > table > row > cell > paragraph
        const { tr } = state;
        tr.setSelection(TextSelection.create(tr.doc, pos));
        editor.view.dispatch(tr);
      }

      const result = editor.commands.deleteTable();
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const tableExists = json.content?.some((n: AnyJson) => n.type === 'table');
      expect(tableExists).toBeFalsy();
    });
  });

  describe('addRowBefore / addRowAfter', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.addRowBefore()).toBe(false);
      expect(editor.commands.addRowAfter()).toBe(false);
    });
  });

  describe('deleteRow', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.deleteRow()).toBe(false);
    });
  });

  describe('addColumnBefore / addColumnAfter', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.addColumnBefore()).toBe(false);
      expect(editor.commands.addColumnAfter()).toBe(false);
    });
  });

  describe('deleteColumn', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.deleteColumn()).toBe(false);
    });
  });

  describe('toggleHeaderRow', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.toggleHeaderRow()).toBe(false);
    });
  });

  describe('toggleHeaderColumn', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.toggleHeaderColumn()).toBe(false);
    });
  });

  describe('toggleHeaderCell', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.toggleHeaderCell()).toBe(false);
    });
  });

  describe('goToNextCell / goToPreviousCell', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.goToNextCell()).toBe(false);
      expect(editor.commands.goToPreviousCell()).toBe(false);
    });
  });

  describe('fixTables', () => {
    it('returns true always', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.fixTables()).toBe(true);
    });
  });

  describe('setCellSelection', () => {
    it('is available as command', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.setCellSelection).toBeDefined();
    });
  });

  describe('setCellAttribute', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.setCellAttribute('background', '#ff0')).toBe(false);
    });

    it('sets background on a cell', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      // Place cursor inside first cell
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.setCellAttribute('background', '#fef08a');
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const cell = json.content?.[0]?.content?.[0]?.content?.[0];
      expect(cell?.attrs?.background).toBe('#fef08a');
    });

    it('sets textAlign on a cell', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.setCellAttribute('textAlign', 'center');
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const cell = json.content?.[0]?.content?.[0]?.content?.[0];
      expect(cell?.attrs?.textAlign).toBe('center');
    });

    it('sets verticalAlign on a cell', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td></tr></table>',
      });
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.setCellAttribute('verticalAlign', 'middle');
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const cell = json.content?.[0]?.content?.[0]?.content?.[0];
      expect(cell?.attrs?.verticalAlign).toBe('middle');
    });

    it('clears textAlign by setting null', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td data-text-align="center"><p>A</p></td></tr></table>',
      });
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      editor.commands.setCellAttribute('textAlign', null);
      const json = editor.getJSON() as AnyJson;
      const cell = json.content?.[0]?.content?.[0]?.content?.[0];
      expect(cell?.attrs?.textAlign).toBeNull();
    });
  });

  describe('mergeCells', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.mergeCells()).toBe(false);
    });

    it('is available as a command', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.mergeCells).toBeDefined();
    });

    it('merges selected cells', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
      });
      // Create CellSelection spanning first row (cells 0 and 1)
      // table starts at pos 0, tableStart = 1
      // first cell at offset 1, second cell at offset 6
      const sel = CellSelection.create(editor.state.doc, 2, 7);
      const { tr } = editor.state;
      tr.setSelection(sel as unknown as typeof tr.selection);
      editor.view.dispatch(tr);

      const result = editor.commands.mergeCells();
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const firstCell = json.content?.[0]?.content?.[0]?.content?.[0];
      expect(firstCell?.attrs?.colspan).toBe(2);
    });
  });

  describe('splitCell', () => {
    it('returns false when not in table', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.splitCell()).toBe(false);
    });

    it('is available as a command', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });
      expect(editor.commands.splitCell).toBeDefined();
    });

    it('splits a merged cell', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td colspan="2"><p>Merged</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
      });
      // Place cursor inside the merged cell
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.splitCell();
      expect(result).toBe(true);
      const json = editor.getJSON() as AnyJson;
      const firstRow = json.content?.[0]?.content?.[0];
      expect(firstRow?.content?.length).toBe(2);
      expect(firstRow?.content?.[0]?.attrs?.colspan).toBe(1);
    });

    it('returns false on non-merged cell', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>',
      });
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(tr.doc, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.splitCell();
      expect(result).toBe(false);
    });
  });
});

// === createTable Helper ===

describe('createTable helper', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  it('creates a table with specified dimensions', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });

    const table = createTable(editor.schema, 2, 3, false);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2); // 2 rows
    expect(table.firstChild?.childCount).toBe(3); // 3 cells per row
    expect(table.firstChild?.firstChild?.type.name).toBe('tableCell');
  });

  it('creates a table with header row', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });

    const table = createTable(editor.schema, 3, 2, true);
    expect(table.childCount).toBe(3);
    // First row has header cells
    expect(table.firstChild?.firstChild?.type.name).toBe('tableHeader');
    // Second row has regular cells
    expect(table.child(1).firstChild?.type.name).toBe('tableCell');
  });

  it('creates 1x1 table', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });

    const table = createTable(editor.schema, 1, 1, false);
    expect(table.childCount).toBe(1);
    expect(table.firstChild?.childCount).toBe(1);
  });

  it('creates large table', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });

    const table = createTable(editor.schema, 10, 5, true);
    expect(table.childCount).toBe(10);
    expect(table.firstChild?.childCount).toBe(5);
  });
});

// === cellAttributes helper ===

describe('cellAttributes helper', () => {
  const attrs = cellAttributes();

  describe('textAlign', () => {
    it('has default null', () => {
      expect(attrs['textAlign']?.default).toBeNull();
    });

    it('parses data-text-align from element', () => {
      const el = document.createElement('td');
      el.setAttribute('data-text-align', 'center');
      expect(attrs['textAlign']?.parseHTML?.(el)).toBe('center');
    });

    it('returns null when data-text-align missing', () => {
      const el = document.createElement('td');
      expect(attrs['textAlign']?.parseHTML?.(el)).toBeNull();
    });

    it('renders data-text-align attribute', () => {
      const result = attrs['textAlign']?.renderHTML?.({ textAlign: 'right' });
      expect(result).toEqual({ 'data-text-align': 'right' });
    });

    it('renders null when textAlign is null', () => {
      const result = attrs['textAlign']?.renderHTML?.({ textAlign: null });
      expect(result).toBeNull();
    });
  });

  describe('verticalAlign', () => {
    it('has default null', () => {
      expect(attrs['verticalAlign']?.default).toBeNull();
    });

    it('parses data-vertical-align from element', () => {
      const el = document.createElement('td');
      el.setAttribute('data-vertical-align', 'middle');
      expect(attrs['verticalAlign']?.parseHTML?.(el)).toBe('middle');
    });

    it('returns null when data-vertical-align missing', () => {
      const el = document.createElement('td');
      expect(attrs['verticalAlign']?.parseHTML?.(el)).toBeNull();
    });

    it('renders data-vertical-align attribute', () => {
      const result = attrs['verticalAlign']?.renderHTML?.({ verticalAlign: 'bottom' });
      expect(result).toEqual({ 'data-vertical-align': 'bottom' });
    });

    it('renders null when verticalAlign is null', () => {
      const result = attrs['verticalAlign']?.renderHTML?.({ verticalAlign: null });
      expect(result).toBeNull();
    });
  });

  describe('background', () => {
    it('has default null', () => {
      expect(attrs['background']?.default).toBeNull();
    });

    it('parses data-background from element', () => {
      const el = document.createElement('td');
      el.setAttribute('data-background', '#fef08a');
      expect(attrs['background']?.parseHTML?.(el)).toBe('#fef08a');
    });

    it('parses inline background-color as fallback', () => {
      const el = document.createElement('td');
      el.style.backgroundColor = 'rgb(255, 0, 0)';
      expect(attrs['background']?.parseHTML?.(el)).toBe('rgb(255, 0, 0)');
    });

    it('returns null when no background set', () => {
      const el = document.createElement('td');
      expect(attrs['background']?.parseHTML?.(el)).toBeNull();
    });

    it('renders both data-background and inline style', () => {
      const result = attrs['background']?.renderHTML?.({ background: '#fef08a' });
      expect(result).toEqual({ 'data-background': '#fef08a', style: 'background-color: #fef08a' });
    });

    it('renders null when background is null', () => {
      const result = attrs['background']?.renderHTML?.({ background: null });
      expect(result).toBeNull();
    });
  });

  describe('colspan', () => {
    it('has default 1', () => {
      expect(attrs['colspan']?.default).toBe(1);
    });

    it('parses colspan from element', () => {
      const el = document.createElement('td');
      el.setAttribute('colspan', '3');
      expect(attrs['colspan']?.parseHTML?.(el)).toBe(3);
    });

    it('omits when 1', () => {
      expect(attrs['colspan']?.renderHTML?.({ colspan: 1 })).toBeNull();
    });

    it('renders when > 1', () => {
      expect(attrs['colspan']?.renderHTML?.({ colspan: 2 })).toEqual({ colspan: 2 });
    });
  });

  describe('rowspan', () => {
    it('has default 1', () => {
      expect(attrs['rowspan']?.default).toBe(1);
    });

    it('parses rowspan from element', () => {
      const el = document.createElement('td');
      el.setAttribute('rowspan', '4');
      expect(attrs['rowspan']?.parseHTML?.(el)).toBe(4);
    });

    it('omits when 1', () => {
      expect(attrs['rowspan']?.renderHTML?.({ rowspan: 1 })).toBeNull();
    });

    it('renders when > 1', () => {
      expect(attrs['rowspan']?.renderHTML?.({ rowspan: 3 })).toEqual({ rowspan: 3 });
    });
  });

  describe('colwidth', () => {
    it('has default null', () => {
      expect(attrs['colwidth']?.default).toBeNull();
    });

    it('parses comma-separated data-colwidth', () => {
      const el = document.createElement('td');
      el.setAttribute('data-colwidth', '100,200,300');
      expect(attrs['colwidth']?.parseHTML?.(el)).toEqual([100, 200, 300]);
    });

    it('returns null when data-colwidth missing', () => {
      const el = document.createElement('td');
      expect(attrs['colwidth']?.parseHTML?.(el)).toBeNull();
    });

    it('renders colwidth as data-colwidth', () => {
      const result = attrs['colwidth']?.renderHTML?.({ colwidth: [150, 250] });
      expect(result).toEqual({ 'data-colwidth': '150,250' });
    });

    it('renders null when colwidth is null', () => {
      expect(attrs['colwidth']?.renderHTML?.({ colwidth: null })).toBeNull();
    });
  });
});

// === Cell attribute HTML round-trip ===

describe('Cell attribute HTML round-trip', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  it('preserves background through parse → getJSON', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td data-background="#fef08a" style="background-color: #fef08a"><p>Colored</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.background).toBe('#fef08a');
  });

  it('preserves textAlign through parse → getJSON', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td data-text-align="center"><p>Centered</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.textAlign).toBe('center');
  });

  it('preserves verticalAlign through parse → getJSON', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td data-vertical-align="bottom"><p>Bottom</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.verticalAlign).toBe('bottom');
  });

  it('preserves multiple cell attributes together', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td data-background="#a7f3d0" data-text-align="right" data-vertical-align="middle"><p>Multi</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.background).toBe('#a7f3d0');
    expect(cell?.attrs?.textAlign).toBe('right');
    expect(cell?.attrs?.verticalAlign).toBe('middle');
  });

  it('header cells also support textAlign and verticalAlign', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><th data-text-align="center" data-vertical-align="middle"><p>Header</p></th></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.type).toBe('tableHeader');
    expect(cell?.attrs?.textAlign).toBe('center');
    expect(cell?.attrs?.verticalAlign).toBe('middle');
  });

  it('preserves colspan on merged cell through round-trip', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td colspan="3"><p>Wide</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.colspan).toBe(3);
  });

  it('preserves rowspan on merged cell through round-trip', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<table><tr><td rowspan="2"><p>Tall</p></td><td><p>B</p></td></tr><tr><td><p>D</p></td></tr></table>',
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.rowspan).toBe(2);
  });
});

// === Exports ===

describe('Exports', () => {
  it('exports Table', () => {
    expect(Table).toBeDefined();
    expect(Table.name).toBe('table');
  });

  it('exports TableRow', () => {
    expect(TableRow).toBeDefined();
    expect(TableRow.name).toBe('tableRow');
  });

  it('exports TableCell', () => {
    expect(TableCell).toBeDefined();
    expect(TableCell.name).toBe('tableCell');
  });

  it('exports TableHeader', () => {
    expect(TableHeader).toBeDefined();
    expect(TableHeader.name).toBe('tableHeader');
  });

  it('exports TableView', () => {
    expect(TableView).toBeDefined();
  });

  it('exports createTable', () => {
    expect(createTable).toBeDefined();
    expect(typeof createTable).toBe('function');
  });
});

// === Configure / Extend ===

describe('configure / extend', () => {
  it('Table.configure merges options', () => {
    const Custom = Table.configure({
      cellMinWidth: 50,
    });
    expect(Custom.options.cellMinWidth).toBe(50);
    expect(Custom.options.allowTableNodeSelection).toBe(false); // unchanged default
  });

  it('TableCell.configure merges options', () => {
    const Custom = TableCell.configure({
      HTMLAttributes: { class: 'custom-cell' },
    });
    expect(Custom.options.HTMLAttributes).toEqual({ class: 'custom-cell' });
  });

  it('TableHeader.configure merges options', () => {
    const Custom = TableHeader.configure({
      HTMLAttributes: { class: 'custom-header' },
    });
    expect(Custom.options.HTMLAttributes).toEqual({ class: 'custom-header' });
  });

  it('TableRow.configure merges options', () => {
    const Custom = TableRow.configure({
      HTMLAttributes: { class: 'custom-row' },
    });
    expect(Custom.options.HTMLAttributes).toEqual({ class: 'custom-row' });
  });
});

// === Re-exports from prosemirror-tables ===

describe('Re-exports', () => {
  it('re-exports CellSelection', async () => {
    const { CellSelection } = await import('./index.js');
    expect(CellSelection).toBeDefined();
  });

  it('re-exports TableMap', async () => {
    const { TableMap } = await import('./index.js');
    expect(TableMap).toBeDefined();
  });
});

// === Schema Consistency ===

describe('Schema consistency', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  it('all four table node types are registered', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });
    const nodeNames = Object.keys(editor.schema.nodes);
    expect(nodeNames).toContain('table');
    expect(nodeNames).toContain('tableRow');
    expect(nodeNames).toContain('tableCell');
    expect(nodeNames).toContain('tableHeader');
  });

  it('table content spec references tableRow', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });
    expect(editor.schema.nodes['table']!.spec.content).toBe('tableRow+');
  });

  it('tableRow content spec references cells', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });
    expect(editor.schema.nodes['tableRow']!.spec.content).toBe('(tableCell | tableHeader)*');
  });

  it('cell content spec allows blocks', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });
    expect(editor.schema.nodes['tableCell']!.spec.content).toBe('block+');
    expect(editor.schema.nodes['tableHeader']!.spec.content).toBe('block+');
  });

  it('table and cells are isolating', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Test</p>',
    });
    expect(editor.schema.nodes['table']!.spec.isolating).toBe(true);
    expect(editor.schema.nodes['tableCell']!.spec.isolating).toBe(true);
    expect(editor.schema.nodes['tableHeader']!.spec.isolating).toBe(true);
  });
});

// === HTML Round-trip ===

describe('HTML round-trip', () => {
  let editor: InstanceType<typeof Editor>;

  afterEach(() => {
    editor.destroy();
  });

  it('preserves basic table structure through parse → serialize', () => {
    const html = '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>';
    editor = new Editor({
      extensions: allExtensions,
      content: html,
    });
    const json = editor.getJSON() as AnyJson;
    const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
    expect(tableNode?.content?.length).toBe(2); // 2 rows
    expect(tableNode?.content?.[0]?.content?.length).toBe(2); // 2 cells
  });

  it('preserves header cells', () => {
    const html = '<table><tbody><tr><th><p>H1</p></th><th><p>H2</p></th></tr><tr><td><p>D1</p></td><td><p>D2</p></td></tr></tbody></table>';
    editor = new Editor({
      extensions: allExtensions,
      content: html,
    });
    const json = editor.getJSON() as AnyJson;
    const tableNode = json.content?.find((n: AnyJson) => n.type === 'table');
    expect(tableNode?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(tableNode?.content?.[1]?.content?.[0]?.type).toBe('tableCell');
  });

  it('preserves colspan in round-trip', () => {
    const html = '<table><tbody><tr><td colspan="2"><p>Wide</p></td></tr></tbody></table>';
    editor = new Editor({
      extensions: allExtensions,
      content: html,
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.find((n: AnyJson) => n.type === 'table')
      ?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.colspan).toBe(2);
  });

  it('preserves rowspan in round-trip', () => {
    const html = '<table><tbody><tr><td rowspan="3"><p>Tall</p></td><td><p>B</p></td></tr></tbody></table>';
    editor = new Editor({
      extensions: allExtensions,
      content: html,
    });
    const json = editor.getJSON() as AnyJson;
    const cell = json.content?.find((n: AnyJson) => n.type === 'table')
      ?.content?.[0]?.content?.[0];
    expect(cell?.attrs?.rowspan).toBe(3);
  });
});
