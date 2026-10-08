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

Version 1.3.0 requires both `@domternal/core` and `@domternal/pm` in the range
`>=1.3.0 <2.0.0`. Upgrade installed Domternal Free packages together to 1.3.0.

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

Parsing HTML reads `colspan` and `rowspan` as a browser does, as a whole number
that may be followed by other text, and a missing, invalid or zero span as 1.
A span above 1,000 reads as 1,000: prosemirror-tables builds its table map one
entry per spanned cell, so a span such as `colspan="100000000"` in pasted or
loaded HTML would otherwise exhaust memory. Paste Cleanup refuses a pasted span
above the same bound.

Stored spans follow the same rule. Validation accepts any positive safe integer, so
`schema.nodeFromJSON`, `Node.check` and `Step.fromJSON` reject `0`, `-1`, `1.5`, `"2"` or `null`
and accept `5000`. The JSON entry points of `@domternal/core` (initial content, `setContent`,
`insertContent`, `createDocument`, the SSR helpers and `normalizeContent`) load an invalid span or
one above 1,000 as the span a browser draws for it and report an `unsupported-table-span`
diagnostic: a number is rounded down into 1 to 1,000, a string is read as an HTML span attribute
(`"2"` is 2, `"abc"` is 1), and anything else is 1. A document that still holds such a span, such
as a collaborative document an older client wrote, renders the replacement, draws at most 1,000
columns and keeps the stored value until `normalizeContentAttributes()` replaces it;
`normalizeContentAttributes({ codes: ['unsupported-table-span'] })` does only that, the same way
on every version. `setCellAttribute('colspan' | 'rowspan', value)` returns `false` for a span
loading would replace, and a pasted slice gets the replacement of a span validation rejects.

After every change, prosemirror-tables' `fixTables` repairs the structure of the tables that
changed. It reads spans as stored, so on such a span it would delete cells (`-1`), multiply
columns (`"2"`), let collaborating clients disagree (`1.5`) or build a table map of millions of
entries (`1e6`). A table that holds such a span is therefore left to text editing until
`normalizeContentAttributes` replaces the span; the next change then repairs it as usual. No
table map is built for it: the table commands that need one (adding, deleting and merging rows,
columns and cells, header toggles, `setCellSelection`) return `false` there, a mouse drag, a
triple click, `Shift` with an arrow key and the row, column and cell handles make no cell
selection in it, a text selection dragged across its cells stays within one cell, so typing or
pasting over it deletes no cell, its columns show no resize handle, and cells pasted into it
arrive as their content at the caret instead of replacing cells. Typing, moving to the next cell with `Tab` and
`deleteTable` keep working. A cell paste that fails anyway reports its error through the editor's
`error` event (`onError`, context `Table.paste`) and pastes the cells' content at the selection
instead of throwing to the page.

Pasting cells into a table places them at the caret or over a cell selection, grows the table
where they reach past its edges and selects exactly the pasted cells, as prosemirror-tables does.
The package handles these pastes itself, with the prosemirror-tables helpers adapted in
`src/helpers/pasteCells.ts`, because the upstream handler throws `No cell with offset` and pastes
nothing when a pasted cell spans rows up to the table's right edge, such as a merged 2x2 cell
pasted into the last column. A cell clipped at the bottom of a cell selection keeps the rows it
still covers, and one undo step restores the table. The cell paste is a paste transaction, with the
`paste` and `uiEvent: 'paste'` metadata every other paste carries, so paste receipts and transaction
observers see it, and it scrolls the pasted cells into view. A pasted cell spans at most the rows the copied
table holds, empty ones included, as an internal copy and spreadsheets write them: a `rowspan`
past them ends with them, as a browser draws it, so a one-row copy of `<td rowspan="1000">` adds no
rows to the target table. A paste whose image files are the paste, one
without text of its own as `pasteHasOwnText` from `@domternal/core/clipboard` decides, goes to the
image node first, so a screenshot pasted over a cell selection lands in the first selected cell
whether Table or Image is listed first, instead of clearing the cells and inserting nothing.

A cell background is written into the cell's `style` only when it is a safe CSS value
(`isSafeCssValue` from `@domternal/core`): a value that could add a declaration, such as
`red;position:fixed`, or load a resource through `url()` is left out of the editor DOM,
`getHTML()` and `generateHTML()`, and kept in the document. `setCellAttribute('background', value)`
returns `false` for such a value. Parsing HTML reads `data-background` only when it is safe, and
otherwise the cell's `background-color`.

`textAlign` and `verticalAlign` render as `data-text-align` and `data-vertical-align`, which
inline styles (`getHTML({ styled: true })`, `inlineStyles` and a `clipboardHTMLTransform` built on
it) turn into `text-align` and `vertical-align` declarations. So they follow the same rule: an
unsafe value is not rendered, not parsed from HTML and refused by `setCellAttribute`, and
`inlineStyles` writes a declaration only for a safe value, whatever HTML it is given. An empty
value clears any of the three, as `null` does.

The package also exports the `TableView` node view, the `createTable` and
`deleteTableWhenAllCellsSelected` helpers, and re-exports `CellSelection` and
`TableMap` (which originate in `prosemirror-tables`) from `@domternal/pm/tables`,
so you do not need a bare `prosemirror-tables` import.

## Office paste cleanup

[`PasteCleanup`](../extension-paste-cleanup/README.md) is optional and separate from
Table. With it installed, bare copied rows and cells are normalized as table
content. For complete table fragments, unconfirmed destination table support
rejects the paste before insertion.
Its default 20,000 expanded-cell budget applies across the pasted fragment; its
input, node and depth limits apply as well. A span above 1,000 rejects that paste,
where Table's ordinary HTML parser caps a span at 1,000. These are different entry
points, not interchangeable limits.

For stored documents, use the diagnostic and migration behavior above. Rendering
or editing text in a table with unsupported stored spans does not silently migrate
it. `normalizeContentAttributes({ codes: ['unsupported-table-span'] })` performs
that repair explicitly, outside undo history.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Tab` | Move to the next cell, adding a row first when the cursor is in the last one |
| `Shift-Tab` | Move to the previous cell |
| `Backspace`, `Delete`, `Mod-Backspace`, `Mod-Delete` | Delete the table when all of its cells are selected |

`Tab` and `Shift-Tab` stand down inside a `listItem` or `taskItem`, so list indentation
keeps them. Arrow keys move between cells, and `Shift` with them extends a cell
selection; both come from `prosemirror-tables`, not this keymap.

## Localization

This package exports `tableMessages` for typed custom catalogs. Optional German UI
messages and search aliases are available from `@domternal/extension-table/locales/de` as
`deMessages` and `deSearchAliases`. Merge them with the core and other enabled feature
catalogs. Missing entries fall back to English.
