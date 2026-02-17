/**
 * Shared cell attributes for TableCell and TableHeader.
 * Both node types support the same colspan, rowspan, colwidth, and background attributes.
 */

export function cellAttributes() {
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
  };
}
