/**
 * Lifts the list/task item that contains the cursor when the cursor sits
 * in the LABEL paragraph (first child) of that item, so a "CONVERT"
 * slash-menu command (Heading, Code block, Quote, Details) can transform
 * the now-unwrapped block.
 *
 * Two cases, mirroring Notion's "Turn into" (which only changes a block's
 * TYPE and keeps it at its current indentation):
 *
 *   TOP-LEVEL item  -> `liftListItem` dissolves it to a TOP-LEVEL block
 *     (no parent to stay nested under). The parent list splits around it.
 *
 *   NESTED item     -> the block is lifted ONE level, out of its own
 *     list-item wrapping into the PARENT item's children zone (where a
 *     heading/quote/etc. is a valid non-first child). It stays visually
 *     indented under its parent instead of jumping to the top level.
 *     `liftTarget` returns null when the item carries its own sub-blocks
 *     (a heading cannot own children in this schema); the convert then
 *     no-ops rather than producing a malformed lift.
 */
import { liftListItem } from '@domternal/pm/schema-list';
import { liftTarget } from '@domternal/pm/transform';
import type { EditorState, Transaction } from '@domternal/pm/state';
import { findListItemAncestorDepth } from './listItemAncestor.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

/**
 * Activation conditions (single-cursor only):
 *   - selection is empty (single caret)
 *   - cursor's nearest list-item ancestor exists
 *   - cursor's containing block is at index 0 (label slot) of that item
 *   - `tr` has no prior steps (lift steps captured from a fresh state must
 *     replay against the same starting state as `tr`)
 *
 * Returns true if a lift was applied to `tr`. The caller can keep chaining
 * work on `tr` (e.g. `setBlockType`, `wrapIn`) at the new cursor position.
 */
export function liftCurrentListItem(
  state: EditorState,
  tr: Transaction,
): boolean {
  if (!tr.selection.empty) return false;
  if (tr.steps.length !== 0) return false;

  const { $from } = tr.selection;
  const listItemDepth = findListItemAncestorDepth($from);
  if (listItemDepth === -1) return false;
  if ($from.index(listItemDepth) !== 0) return false;

  // Nested when the item's list wrapper sits inside ANOTHER list item.
  // listItemDepth is always >= 2 (doc > list > listItem), so node(depth - 2)
  // is a real ancestor (the doc itself at worst, which is not a list item).
  const wrapperParent = $from.node(listItemDepth - 2);
  const isNested = LIST_ITEM_TYPES.has(wrapperParent.type.name);

  if (isNested) {
    // Keep the block at its current indentation: lift it one level into the
    // parent item's children zone rather than out to the top level.
    const range = $from.blockRange();
    if (!range) return false;
    const target = liftTarget(range);
    if (target === null) return false;
    tr.lift(range, target);
    return true;
  }

  // Top-level item: dissolve it to a top-level block.
  const listItemType = $from.node(listItemDepth).type;
  return liftListItem(listItemType)(state, (liftTr) => {
    for (const step of liftTr.steps) tr.step(step);
    if (liftTr.selectionSet) tr.setSelection(liftTr.selection);
  });
}
