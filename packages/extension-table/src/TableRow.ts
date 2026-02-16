/**
 * TableRow Node
 *
 * Table row (<tr>). Contains table cells and/or table header cells.
 */

import { Node } from '@domternal/core';

export interface TableRowOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const TableRow = Node.create<TableRowOptions>({
  name: 'tableRow',
  content: '(tableCell | tableHeader)*',
  tableRole: 'row',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'tr' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['tr', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
