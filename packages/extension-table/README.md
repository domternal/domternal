# @domternal/extension-table

[![Version](https://img.shields.io/npm/v/@domternal/extension-table.svg)](https://www.npmjs.com/package/@domternal/extension-table)
[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/domternal/domternal/blob/main/LICENSE)

Editable tables for [Domternal](https://domternal.dev), built on
`prosemirror-tables`. Includes cell merge/split, column resizing, header rows and
columns, cell styling, selection and keyboard navigation. The built-in table
view supplies row/column handles and a cell toolbar.

[Documentation](https://domternal.dev/v1/nodes/table/) · [Examples](https://domternal.dev/examples)

## Install

The package declares Node.js 22 or later for tooling.

```bash
pnpm add @domternal/core @domternal/pm @domternal/extension-table @domternal/theme
```

Core and pm are peers with the range `>=1.3.0 <2.0.0`. Use version 1.3.1 for all
installed Domternal packages. The example uses the optional theme for table
layout and UI; you can supply your own styles instead.

## Quick start

```html
<div id="editor" class="dm-editor"></div>
```

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Table } from '@domternal/extension-table';
import '@domternal/theme';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Table],
});

editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
```

`Table` registers `TableRow`, `TableCell`, `TableHeader` and `Gapcursor`
automatically. You do not need to add those separately. Call `editor.destroy()`
when removing the editor.

## Configure resizing and UI

Replace `Table` in the extension array with a configured instance:

```ts
Table.configure({
  resizeBehavior: 'neighbor',
  constrainToContainer: true,
  cellMinWidth: 25,
  defaultCellMinWidth: 100,
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `resizeBehavior` | `'neighbor'` | Resize against the neighboring column; `'independent'` grows the table and `'redistribute'` redistributes widths. |
| `constrainToContainer` | `true` | Limit growth to available space, with horizontal scrolling when minimum widths cannot fit. |
| `cellMinWidth` | `25` | Minimum column width while dragging, in pixels. |
| `defaultCellMinWidth` | `100` | Width floor for columns without explicit widths, in pixels. |
| `allowTableNodeSelection` | `false` | Allow selecting the whole table as a node. |
| `View` | `TableView` | Replace the built-in node view, or use `null` to omit its handles and cell toolbar. |

Disabling the built-in view does not disable the column-resizing plugins.
Adding a column preserves existing custom widths where possible, using free space
before borrowing from nearby columns. See [resize behavior](https://domternal.dev/v1/nodes/table/#resize-behaviors)
and [container constraints](https://domternal.dev/v1/nodes/table/#container-constraint).

## Work with tables

Commands use the current cell or cell selection:

```ts
editor.commands.addRowAfter();
editor.commands.addColumnAfter();
editor.commands.setCellAttribute('background', '#fff3cd');
editor.commands.setCellAttribute('textAlign', 'center');
```

| Task | Commands |
| --- | --- |
| Create or remove a table | `insertTable`, `deleteTable` |
| Change rows or columns | `addRowBefore`, `addRowAfter`, `deleteRow`, `addColumnBefore`, `addColumnAfter`, `deleteColumn` |
| Merge or split selected cells | `mergeCells`, `splitCell` |
| Toggle headers | `toggleHeaderRow`, `toggleHeaderColumn`, `toggleHeaderCell` |
| Select or navigate cells | `setCellSelection`, `goToNextCell`, `goToPreviousCell` |
| Style cells | `setCellAttribute` |

Merge requires a compatible cell selection. Commands return `false` when the
current selection or table does not support the operation. Use `editor.can()`
when enabling your own controls. See the [command reference](https://domternal.dev/v1/nodes/table/#commands)
for arguments, cell positions and repair helpers.

Tab moves to the next cell and can add a final row; Shift+Tab moves back. Inside
list and task items, list indentation takes precedence. Selecting all cells and
pressing Backspace or Delete removes the table.

## Content and paste

Cell pastes preserve table structure and grow the destination when needed. Add
[PasteCleanup](https://github.com/domternal/domternal/tree/main/packages/extension-paste-cleanup)
explicitly for Office HTML normalization; it is not included in Table.

HTML and JSON loading bound rendered spans to 1 through 1,000 and report unsupported JSON
spans through content diagnostics. Strict schema validation requires positive
safe-integer spans. A shared document may still contain unsupported stored spans;
some table operations remain unavailable until an explicit migration repairs
them. Rendering does not silently rewrite that shared content. See
[span validation](https://domternal.dev/v1/nodes/table/#span-validation) and the
[Core migration guide](https://github.com/domternal/domternal/blob/main/packages/core/docs/content.md)
before migrating existing collaborative documents.

PasteCleanup applies its own structural budgets and rejects a span above 1,000;
that differs from Table's ordinary HTML parsing, which caps the span. Cell colors
and alignment values also follow Core's style policy.

## More documentation

- [Table guide](https://domternal.dev/v1/nodes/table/): schema, attributes, cell paste, styling and full options.
- [Exports](https://domternal.dev/v1/nodes/table/#exports): `TableView`, `createTable`, `CellSelection`, `TableMap` and related helpers.
- [Localization](https://domternal.dev/v1/guides/i18n/): `tableMessages` and optional `@domternal/extension-table/locales/de` catalogs.

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE). Adapted
prosemirror-tables code is covered by the package's
[third-party notices](https://github.com/domternal/domternal/blob/main/packages/extension-table/THIRD-PARTY-LICENSES.md).
