
import { describe, it, expect, afterEach } from 'vitest';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { TableView } from './TableView.js';
import { createTable } from './helpers/createTable.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from 'prosemirror-state';

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
        resizable: false,
        handleWidth: 5,
        cellMinWidth: 25,
        lastColumnResizable: true,
        allowTableNodeSelection: false,
        View: TableView,
      });
    });

    it('can configure HTMLAttributes', () => {
      const Custom = Table.configure({ HTMLAttributes: { class: 'my-table' } });
      expect(Custom.options.HTMLAttributes).toEqual({ class: 'my-table' });
    });

    it('can configure resizable', () => {
      const Custom = Table.configure({ resizable: true });
      expect(Custom.options.resizable).toBe(true);
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
      resizable: true,
      cellMinWidth: 50,
    });
    expect(Custom.options.resizable).toBe(true);
    expect(Custom.options.cellMinWidth).toBe(50);
    expect(Custom.options.handleWidth).toBe(5); // unchanged default
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
