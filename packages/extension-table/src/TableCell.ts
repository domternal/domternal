/**
 * TableCell Node
 *
 * Table data cell (<td>). Contains block content.
 * Supports colspan, rowspan, colwidth, and background attributes.
 */

import { Node } from '@domternal/core';
import { cellAttributes } from './helpers/cellAttributes.js';

export interface TableCellOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const TableCell = Node.create<TableCellOptions>({
  name: 'tableCell',
  content: 'block+',
  tableRole: 'cell',
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return cellAttributes();
  },

  parseHTML() {
    return [{ tag: 'td' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['td', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
