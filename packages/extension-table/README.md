# @domternal/extension-table

Table extension for Domternal with 18 commands, cell merging, column resize, row/column controls, and cell toolbar.

Part of the [Domternal](https://github.com/domternal/domternal) toolkit. Full docs at [domternal.dev](https://domternal.dev).

## Installation

```bash
npm install @domternal/core @domternal/extension-table
```

## Usage

```ts
import { Editor, StarterKit } from '@domternal/core';
import { Table, TableRow, TableCell, TableHeader } from '@domternal/extension-table';

const editor = new Editor({
  element: document.getElementById('editor')!,
  extensions: [StarterKit, Table, TableRow, TableCell, TableHeader],
  content: '<p>Hello world</p>',
});

// Insert a 3x3 table with a header row
editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });

// Merge selected cells
editor.commands.mergeCells();

// Add a row after the current one
editor.commands.addRowAfter();
```

### Commands

| Command | Description |
|---|---|
| `insertTable` | Insert a new table with configurable rows, cols, and header row |
| `deleteTable` | Delete the entire table |
| `addRowBefore` / `addRowAfter` | Insert a row above or below |
| `deleteRow` | Delete the current row |
| `addColumnBefore` / `addColumnAfter` | Insert a column left or right |
| `deleteColumn` | Delete the current column |
| `mergeCells` | Merge selected cells into one |
| `splitCell` | Split a merged cell back to individual cells |
| `toggleHeaderRow` / `toggleHeaderColumn` / `toggleHeaderCell` | Toggle header formatting |
| `setCellAttribute` | Set an attribute on the current cell |
| `goToNextCell` / `goToPreviousCell` | Navigate between cells with Tab/Shift-Tab |
| `fixTables` | Repair malformed tables |
| `setCellSelection` | Programmatic cell range selection |

## License

[MIT](https://github.com/domternal/domternal/blob/main/LICENSE)
