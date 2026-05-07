/**
 * Heading walk - pure function over a PM document.
 *
 * Returns one entry per heading node whose level matches the configured
 * filter, in document order. Recurses into nested structures (blockquote,
 * list items, details, etc.) so a heading inside a container still
 * surfaces in the outline. The doc walk is O(n) in node count; we leave
 * cheaper-but-incremental tracking to the consumer's transaction guard.
 *
 * The returned tuple shape is intentionally a SUBSET of `HeadingEntry`
 * (omitting `domNode`, `isActive`, `isScrolledOver`). Those fields are
 * filled in later by the active-state tracker (Phase 5) once DOM nodes
 * are resolvable.
 */
import type { Node as PMNode } from '@domternal/pm/model';
import type { HeadingEntry } from '../types.js';

export type HeadingWalkEntry = Omit<HeadingEntry, 'domNode' | 'isActive' | 'isScrolledOver'>;

export interface HeadingWalkOptions {
  /** Levels to include. */
  levels: number[];
  /** Node names treated as anchors. */
  anchorTypes: string[];
}

/**
 * Walk the document and collect heading-like nodes. Output is in
 * document order; entries without a `tocId` attribute report `id: ''`
 * (the caller is expected to backfill IDs in a follow-up transaction
 * before relying on `id` for navigation).
 */
export function walkHeadings(doc: PMNode, options: HeadingWalkOptions): HeadingWalkEntry[] {
  const { levels, anchorTypes } = options;
  const result: HeadingWalkEntry[] = [];

  doc.descendants((node, pos) => {
    if (!anchorTypes.includes(node.type.name)) return;
    const rawLevel: unknown = node.attrs['level'];
    const level = typeof rawLevel === 'number' ? rawLevel : 1;
    if (!levels.includes(level)) return;

    const rawId: unknown = node.attrs['tocId'];
    result.push({
      id: typeof rawId === 'string' ? rawId : '',
      level,
      textContent: node.textContent,
      pos,
    });
  });

  return result;
}
