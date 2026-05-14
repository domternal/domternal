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
  /** Block node to append as the LAST child of the target item. */
  blockNode: PMNode;
  /**
   * Optional source range to delete in the SAME transaction (when
   * MOVING an existing block instead of creating a new one). Position
   * math handles source-before-vs-after-target ordering automatically.
   */
  sourceRange?: { from: number; to: number };
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
 * Insert `blockNode` as the LAST child of a list item (target item or, when
 * omitted, the wrapper's last item). When `sourceRange` is set, the source
 * range is removed in the same transaction so the op is a clean MOVE.
 * Returns `{ ok: false }` WITHOUT mutating `tr` on schema reject so callers
 * can fall through to a sibling-mode fallback.
 */
export function insertAsListItemChild(
  args: InsertAsListItemChildArgs,
): InsertAsListItemChildResult {
  const { tr, wrapperPos, targetItemPos, blockNode, sourceRange } = args;

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
    // Verify the candidate item really sits inside the given wrapper -
    // a mismatched (wrapperPos, targetItemPos) pair would otherwise
    // produce silently-wrong position math.
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

  if (!targetItem.canReplaceWith(targetItem.childCount, targetItem.childCount, blockNode.type)) {
    return { ok: false };
  }

  // Position right BEFORE the item's close token = end of its content,
  // where a new last-child is appended. Computed from the PRE-mutation
  // doc so the offset reflects the layout the caller can reason about.
  const targetItemContentEnd = targetItemStart + targetItem.nodeSize - 1;

  if (sourceRange) {
    const { from, to } = sourceRange;
    // Self-drop guard: target sits inside the deletion range. Caller's
    // responsibility is primary, but defending here avoids a silent
    // "insert into removed range" that would corrupt the document.
    if (targetItemContentEnd >= from && targetItemContentEnd <= to) {
      return { ok: false };
    }
    tr.delete(from, to);
    const adjustedInsertPos =
      targetItemContentEnd > from ? targetItemContentEnd - (to - from) : targetItemContentEnd;
    tr.insert(adjustedInsertPos, blockNode);
    return { ok: true, insertedAt: adjustedInsertPos };
  }

  tr.insert(targetItemContentEnd, blockNode);
  return { ok: true, insertedAt: targetItemContentEnd };
}
