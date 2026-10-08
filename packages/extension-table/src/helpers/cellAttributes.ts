/**
 * Shared cell attributes for TableCell and TableHeader.
 * Both node types support the same colspan, rowspan, colwidth, background,
 * textAlign and verticalAlign attributes.
 *
 * Note: textAlign and verticalAlign use data-* attributes (not inline style)
 * to avoid overwriting the background inline style. CSS attribute selectors
 * in _table-controls.scss apply the actual text-align / vertical-align.
 *
 * colspan and rowspan accept any whole number from 1. Loading JSON content
 * replaces an invalid span or one above 1,000 by the span a browser draws for
 * it and reports unsupported-table-span; rendering draws that span without
 * changing a stored value, which normalizeContentAttributes migrates.
 *
 * The background is written into the style attribute, and inline styles
 * (getHTML({ styled: true }), inlineStyles) turn both alignments into
 * declarations, so each renders only when it is a safe CSS value: one that
 * cannot add a declaration or load a resource.
 */
import { isSafeCssValue, registerAttributeNormalizer } from '@domternal/core';
import type { AttributeSpecs } from '@domternal/core';

/** An alignment to parse or render: a safe CSS value, or null. The document keeps any stored value. */
function safeAlignment(value: unknown): string | null {
  return value && isSafeCssValue(value) ? value as string : null;
}

/** Cell attributes written into a declaration, which setCellAttribute accepts only as safe CSS values. */
export const CSS_CELL_ATTRIBUTES: ReadonlySet<string> = new Set(['background', 'textAlign', 'verticalAlign']);

// The widest span a parsed or loaded cell keeps: a browser draws no wider
// column span, and prosemirror-tables builds its table map cell by cell for
// every spanned row and column, so an unbounded span could exhaust memory.
// PasteCleanup refuses a pasted span above the same bound.
export const MAX_SPAN = 1000;
// HTML's rules for a non-negative integer: leading white space, an optional
// plus sign, then digits up to the first other character.
const SPAN = /^[\t\n\f\r ]*\+?(\d+)/;

/** A colspan or rowspan attribute read as a browser reads it: 1 when missing, invalid or 0, at most 1,000. */
function parseSpan(written: string | null): number {
  const digits = written === null ? undefined : SPAN.exec(written)?.[1];
  const span = digits === undefined ? 0 : Number(digits);
  return span < 1 ? 1 : Math.min(span, MAX_SPAN);
}

/** Whether schema validation rejects a span: anything but a whole number from 1. */
function invalidSpan(value: unknown): boolean {
  return !Number.isSafeInteger(value) || (value as number) < 1;
}

/**
 * The validator of colspan and rowspan. Any whole number from 1 is valid, so
 * a document that an older client stored with a span above 1,000 still loads
 * strictly, as `Node.check` and `Step.fromJSON` do.
 */
export function validateSpan(value: unknown): void {
  if (invalidSpan(value)) throw new RangeError('Invalid table span');
}

/**
 * The span a stored colspan or rowspan draws, as a browser draws it: a number
 * rounded down into 1 to 1,000, a string read as an HTML span attribute, and
 * 1 for anything else. A supported span is itself.
 */
export function resolveSpan(value: unknown): number {
  if (typeof value === 'string') return parseSpan(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.min(MAX_SPAN, Math.max(1, Math.floor(value)));
}

export function cellAttributes(): AttributeSpecs {
  // Registered with the attribute specs, before a schema that holds them is normalized.
  registerAttributeNormalizer(validateSpan, {
    code: 'unsupported-table-span',
    invalid: invalidSpan,
    unsupported: value => invalidSpan(value) || (value as number) > MAX_SPAN,
    replacement: resolveSpan,
  });
  return {
    colspan: {
      default: 1,
      validate: validateSpan,
      parseHTML: (element: HTMLElement) => parseSpan(element.getAttribute('colspan')),
      // A stored span loading would replace renders as its replacement; the document keeps it.
      renderHTML: (attrs: Record<string, unknown>) => {
        const colspan = resolveSpan(attrs['colspan']);
        if (colspan === 1) return null;
        return { colspan };
      },
    },
    rowspan: {
      default: 1,
      validate: validateSpan,
      parseHTML: (element: HTMLElement) => parseSpan(element.getAttribute('rowspan')),
      renderHTML: (attrs: Record<string, unknown>) => {
        const rowspan = resolveSpan(attrs['rowspan']);
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
        // An unsafe data-background falls back to the one property CSSOM read.
        const data = element.getAttribute('data-background');
        if (data !== null && isSafeCssValue(data)) return data;
        return element.style.backgroundColor || null;
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const bg = attrs['background'];
        // A stored value that could add a declaration or load a resource is
        // not written; the document keeps it.
        if (!bg || !isSafeCssValue(bg)) return null;
        return { 'data-background': bg as string, style: `background-color: ${bg as string}` };
      },
    },
    textAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => safeAlignment(element.getAttribute('data-text-align')),
      renderHTML: (attrs: Record<string, unknown>) => {
        const align = safeAlignment(attrs['textAlign']);
        return align === null ? null : { 'data-text-align': align };
      },
    },
    verticalAlign: {
      default: null,
      parseHTML: (element: HTMLElement) => safeAlignment(element.getAttribute('data-vertical-align')),
      renderHTML: (attrs: Record<string, unknown>) => {
        const align = safeAlignment(attrs['verticalAlign']);
        return align === null ? null : { 'data-vertical-align': align };
      },
    },
  };
}
