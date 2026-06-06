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
  /**
   * Child-array index inside the target item where `blockNode` lands.
   * Index 0 is the immutable label paragraph (schema `paragraph block*`),
   * so values are clamped to `>= 1`. When omitted OR `>= the item's
   * childCount`, `blockNode` is appended as the LAST child (legacy default,
   * byte-identical to the previous behaviour).
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
 * Insert `blockNode` into a list item's children. By default (no
 * `childIndex`) it appends as the LAST child of the target item (or, when
 * `targetItemPos` is omitted, the wrapper's last item). Pass `childIndex`
 * (clamped to `>= 1`, since index 0 is the label paragraph) to land the
 * block at a specific position among the item's children: `1` = first child
 * after the label, `childCount` = append. When `sourceRange` is set, the
 * source range is removed in the same transaction so the op is a clean MOVE.
 * Returns `{ ok: false }` WITHOUT mutating `tr` on schema reject or self-drop
 * so callers can fall through to a sibling-mode fallback.
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

  // Resolve the child-array index. Index 0 is the immutable label
  // paragraph, so the floor is 1. Omitted or past the last child means
  // append-last (legacy). `insertIndex === childCount` yields the exact
  // legacy append position, so the default path is unchanged.
  const childCount = targetItem.childCount;
  const insertIndex =
    childIndex === undefined || childIndex >= childCount ? childCount : Math.max(1, childIndex);

  // Validate the insertion at the ACTUAL index (for append this is the
  // same (childCount, childCount) check as before).
  if (!targetItem.canReplaceWith(insertIndex, insertIndex, blockNode.type)) {
    return { ok: false };
  }

  // Position right BEFORE child[insertIndex], computed from the PRE-mutation
  // doc. For `insertIndex === childCount` this equals
  // `targetItemStart + targetItem.nodeSize - 1` (the legacy append slot).
  let insertPos = targetItemStart + 1;
  for (let i = 0; i < insertIndex; i++) {
    insertPos += targetItem.child(i).nodeSize;
  }

  if (sourceRange) {
    const { from, to } = sourceRange;
    // Self-drop guard: the insertion point sits inside the deletion range
    // (e.g. moving a child to a slot within its own removed span). Caller's
    // guard is primary, but defending here avoids a silent "insert into
    // removed range" that would corrupt the document. `sourceRange` is the
    // EXPANDED range when called from `moveBlockAsNestedChild`.
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
