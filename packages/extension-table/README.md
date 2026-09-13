# @domternal/extension-table

[![Version](https://img.shields.io/npm/v/@domternal/extension-table.svg)](https://www.npmjs.com/package/@domternal/extension-table)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Full-featured tables for the [Domternal](https://domternal.dev) editor, built on
`prosemirror-tables`.

Provides the `Table`, `TableRow`, `TableCell`, and `TableHeader` nodes with cell
merge/split, three column-resize modes, header row/column toggles, cell selection,
and `Tab`/arrow keyboard navigation. Drag-to-resize comes from the extension's
plugins and is always on; the built-in `TableView` adds the row and column handles
and the cell toolbar on top of it, and can be turned off (`View: null`) when you
want to drive that UI yourself.

## Links

<u>[Website](https://domternal.dev)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Documentation](https://domternal.dev/v1/nodes/table)</u> &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp; <u>[Live examples](https://domternal.dev/examples)</u>

## Install

```bash
pnpm add @domternal/extension-table
```

`@domternal/core` and `@domternal/pm` are peer dependencies and are already
present in any Domternal editor setup.

Version 1.1.1 requires both `@domternal/core` and `@domternal/pm` in the range
`>=1.1.0 <2.0.0`. Upgrade these packages together with this extension.

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
  // View: null, // the default is the built-in TableView; set null to supply your own UI
});
```

With `constrainToContainer` on (the default), last-column resize is capped at the
container edge. Adding a column to a table with custom widths first uses available
container space, then borrows only the required space from the closest columns,
starting on the selected side. Other widths stay unchanged. The new column uses
`defaultCellMinWidth` when possible; borrowing never shrinks a column below
`cellMinWidth`. If even the minimum widths cannot fit, or the table already overflows,
the wrapper scrolls horizontally instead of resetting the table's widths.

With the constraint off, adding a column preserves existing custom widths and grows
the table by the new column's width. In either mode, a table with no stored widths
keeps automatic layout and a floor of `defaultCellMinWidth` per column. Adding to a
partially sized table first resolves the unspecified widths from its rendered columns.
Insertion and width changes form one undoable operation, including in command chains.

## Commands

Registered on the editor when the extension is active:

- `insertTable({ rows?, cols?, withHeaderRow? })`, `deleteTable`
- `addRowBefore`, `addRowAfter`, `deleteRow`
- `addColumnBefore`, `addColumnAfter`, `deleteColumn`
- `toggleHeaderRow`, `toggleHeaderColumn`, `toggleHeaderCell`
- `mergeCells`, `splitCell`
- `setCellAttribute(name, value)`, `setCellSelection({ anchorCell, headCell? })`
- `goToNextCell`, `goToPreviousCell`, `fixTables`

Cells carry `colspan`, `rowspan`, `colwidth`, `background`, `textAlign`, and
`verticalAlign`. The last three are what the cell toolbar writes, and
`setCellAttribute('background', '#ffe0e0')` or `setCellAttribute('textAlign', 'center')`
sets them from code.

The package also exports the `TableView` node view, the `createTable` and
`deleteTableWhenAllCellsSelected` helpers, and re-exports `CellSelection` and
`TableMap` (which originate in `prosemirror-tables`) from `@domternal/pm/tables`,
so you do not need a bare `prosemirror-tables` import.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Move to the next cell, adding a row first when the cursor is in the last one |
| `Shift-Tab` | Move to the previous cell |
| `Backspace`, `Delete`, `Mod-Backspace`, `Mod-Delete` | Delete the table when all of its cells are selected |

`Tab` and `Shift-Tab` stand down inside a `listItem` or `taskItem`, so list indentation
keeps them. Arrow keys move between cells, and `Shift` with them extends a cell
selection; both come from `prosemirror-tables`, not this keymap.
