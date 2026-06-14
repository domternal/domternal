import { Fragment } from '@domternal/pm/model';
import type { ResolvedPos } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import { expandToEmptyWrappers } from './expandToEmptyWrappers.js';
import { rejoinAtSeam } from './rejoinAtSeam.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Move a top-level block from `sourcePos` to `targetPos` in-place. Single source
 * of truth for block reorder position math (BlockHandle drag-drop, KeyboardReorder).
 *
 * A list item keeps its OWN list kind everywhere (Notion: kind travels with the
 * block, never with the destination). It JOINS only a list of the same kind;
 * dropped into a list of a different kind, or at a non-list gap, it is re-wrapped
 * in a fresh same-kind list (so a numbered item among bullets stays its own
 * one-item ordered list). A non-list block dropped at a sibling gap inside a list
 * splits the list around it (see `insertBlockSplittingList`). The deletion range
 * first expands outward to swallow single-child wrapper ancestors (else PM's
 * fitter leaves an empty `<li>` placeholder). Same-type lists left touching after
 * the move are healed by `rejoinAtSeam` at both the source seam and the
 * destination. Self-drops (target inside the expanded deletion range) return the
 * transaction unchanged.
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
  // The source item's OWN list wrapper type, captured before the delete: a list
  // item keeps this kind when dropped into a different-kind list or at a non-list
  // gap, instead of adopting the destination's kind.
  const sourceWrapperType = tr.doc.resolve(sourcePos).parent.type;

  const { from, to } = expandToEmptyWrappers(tr.doc, sourcePos, sourceEnd);
  if (targetPos >= from && targetPos <= to) return tr;

  const stepsBefore = tr.steps.length;
  // Slice ONLY the source node, not the redundant single-child wrappers we're
  // about to remove (they shouldn't travel with the source to its new location).
  const slice = tr.doc.slice(sourcePos, sourceEnd);
  tr.delete(from, to);
  const adjustedTarget = targetPos > from
    ? targetPos - (to - from)
    : targetPos;

  const $target = tr.doc.resolve(adjustedTarget);
  const targetParent = $target.parent;

  // A list item JOINS only a list of its OWN kind (same wrapper type). Every
  // other case keeps the item's kind: a different-kind list splits around a fresh
  // same-kind wrapper, a non-list block splits the list directly. A matching-kind
  // item (and any non-list-gap target) falls through to the join/insert branch.
  const targetWrapperName = LIST_WRAPPER_TYPES.has(targetParent.type.name) ? targetParent.type.name : null;
  const sourceIsListItem = LIST_ITEM_TYPES.has(sourceNode.type.name);
  const splitsList = targetWrapperName !== null
    && (!sourceIsListItem || sourceWrapperType.name !== targetWrapperName);
  if (splitsList) {
    const content = sourceIsListItem
      ? Fragment.from(sourceWrapperType.create(null, slice.content))
      : slice.content;
    insertBlockSplittingList(tr, $target, content);
  } else {
    // Same-kind list item joins as a sibling. A list item dropped at a NON-list
    // gap (top-level, blockquote, children zone) keeps its kind as a fresh
    // one-item list instead of letting PM's fitter pick a wrapper by schema
    // registration order. Other blocks insert as-is.
    const adaptedContent = sourceIsListItem && targetWrapperName === null
      ? Fragment.from(sourceWrapperType.create(null, slice.content))
      : slice.content;
    tr.insert(adjustedTarget, adaptedContent);
    // Destination heal: a same-kind list dropped flush against another merges
    // into one run (whole-list reorder, or a re-wrapped item beside its old
    // list). Trailing edge first so the leading edge position stays valid.
    rejoinAtSeam(tr, adjustedTarget + adaptedContent.size);
    rejoinAtSeam(tr, adjustedTarget);
  }

  // Source-seam heal: removing the block may leave two same-type lists touching
  // where it sat (e.g. a heading that split a list in two, dragged back out),
  // clearing any stale ordered-list `start` on the second half.
  rejoinAtSeam(tr, tr.mapping.slice(stepsBefore).map(from));
  return tr;
}

/**
 * Inserts `content` (the dragged block, type preserved) at the sibling gap
 * `$gap` points at inside a list wrapper, splitting the wrapper so the block
 * lands at its PARENT level (the document or enclosing list item). The list
 * breaks around the block (Notion behaviour).
 *
 *   - gap before the first item -> insert before the whole wrapper
 *   - gap after the last item   -> insert after the whole wrapper
 *   - gap between two items      -> split the wrapper, insert in between
 *
 * The trailing half of a split ordered list restarts at 1 (Notion breaks a
 * numbered run at any interrupter), which is just the default `start` PM's split
 * copies; no renumbering is applied. Exported for SmartPaste, which splits the
 * host list the same way when a pasted block can't join it. Returns the position
 * right before the inserted content (for caret placement).
 */
export function insertBlockSplittingList(tr: Transaction, $gap: ResolvedPos, content: Fragment): number {
  const wrapper = $gap.parent;
  const index = $gap.index();
  if (index === 0) {
    const at = $gap.before();
    tr.insert(at, content);
    return at;
  }
  if (index === wrapper.childCount) {
    const at = $gap.after();
    tr.insert(at, content);
    return at;
  }
  const splitPos = $gap.pos;
  tr.split(splitPos, 1);
  const at = splitPos + 1;
  tr.insert(at, content);
  return at;
}
