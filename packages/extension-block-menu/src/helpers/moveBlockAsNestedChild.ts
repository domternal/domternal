import { Fragment } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { canJoin } from '@domternal/pm/transform';
import { insertAsListItemChild } from '@domternal/core';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { convertListItemForParent } from './convertListItemForParent.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Moves the block at `sourcePos` into the list item at `targetItemPos` (wrapper
 * `wrapperPos`) at `childIndex` (default: append last). Used by `performBlockDrop`
 * for `mode: 'nested'`.
 *
 * A non-list block inserts directly; a listItem/taskItem is wrapped in a fresh
 * target-type list (via `convertListItemForParent`) and joined with an adjacent
 * same-type sublist so it MERGES rather than forming a second list. Returns
 * `false` (no mutation) on invalid source, self-drop, or schema reject.
 */
export function moveBlockAsNestedChild(
  tr: Transaction,
  sourcePos: number,
  wrapperPos: number,
  targetItemPos: number,
  childIndex?: number,
): boolean {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return false;
  const sourceNode = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return false;
  const sourceEnd = sourcePos + sourceNode.nodeSize;

  // Self-drop guard: don't move A into its own subtree.
  if (targetItemPos >= sourcePos && targetItemPos < sourceEnd) return false;
  if (wrapperPos >= sourcePos && wrapperPos < sourceEnd) return false;

  // Widen the deletion so a single-child wrapper collapses with the source.
  const { from: expandedFrom, to: expandedTo } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);

  // A list-item source needs wrapping in a fresh list (the item slot expects a
  // block, not a bare listItem); other blocks go in as-is.
  let blockNode: PMNode;
  const wrapped = LIST_ITEM_TYPES.has(sourceNode.type.name);
  if (wrapped) {
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
    // Spread: exactOptionalPropertyTypes forbids passing `childIndex: undefined`.
    ...(childIndex !== undefined ? { childIndex } : {}),
  });
  if (!result.ok || result.insertedAt === undefined) return result.ok;

  // Merge with an adjacent same-type sublist instead of forming a second list.
  // Trailing boundary first (higher pos) so the leading one stays valid;
  // `canJoin` no-ops across incompatible types.
  if (wrapped) {
    const after = result.insertedAt + blockNode.nodeSize;
    if (after < tr.doc.content.size && canJoin(tr.doc, after)) tr.join(after);
    const before = result.insertedAt;
    if (before > 0 && canJoin(tr.doc, before)) tr.join(before);
  }
  return true;
}
