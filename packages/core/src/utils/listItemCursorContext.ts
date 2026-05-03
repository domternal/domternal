import type { ResolvedPos } from '@domternal/pm/model';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Read-only context describing where a cursor sits relative to its
 * INNERMOST containing list/task item, when (and only when) the
 * cursor's parent textblock is a paragraph.
 *
 * Why "innermost": users with nested lists (`<ul><li><ul><li>...`)
 * expect Enter behaviour to act on the deepest list item, not the
 * outer one. Walking depth-down ensures correct resolution for the
 * D3 regression case (taskItem > bulletList > listItem children-zone
 * Enter must affect the inner listItem, not the outer taskItem).
 */
export interface ListItemCursorContext {
  /** Depth of the containing list item ancestor in the resolved pos. */
  itemDepth: number;
  /** Position right BEFORE the containing list item in the doc. */
  itemPos: number;
  /**
   * Position right BEFORE the containing list wrapper (bulletList /
   * orderedList / taskList) in the doc. The wrapper sits one depth
   * level above the list item.
   */
  wrapperPos: number;
  /**
   * `true` only when the cursor's parent paragraph is NOT the first
   * child of the list item (i.e. it sits in the children-zone, not
   * in the label slot). This is the gate for "Enter on empty trailing
   * paragraph lifts only that paragraph" behaviour.
   */
  isInChildrenZone: boolean;
  /** `true` when the parent paragraph has no inline content. */
  paragraphIsEmpty: boolean;
  /** `true` when the parent paragraph is the LAST child of the list item. */
  isLastChild: boolean;
  /** Index of the parent paragraph within the list item (0 = label). */
  childIndex: number;
}

/**
 * Resolve list-item cursor context from a `ResolvedPos`. Returns
 * `null` when:
 *  - the cursor's parent textblock is not a paragraph (heading,
 *    codeBlock, etc. - those have their own Enter semantics);
 *  - there is no list item ancestor;
 *  - the schema-shape does not match the expected
 *    `(wrapper > item > paragraph)` chain.
 *
 * Returning `null` is the cue for callers to fall through to default
 * Enter handling. Callers should branch on the returned context's
 * `isInChildrenZone` / `paragraphIsEmpty` flags to decide between
 * "label Enter (existing splitListItem behaviour)" and "children-zone
 * Enter (new lift-empty-only behaviour)".
 */
export function getListItemCursorContext(
  $from: ResolvedPos,
): ListItemCursorContext | null {
  if ($from.parent.type.name !== 'paragraph') return null;

  // Walk up from the paragraph's depth toward the doc root and pick
  // the FIRST list-item ancestor encountered (= innermost when nested).
  let itemDepth = -1;
  for (let d = $from.depth - 1; d > 0; d--) {
    if (LIST_ITEM_TYPES.has($from.node(d).type.name)) {
      itemDepth = d;
      break;
    }
  }
  if (itemDepth === -1) return null;

  // Wrapper is exactly one depth level above the item. The schema
  // guarantees this for valid docs (bulletList/orderedList/taskList
  // can only contain listItem/taskItem children).
  if (itemDepth - 1 < 0) return null;

  const childIndex = $from.index(itemDepth);
  const item = $from.node(itemDepth);

  return {
    itemDepth,
    itemPos: $from.before(itemDepth),
    wrapperPos: $from.before(itemDepth - 1),
    isInChildrenZone: childIndex > 0,
    paragraphIsEmpty: $from.parent.content.size === 0,
    isLastChild: childIndex === item.childCount - 1,
    childIndex,
  };
}
