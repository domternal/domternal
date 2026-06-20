import { Fragment } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { insertAsListItemChild } from '@domternal/core';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { rejoinAtSeam } from './rejoinAtSeam.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Moves the block at `sourcePos` into the list item at `targetItemPos` (wrapper
 * `wrapperPos`) at `childIndex` (default: append last). Used by `performBlockDrop`
 * for `mode: 'nested'`.
 *
 * A non-list block inserts directly; a listItem/taskItem keeps its OWN list kind
 * (Notion: nesting never changes type, and a to-do keeps its checked state) by
 * being wrapped in a fresh same-kind list, then merged with an adjacent
 * same-kind sublist so it doesn't form a redundant second list. Returns `false`
 * (no mutation) on invalid source, self-drop, or schema reject.
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

  // The source item's OWN list wrapper type: a list item keeps its kind (and a
  // to-do keeps its checked state) when nested, instead of adopting the target's.
  const sourceWrapperType = tr.doc.resolve(sourcePos).parent.type;

  const stepsBefore = tr.steps.length;
  // Widen the deletion so a single-child wrapper collapses with the source.
  const { from: expandedFrom, to: expandedTo } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);

  // A list-item source is wrapped in a fresh list of its OWN kind (the item slot
  // expects a block, not a bare listItem); other blocks go in as-is.
  let blockNode: PMNode;
  const wrapped = LIST_ITEM_TYPES.has(sourceNode.type.name);
  if (wrapped) {
    blockNode = sourceWrapperType.create(null, Fragment.from(sourceNode));
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

  // Merge with an adjacent same-KIND sublist instead of forming a second list.
  // `rejoinAtSeam` gates on equal wrapper types, so an ordered sublist nested
  // beside a bullet one is NOT silently re-converted (both share `listItem`
  // content, so a bare `canJoin` would merge them). Trailing boundary first
  // (higher pos) so the leading one stays valid.
  if (wrapped) {
    rejoinAtSeam(tr, result.insertedAt + blockNode.nodeSize);
    rejoinAtSeam(tr, result.insertedAt);
  }

  // Source-seam heal: removing the source may leave two same-type lists touching
  // where it sat (matches moveBlock; e.g. a to-do lifted out of a bullet run).
  rejoinAtSeam(tr, tr.mapping.slice(stepsBefore).map(expandedFrom));
  return true;
}
