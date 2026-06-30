# @domternal/extension-table

[![Version](https://img.shields.io/npm/v/@domternal/extension-table.svg)](https://www.npmjs.com/package/@domternal/extension-table)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Full-featured tables for the [Domternal](https://domternal.dev) editor, built on
`prosemirror-tables`.

Provides the `Table`, `TableRow`, `TableCell`, and `TableHeader` nodes with cell
merge/split, three column-resize modes, header row/column toggles, cell selection,
and `Tab`/arrow keyboard navigation. The built-in `TableView` adds row/column
handles, a cell toolbar, and drag-to-resize, or you can disable it (`View: null`)
and drive everything through commands.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/table)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-table
```

`@domternal/core` and `@domternal/pm` are peer dependencies and are already
present in any Domternal editor setup.

## Usage

Add the `Table` extension to your editor. It pulls in `TableRow`, `TableCell`,
`TableHeader`, and `Gapcursor` automatically, so a single import is enough.

```ts
import { Editor, Document, Paragraph, Text } from '@domternal/core';
import { Table } from '@domternal/extension-table';
import '@domternal/theme';

const editor = new Editor({
  extensions: [Document, Paragraph, Text, Table],
});

// Insert a 3x3 table with a header row, then add a row and merge selected cells.
editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
editor.commands.addRowAfter();
editor.commands.mergeCells();
```

Configure resize and rendering behavior through `Table.configure`:

```ts
Table.configure({
  resizeBehavior: 'neighbor', // 'neighbor' | 'independent' | 'redistribute'
  constrainToContainer: true,
  cellMinWidth: 25,
  defaultCellMinWidth: 100,
  allowTableNodeSelection: false, // allow selecting the whole table as a node
  HTMLAttributes: {}, // custom attributes on the rendered <table>
  View: null, // disable the built-in TableView and use your own UI
});
```

## Commands

Registered on the editor when the extension is active:

- `insertTable({ rows?, cols?, withHeaderRow? })`, `deleteTable`
- `addRowBefore`, `addRowAfter`, `deleteRow`
- `addColumnBefore`, `addColumnAfter`, `deleteColumn`
- `toggleHeaderRow`, `toggleHeaderColumn`, `toggleHeaderCell`
- `mergeCells`, `splitCell`
- `setCellAttribute(name, value)`, `setCellSelection({ anchorCell, headCell? })`
- `goToNextCell`, `goToPreviousCell`, `fixTables`

The package also exports the `TableView` node view, the `createTable` and
`deleteTableWhenAllCellsSelected` helpers, and re-exports `CellSelection` and
`TableMap` (which originate in `prosemirror-tables`) from `@domternal/pm/tables`,
so you do not need a bare `prosemirror-tables` import.
