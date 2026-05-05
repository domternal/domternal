import type { ResolvedPos } from '@domternal/pm/model';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Read-only context describing where a cursor sits relative to its
 * INNERMOST containing list/task item, when (and only when) the
 * cursor's parent textblock is a paragraph that is a DIRECT child of
 * the list item.
 *
 * Why "innermost": users with nested lists (`<ul><li><ul><li>...`)
 * expect Enter behaviour to act on the deepest list item, not the
 * outer one. Walking depth-down ensures correct resolution for the
 * D3 regression case (taskItem > bulletList > listItem children-zone
 * Enter must affect the inner listItem, not the outer taskItem).
 *
 * Why "direct child": if the cursor's paragraph is nested inside an
 * intermediate container (blockquote, table cell, etc.) inside a list
 * item, the right Enter/Backspace behaviour belongs to that container,
 * not to the list item. Returning null in that case lets the
 * Enter/Backspace handler fall through to the default chain.
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
  /**
   * Index of the containing list item within its wrapper (= position of
   * the listItem in the bulletList / orderedList / taskList children).
   * Avoids a linear walk in callers that need to know "is this li the
   * last item" or "split the wrapper after this item".
   */
  itemIndexInWrapper: number;
}

/**
 * Resolve list-item cursor context from a `ResolvedPos`. Returns
 * `null` when:
 *  - the cursor's parent textblock is not a paragraph (heading,
 *    codeBlock, etc. - those have their own Enter semantics);
 *  - the paragraph is not a DIRECT child of a list item (e.g.
 *    nested inside a blockquote / table cell / details inside the
 *    list item);
 *  - there is no list item ancestor;
 *  - the schema-shape does not match the expected
 *    `(wrapper > item > paragraph)` chain.
 *
 * Returning `null` is the cue for callers to fall through to default
 * Enter / Backspace handling. Callers should branch on the returned
 * context's `isInChildrenZone` / `paragraphIsEmpty` flags to decide
 * between "label Enter (existing splitListItem behaviour)" and
 * "children-zone Enter (accumulate / lift behaviour)".
 */
export function getListItemCursorContext(
  $from: ResolvedPos,
): ListItemCursorContext | null {
  if ($from.parent.type.name !== 'paragraph') return null;

  // The paragraph's IMMEDIATE parent must be a list item. If the
  // paragraph is nested inside another container (blockquote, table
  // cell, etc.) inside a list item, the cursor's effective context is
  // the container, not the list item - the relevant Enter/Backspace
  // semantics belong there.
  const itemDepth = $from.depth - 1;
  if (itemDepth < 1) return null;
  const itemNode = $from.node(itemDepth);
  if (!LIST_ITEM_TYPES.has(itemNode.type.name)) return null;

  // Wrapper is exactly one depth level above the item. The schema
  // guarantees this for valid docs (bulletList/orderedList/taskList
  // can only contain listItem/taskItem children).
  const wrapperDepth = itemDepth - 1;
  const childIndex = $from.index(itemDepth);

  return {
    itemDepth,
    itemPos: $from.before(itemDepth),
    wrapperPos: $from.before(wrapperDepth),
    isInChildrenZone: childIndex > 0,
    paragraphIsEmpty: $from.parent.content.size === 0,
    isLastChild: childIndex === itemNode.childCount - 1,
    childIndex,
    itemIndexInWrapper: $from.index(wrapperDepth),
  };
}
