/**
 * Lifts the list/task item that contains the cursor when the cursor sits
 * in the LABEL paragraph (first child) of that item. PM's `liftListItem`
 * splits the parent list naturally so siblings before/after end up in
 * separate lists, and the lifted item becomes a top-level paragraph
 * carrying the original content.
 *
 * Used by "CONVERT" slash-menu commands (Heading, Code block, Quote,
 * Details) to escape a list-item label before re-typing or wrapping
 * the now top-level paragraph.
 */
import { liftListItem } from '@domternal/pm/schema-list';
import type { EditorState, Transaction } from '@domternal/pm/state';

const LIST_ITEM_TYPE_NAMES = new Set(['listItem', 'taskItem']);

/**
 * Activation conditions (single-cursor only):
 *   - selection is empty (single caret)
 *   - cursor's nearest list-item ancestor exists
 *   - cursor's containing block is at index 0 (label slot) of that item
 *   - `tr` has no prior steps (lift steps captured from a fresh state must
 *     replay against the same starting state as `tr`)
 *
 * Returns true if the lift was applied to `tr`. The caller can keep
 * chaining work on `tr` (e.g. `setBlockType`, `wrapIn`) on the new
 * top-level paragraph.
 */
export function liftCurrentListItem(
  state: EditorState,
  tr: Transaction,
): boolean {
  if (!tr.selection.empty) return false;
  if (tr.steps.length !== 0) return false;

  const { $from } = tr.selection;
  let listItemDepth = -1;
  for (let d = $from.depth; d >= 1; d--) {
    if (LIST_ITEM_TYPE_NAMES.has($from.node(d).type.name)) {
      listItemDepth = d;
      break;
    }
  }
  if (listItemDepth === -1) return false;
  if ($from.index(listItemDepth) !== 0) return false;

  const listItemType = $from.node(listItemDepth).type;
  return liftListItem(listItemType)(state, (liftTr) => {
    for (const step of liftTr.steps) tr.step(step);
    if (liftTr.selectionSet) tr.setSelection(liftTr.selection);
  });
}
