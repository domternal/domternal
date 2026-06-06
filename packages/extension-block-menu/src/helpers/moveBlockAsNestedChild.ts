import { Fragment } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { insertAsListItemChild } from '@domternal/core';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { convertListItemForParent } from './convertListItemForParent.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Moves the block at `sourcePos` into the list item at `targetItemPos`
 * (wrapper `wrapperPos`) at `childIndex` (default: append last). Drop-indent
 * path used by `performBlockDrop` for `mode: 'nested'`.
 *
 * By source type: a non-list block goes in directly; a listItem/taskItem is
 * wrapped in a fresh target-type list (adapted via `convertListItemForParent`)
 * so it reads as a nested sublist. Position math + ordering is delegated to
 * `insertAsListItemChild`; the deletion range is widened via
 * `expandToEmptyWrappers`. Returns `false` (no mutation) on invalid source,
 * self-drop, or schema reject.
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

  // Widen the deletion so a single-child wrapper around the source collapses
  // with it instead of leaving an empty placeholder.
  const { from: expandedFrom, to: expandedTo } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);

  // A list-item source is wrapped in a fresh list (the item slot expects a
  // block, not a bare listItem); other blocks insert as-is.
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
    // Spread: exactOptionalPropertyTypes forbids passing `childIndex: undefined`.
    ...(childIndex !== undefined ? { childIndex } : {}),
  });
  return result.ok;
}
