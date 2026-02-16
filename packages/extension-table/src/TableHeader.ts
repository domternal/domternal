/**
 * TableHeader Node
 *
 * Table header cell (<th>). Contains block content.
 * Same attributes as TableCell (colspan, rowspan, colwidth).
 */

import { Node } from '@domternal/core';

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
    return {
      colspan: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const colspan = element.getAttribute('colspan');
          return colspan ? Number(colspan) : 1;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const colspan = attrs['colspan'] as number;
          if (colspan === 1) return null;
          return { colspan };
        },
      },
      rowspan: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const rowspan = element.getAttribute('rowspan');
          return rowspan ? Number(rowspan) : 1;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const rowspan = attrs['rowspan'] as number;
          if (rowspan === 1) return null;
          return { rowspan };
        },
      },
      colwidth: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const colwidth = element.getAttribute('data-colwidth');
          return colwidth ? colwidth.split(',').map(Number) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const colwidth = attrs['colwidth'] as number[] | null;
          if (!colwidth) return null;
          return { 'data-colwidth': colwidth.join(',') };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'th' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['th', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
