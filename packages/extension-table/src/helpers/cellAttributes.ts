/**
 * Shared cell attributes for TableCell and TableHeader.
 * Both node types support the same colspan, rowspan, colwidth, background,
 * textAlign and verticalAlign attributes.
 *
 * Note: textAlign and verticalAlign use data-* attributes (not inline style)
 * to avoid overwriting the background inline style. CSS attribute selectors
 * in _table-controls.scss apply the actual text-align / vertical-align.
 */
import type { AttributeSpecs } from '@domternal/core';

export function cellAttributes(): AttributeSpecs {
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
    background: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        return element.getAttribute('data-background') ?? (element.style.backgroundColor || null);
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const bg = attrs['background'] as string | null;
        if (!bg) return null;
        return { 'data-background': bg, style: `background-color: ${bg}` };
      },
    },
    textAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        return element.getAttribute('data-text-align') || null;
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const align = attrs['textAlign'] as string | null;
        if (!align) return null;
        return { 'data-text-align': align };
      },
    },
    verticalAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        return element.getAttribute('data-vertical-align') || null;
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const align = attrs['verticalAlign'] as string | null;
        if (!align) return null;
        return { 'data-vertical-align': align };
      },
    },
  };
}
