import type { Transaction } from '@domternal/pm/state';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';

/**
 * Moves a top-level block from `sourcePos` to `targetPos` in-place on the
 * given transaction. Single source of truth for block reorder position math:
 * used by BlockHandle drag-drop and KeyboardReorder shortcuts.
 *
 * Position math:
 * - Slice the source node first (before delete).
 * - Expand the deletion range outward to swallow any single-child wrapper
 *   ancestors (e.g. a nested `ul` whose only `li` is the source) — leaving
 *   them behind would either violate their `listItem+`-style content rule
 *   (PM's fitter then keeps an empty `<li>` placeholder, which is the bug
 *   we're fixing) or leave a no-op container behind.
 * - Delete the (possibly expanded) range.
 * - Adjust target: if target was after the source, subtract the removed size
 *   because positions after the deletion shift left.
 * - Insert the slice at the adjusted target.
 *
 * Self-drop safety:
 * - If `targetPos` falls inside the expanded deletion range, return the
 *   transaction unchanged (moving a block into itself or its wrapper is
 *   invalid).
 * - If there's no node at `sourcePos`, return unchanged.
 *
 * Returns the same transaction (chainable), not a new one.
 */
export function moveBlock(
  tr: Transaction,
  sourcePos: number,
  targetPos: number,
): Transaction {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return tr;
  const sourceNode = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return tr;
  const sourceEnd = sourcePos + sourceNode.nodeSize;

  const { from, to } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);
  if (targetPos >= from && targetPos <= to) return tr;

  // Slice ONLY the source node (not the wrappers we're about to remove —
  // they exist purely as redundant single-child containers and should not
  // travel with the source to its new location).
  const slice = tr.doc.slice(sourcePos, sourceEnd);
  tr.delete(from, to);
  const adjustedTarget = targetPos > from
    ? targetPos - (to - from)
    : targetPos;
  tr.insert(adjustedTarget, slice.content);
  return tr;
}

