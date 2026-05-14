import type { ResolvedPos } from '@domternal/pm/model';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Cursor context relative to the INNERMOST containing list/task item,
 * resolved only when the cursor's parent paragraph is a DIRECT child of
 * that item. Innermost so nested lists hand control to the deepest item;
 * direct-child so paragraphs inside blockquote/table-cell/etc. inside a
 * list item fall through to the container's own Enter/Backspace.
 */
export interface ListItemCursorContext {
  /** Depth of the containing list item ancestor in the resolved pos. */
  itemDepth: number;
  /** Position right BEFORE the containing list item in the doc. */
  itemPos: number;
  /** Position right BEFORE the containing list wrapper (one depth above the item). */
  wrapperPos: number;
  /** `true` when the parent paragraph is not the first child of the list item. */
  isInChildrenZone: boolean;
  /** `true` when the parent paragraph has no inline content. */
  paragraphIsEmpty: boolean;
  /** `true` when the parent paragraph is the LAST child of the list item. */
  isLastChild: boolean;
  /** Index of the parent paragraph within the list item (0 = label). */
  childIndex: number;
  /** Index of the containing list item within its wrapper. */
  itemIndexInWrapper: number;
}

/**
 * Resolve list-item cursor context. Returns `null` when the cursor's
 * shape does not match `(wrapper > item > paragraph)`; callers should
 * fall through to default Enter/Backspace in that case.
 */
export function getListItemCursorContext(
  $from: ResolvedPos,
): ListItemCursorContext | null {
  if ($from.parent.type.name !== 'paragraph') return null;

  const itemDepth = $from.depth - 1;
  if (itemDepth < 1) return null;
  const itemNode = $from.node(itemDepth);
  if (!LIST_ITEM_TYPES.has(itemNode.type.name)) return null;

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
