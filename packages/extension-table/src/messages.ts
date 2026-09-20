import { defineMessage } from '@domternal/core';

declare module '@domternal/core' {
  interface MessageParameters {
    'table.cell.color': { color: string };
    'table.toolbar.insert': undefined;
    'table.insert.label': undefined;
    'table.insert.description': undefined;
    'table.controls.columnOptions': undefined;
    'table.controls.rowOptions': undefined;
    'table.controls.cellOptions': undefined;
    'table.controls.cellFormatting': undefined;
    'table.controls.cellColor': undefined;
    'table.controls.alignment': undefined;
    'table.controls.mergeCells': undefined;
    'table.controls.splitCell': undefined;
    'table.controls.toggleHeader': undefined;
    'table.row.insertAbove': undefined;
    'table.row.insertBelow': undefined;
    'table.row.delete': undefined;
    'table.column.insertLeft': undefined;
    'table.column.insertRight': undefined;
    'table.column.delete': undefined;
    'table.cell.backgroundColor': undefined;
    'table.cell.defaultColor': undefined;
    'table.cell.defaultColorText': undefined;
    'table.cell.alignment': undefined;
    'table.cell.alignLeft': undefined;
    'table.cell.alignCenter': undefined;
    'table.cell.alignRight': undefined;
    'table.cell.alignTop': undefined;
    'table.cell.alignMiddle': undefined;
    'table.cell.alignBottom': undefined;
  }
  interface SearchableMessages {
    'table.insert.label': true;
  }
}

/** English UI definitions owned by the table extension. */
export const tableMessages = {
  colorSwatch: defineMessage({
    id: 'table.cell.color', defaultValue: ({ color }) => color, owner: '@domternal/extension-table',
    description: 'Accessible name for a cell color swatch, using its CSS color value by default.',
  }),
  insertToolbar: defineMessage({
    id: 'table.toolbar.insert', defaultValue: 'Insert Table', owner: '@domternal/extension-table',
    description: 'Table UI: Insert Table.',
  }),
  insert: defineMessage({
    id: 'table.insert.label', defaultValue: 'Table', owner: '@domternal/extension-table',
    description: 'Table UI: Table.',
    searchAliases: ['grid', 'rows', 'columns'], technicalAliases: ['table'],
  }),
  description: defineMessage({
    id: 'table.insert.description', allowEmpty: true, defaultValue: 'Insert a simple table', owner: '@domternal/extension-table',
    description: 'Table UI: Insert a simple table.',
  }),
  columnOptions: defineMessage({
    id: 'table.controls.columnOptions', defaultValue: 'Column options', owner: '@domternal/extension-table',
    description: 'Table UI: Column options.',
  }),
  rowOptions: defineMessage({
    id: 'table.controls.rowOptions', defaultValue: 'Row options', owner: '@domternal/extension-table',
    description: 'Table UI: Row options.',
  }),
  cellOptions: defineMessage({
    id: 'table.controls.cellOptions', defaultValue: 'Cell options', owner: '@domternal/extension-table',
    description: 'Table UI: Cell options.',
  }),
  cellFormatting: defineMessage({
    id: 'table.controls.cellFormatting', defaultValue: 'Cell formatting', owner: '@domternal/extension-table',
    description: 'Table UI: Cell formatting.',
  }),
  cellColor: defineMessage({
    id: 'table.controls.cellColor', defaultValue: 'Cell color', owner: '@domternal/extension-table',
    description: 'Table UI: Cell color.',
  }),
  alignment: defineMessage({
    id: 'table.controls.alignment', defaultValue: 'Alignment', owner: '@domternal/extension-table',
    description: 'Table UI: Alignment.',
  }),
  mergeCells: defineMessage({
    id: 'table.controls.mergeCells', defaultValue: 'Merge cells', owner: '@domternal/extension-table',
    description: 'Table UI: Merge cells.',
  }),
  splitCell: defineMessage({
    id: 'table.controls.splitCell', defaultValue: 'Split cell', owner: '@domternal/extension-table',
    description: 'Table UI: Split cell.',
  }),
  toggleHeader: defineMessage({
    id: 'table.controls.toggleHeader', defaultValue: 'Toggle header cell', owner: '@domternal/extension-table',
    description: 'Table UI: Toggle header cell.',
  }),
  insertRowAbove: defineMessage({
    id: 'table.row.insertAbove', defaultValue: 'Insert Row Above', owner: '@domternal/extension-table',
    description: 'Table UI: Insert Row Above.',
  }),
  insertRowBelow: defineMessage({
    id: 'table.row.insertBelow', defaultValue: 'Insert Row Below', owner: '@domternal/extension-table',
    description: 'Table UI: Insert Row Below.',
  }),
  deleteRow: defineMessage({
    id: 'table.row.delete', defaultValue: 'Delete Row', owner: '@domternal/extension-table',
    description: 'Table UI: Delete Row.',
  }),
  insertColumnLeft: defineMessage({
    id: 'table.column.insertLeft', defaultValue: 'Insert Column Left', owner: '@domternal/extension-table',
    description: 'Table UI: Insert Column Left.',
  }),
  insertColumnRight: defineMessage({
    id: 'table.column.insertRight', defaultValue: 'Insert Column Right', owner: '@domternal/extension-table',
    description: 'Table UI: Insert Column Right.',
  }),
  deleteColumn: defineMessage({
    id: 'table.column.delete', defaultValue: 'Delete Column', owner: '@domternal/extension-table',
    description: 'Table UI: Delete Column.',
  }),
  backgroundColor: defineMessage({
    id: 'table.cell.backgroundColor', defaultValue: 'Cell background color', owner: '@domternal/extension-table',
    description: 'Table UI: Cell background color.',
  }),
  defaultColor: defineMessage({
    id: 'table.cell.defaultColor', defaultValue: 'Default color', owner: '@domternal/extension-table',
    description: 'Table UI: Default color.',
  }),
  defaultColorText: defineMessage({
    id: 'table.cell.defaultColorText', defaultValue: 'Default', owner: '@domternal/extension-table',
    description: 'Table UI: Default.',
  }),
  cellAlignment: defineMessage({
    id: 'table.cell.alignment', defaultValue: 'Cell alignment', owner: '@domternal/extension-table',
    description: 'Table UI: Cell alignment.',
  }),
  alignLeft: defineMessage({
    id: 'table.cell.alignLeft', defaultValue: 'Align left', owner: '@domternal/extension-table',
    description: 'Table UI: Align left.',
  }),
  alignCenter: defineMessage({
    id: 'table.cell.alignCenter', defaultValue: 'Align center', owner: '@domternal/extension-table',
    description: 'Table UI: Align center.',
  }),
  alignRight: defineMessage({
    id: 'table.cell.alignRight', defaultValue: 'Align right', owner: '@domternal/extension-table',
    description: 'Table UI: Align right.',
  }),
  alignTop: defineMessage({
    id: 'table.cell.alignTop', defaultValue: 'Align top', owner: '@domternal/extension-table',
    description: 'Table UI: Align top.',
  }),
  alignMiddle: defineMessage({
    id: 'table.cell.alignMiddle', defaultValue: 'Align middle', owner: '@domternal/extension-table',
    description: 'Table UI: Align middle.',
  }),
  alignBottom: defineMessage({
    id: 'table.cell.alignBottom', defaultValue: 'Align bottom', owner: '@domternal/extension-table',
    description: 'Table UI: Align bottom.',
  }),
} as const;
