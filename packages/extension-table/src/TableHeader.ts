/**
 * TableHeader Node
 *
 * Table header cell (<th>). Contains block content.
 * Same attributes as TableCell (colspan, rowspan, colwidth, background).
 */

import { Node } from '@domternal/core';
import { cellAttributes } from './helpers/cellAttributes.js';

export interface TableHeaderOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const TableHeader = Node.create<TableHeaderOptions>({
  name: 'tableHeader',
  content: 'block+',
  tableRole: 'header_cell',
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
    return [{ tag: 'th' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['th', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
