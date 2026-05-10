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
 *
 * Heading id source: `attrName` (default `'id'`) reads from the heading
 * node's attrs. Domternal's `UniqueID` extension assigns this id; if the
 * id is missing (UniqueID not loaded, or the node was created without
 * passing through the id-assigning plugin), the entry reports `id: ''`.
 */
import type { Node as PMNode } from '@domternal/pm/model';
import type { HeadingEntry } from '../types.js';

export type HeadingWalkEntry = Omit<HeadingEntry, 'domNode' | 'isActive' | 'isScrolledOver'>;

export interface HeadingWalkOptions {
  /** Levels to include. */
  levels: number[];
  /** Node names treated as anchors. */
  anchorTypes: string[];
  /**
   * Attribute name on heading nodes that holds the stable id. Defaults
   * to `'id'`, matching `UniqueID`'s default `attributeName`. Override
   * only when the consumer customizes `UniqueID.configure({ attributeName })`.
   * @default 'id'
   */
  attrName?: string;
}

/**
 * Walk the document and collect heading-like nodes. Output is in
 * document order; entries without a stored id (under `attrName`) report
 * `id: ''` so the caller can decide whether to filter or surface them
 * as "unanchored".
 */
export function walkHeadings(doc: PMNode, options: HeadingWalkOptions): HeadingWalkEntry[] {
  const { levels, anchorTypes, attrName = 'id' } = options;
  const result: HeadingWalkEntry[] = [];

  doc.descendants((node, pos) => {
    if (!anchorTypes.includes(node.type.name)) return;
    const rawLevel: unknown = node.attrs['level'];
    const level = typeof rawLevel === 'number' ? rawLevel : 1;
    if (!levels.includes(level)) return;

    const rawId: unknown = node.attrs[attrName];
    result.push({
      id: typeof rawId === 'string' ? rawId : '',
      level,
      textContent: node.textContent,
      pos,
    });
  });

  return result;
}
