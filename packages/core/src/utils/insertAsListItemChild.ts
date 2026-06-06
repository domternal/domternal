import type { Node as PMNode } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

export interface InsertAsListItemChildArgs {
  /** Existing transaction to mutate. Caller dispatches. */
  tr: Transaction;
  /** Position of the list wrapper node (bulletList / orderedList / taskList) in `tr.doc`. */
  wrapperPos: number;
  /**
   * Position of the target list item node (= position right BEFORE the
   * item) in `tr.doc`. When omitted, the wrapper's LAST child is used,
   * matching the Tab keyboard behaviour ("indent into last item").
   */
  targetItemPos?: number;
  /** Block node to insert. */
  blockNode: PMNode;
  /** Optional source range to delete in the same tr (turns insert into a MOVE). */
  sourceRange?: { from: number; to: number };
  /**
   * Child index to insert at. Clamped to `>= 1` (index 0 is the label
   * paragraph). Omitted or `>= childCount` appends as the last child.
   */
  childIndex?: number;
}

export interface InsertAsListItemChildResult {
  /** True when schema accepted the insertion and `tr` was mutated. */
  ok: boolean;
  /**
   * Position right BEFORE the inserted block in the resulting doc.
   * Caller can resolve `insertedAt + 1` to place the caret inside the
   * inserted block. Only present when `ok === true`.
   */
  insertedAt?: number;
}

/**
 * Insert `blockNode` into a list item's children at `childIndex` (default:
 * append last; target item defaults to the wrapper's last item). `sourceRange`
 * makes it a MOVE. Returns `{ ok: false }` without mutating `tr` on schema
 * reject or self-drop so callers can fall back to a sibling move.
 */
export function insertAsListItemChild(
  args: InsertAsListItemChildArgs,
): InsertAsListItemChildResult {
  const { tr, wrapperPos, targetItemPos, blockNode, sourceRange, childIndex } = args;

  if (wrapperPos < 0 || wrapperPos >= tr.doc.content.size) return { ok: false };
  const wrapper = tr.doc.nodeAt(wrapperPos);
  if (!wrapper || !LIST_WRAPPER_TYPES.has(wrapper.type.name)) return { ok: false };
  if (wrapper.childCount === 0) return { ok: false };

  let targetItem: PMNode;
  let targetItemStart: number;
  if (targetItemPos !== undefined) {
    if (targetItemPos < 0 || targetItemPos >= tr.doc.content.size) return { ok: false };
    const candidate = tr.doc.nodeAt(targetItemPos);
    if (!candidate || !LIST_ITEM_TYPES.has(candidate.type.name)) return { ok: false };
    // Guard against a mismatched (wrapperPos, targetItemPos) pair.
    if (targetItemPos < wrapperPos + 1 || targetItemPos >= wrapperPos + wrapper.nodeSize) {
      return { ok: false };
    }
    targetItem = candidate;
    targetItemStart = targetItemPos;
  } else {
    const last = wrapper.lastChild;
    if (!last || !LIST_ITEM_TYPES.has(last.type.name)) return { ok: false };
    let pos = wrapperPos + 1;
    for (let i = 0; i < wrapper.childCount - 1; i++) {
      pos += wrapper.child(i).nodeSize;
    }
    targetItem = last;
    targetItemStart = pos;
  }

  // Floor the index at 1 (index 0 is the label); omitted/overflow appends.
  // `insertIndex === childCount` reproduces the legacy append position.
  const childCount = targetItem.childCount;
  const insertIndex =
    childIndex === undefined || childIndex >= childCount ? childCount : Math.max(1, childIndex);

  if (!targetItem.canReplaceWith(insertIndex, insertIndex, blockNode.type)) {
    return { ok: false };
  }

  // Position right before child[insertIndex] in the pre-mutation doc
  // (`posAtIndex(childCount)` is the end-of-content append slot).
  const $item = tr.doc.resolve(targetItemStart + 1);
  const insertPos = $item.posAtIndex(insertIndex, $item.depth);

  if (sourceRange) {
    const { from, to } = sourceRange;
    // Self-drop guard: insertion point lands inside the (expanded) deletion
    // range, so the move is a no-op; bail without corrupting the doc.
    if (insertPos >= from && insertPos <= to) {
      return { ok: false };
    }
    tr.delete(from, to);
    const adjustedInsertPos = insertPos > from ? insertPos - (to - from) : insertPos;
    tr.insert(adjustedInsertPos, blockNode);
    return { ok: true, insertedAt: adjustedInsertPos };
  }

  tr.insert(insertPos, blockNode);
  return { ok: true, insertedAt: insertPos };
}
