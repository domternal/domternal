import { Fragment } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { insertAsListItemChild } from '@domternal/core';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { convertListItemForParent } from './convertListItemForParent.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Moves a block from `sourcePos` and inserts it as the LAST child of
 * the list item at `targetItemPos` inside the wrapper at `wrapperPos`.
 * Shared drop-indent path used by `BlockHandle.performBlockDrop` when
 * `computeDropPlacement` returns `mode: 'nested'`.
 *
 * Behaviour matrix:
 *
 *  - **Non-list source** (paragraph, heading, codeBlock, blockquote,
 *    horizontalRule, image, etc.) - inserted directly as last child of
 *    the target item. Schema (`paragraph block*`) accepts any block in
 *    the trailing slot.
 *  - **List item source** (listItem / taskItem) - wrapped in a fresh
 *    list wrapper of the SAME TYPE as the target's wrapper, with the
 *    source's item type adapted (via `convertListItemForParent`) so a
 *    bulletList listItem dropped into a taskList nested zone becomes a
 *    fresh taskList with a taskItem inside. Result: the dragged item
 *    appears as a nested sublist below the target item's label.
 *
 * Position math is delegated to `insertAsListItemChild` which handles
 * source-before-vs-after-target ordering automatically. Source range
 * is widened via `expandToEmptyWrappers` so single-child containers
 * don't leave empty placeholders behind (matches `moveBlock` semantics).
 *
 * Returns `false` (no mutation) when:
 *   - source position is invalid / no node
 *   - target position falls inside the source range (self-drop)
 *   - schema rejects the resulting structure (caller falls through to
 *     a sibling-style fallback or no-op)
 */
export function moveBlockAsNestedChild(
  tr: Transaction,
  sourcePos: number,
  wrapperPos: number,
  targetItemPos: number,
): boolean {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return false;
  const sourceNode = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return false;
  const sourceEnd = sourcePos + sourceNode.nodeSize;

  // Self-drop guard: target item or its wrapper sits inside the source
  // range. Prevents "move A into A's own subtree" - an invalid op that
  // would otherwise corrupt the document.
  if (targetItemPos >= sourcePos && targetItemPos < sourceEnd) return false;
  if (wrapperPos >= sourcePos && wrapperPos < sourceEnd) return false;

  // Widen the deletion range so a single-child wrapper around the
  // source (e.g., a nested ul whose only li is the source) collapses
  // along with the source, instead of being left as an empty placeholder.
  const { from: expandedFrom, to: expandedTo } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);

  // Pick the block to insert. For a list-item source we wrap it in a
  // fresh list wrapper so the trailing block-slot of the target item
  // (which expects a block, not a bare listItem) accepts the insertion
  // and the result reads as a nested sublist below the target's label.
  let blockNode: PMNode;
  if (LIST_ITEM_TYPES.has(sourceNode.type.name)) {
    const wrapperNode = tr.doc.nodeAt(wrapperPos);
    if (!wrapperNode) return false;
    const adaptedFragment = convertListItemForParent(
      tr.doc.type.schema,
      Fragment.from(sourceNode),
      wrapperNode.type,
    );
    if (adaptedFragment.childCount === 0) return false;
    blockNode = wrapperNode.type.create(null, adaptedFragment);
  } else {
    blockNode = sourceNode;
  }

  const result = insertAsListItemChild({
    tr,
    wrapperPos,
    targetItemPos,
    blockNode,
    sourceRange: { from: expandedFrom, to: expandedTo },
  });
  return result.ok;
}
