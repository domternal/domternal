/**
 * Positions an INSERT-style command at TOP LEVEL when the cursor sits in
 * the LABEL paragraph of a list/task item. Used by Divider, Table, Image,
 * Table-of-Contents (any command that inserts a NEW block of content
 * rather than transforming the cursor's existing line).
 *
 * Behavior mirrors Notion:
 *   - the user's list item stays a list item (its content is preserved)
 *   - the new block is inserted at the document level, AFTER the current
 *     item, splitting the parent list around it when necessary
 *   - if the label is empty, the empty item itself is consumed (so we
 *     don't leave a dangling empty bullet above the inserted block)
 *
 * Returns a `{ from, to }` range that the caller should fill with
 * `tr.replaceWith(from, to, [block, optionalTrailingParagraph])`:
 *   - `from === to` for the non-empty cases (pure insertion)
 *   - `from < to` for the empty case (replacement of the empty paragraph
 *     that PM's `liftListItem` produced - replacement avoids leaving a
 *     stray empty paragraph above the inserted block when the doc would
 *     otherwise become empty)
 */
import { liftListItem } from '@domternal/pm/schema-list';
import type { EditorState, Transaction } from '@domternal/pm/state';
import {
  findListItemAncestorDepth,
  isInsideListItem,
} from './listItemAncestor.js';

export interface SplitListForInsertRange {
  from: number;
  to: number;
}

/**
 * Activation conditions (single-cursor only):
 *   - selection is empty
 *   - cursor's nearest list-item ancestor exists
 *   - cursor's containing block is at index 0 (label slot) of that item
 *   - `tr` has no prior steps
 *
 * @returns A range where the caller should call `tr.replaceWith(from, to,
 *   [block, optionalTrailingParagraph])`, or `null` if the cursor isn't
 *   in a list-item label.
 */
export function splitListForInsert(
  state: EditorState,
  tr: Transaction,
): SplitListForInsertRange | null {
  if (!tr.selection.empty) return null;
  if (tr.steps.length !== 0) return null;

  const { $from } = tr.selection;
  const listItemDepth = findListItemAncestorDepth($from);
  if (listItemDepth === -1) return null;
  if ($from.index(listItemDepth) !== 0) return null;

  const listDepth = listItemDepth - 1;
  const listItemNode = $from.node(listItemDepth);
  const labelParagraph = listItemNode.firstChild;
  const labelIsEmpty =
    listItemNode.childCount === 1 && (labelParagraph?.content.size ?? 0) === 0;

  // ─── Empty-label case ────────────────────────────────────────────────
  // Use PM's `liftListItem` to split the parent list around the empty
  // item (becomes a top-level empty paragraph). The caller then replaces
  // that paragraph with its content. Replacement (not deletion + insert)
  // avoids PM's auto-fill behavior when the resulting doc would be empty.
  //
  // For nested empty items (e.g. ul > li > ul > li(empty) > p) PM's
  // `liftListItem` only lifts ONE wrapper level. Loop until the cursor
  // reaches doc top level, otherwise the caller's `tr.replaceWith` would
  // target a position inside a still-enclosing listItem where a top-level
  // node (hr, table, image) is schema-invalid.
  if (labelIsEmpty) {
    const listItemType = listItemNode.type;
    let safetyLimit = 10;
    while (safetyLimit-- > 0) {
      const stepState = state.apply(tr);
      const liftOk = liftListItem(listItemType)(stepState, (liftTr) => {
        for (const step of liftTr.steps) tr.step(step);
        if (liftTr.selectionSet) tr.setSelection(liftTr.selection);
      });
      if (!liftOk) break;
      if (!isInsideListItem(tr.selection.$from)) break;
    }

    const $afterLift = tr.selection.$from;
    if (isInsideListItem($afterLift)) return null;
    return { from: $afterLift.before(), to: $afterLift.after() };
  }

  // ─── Non-empty, LAST item in list: insert just after the list ────────
  const listNode = $from.node(listDepth);
  const indexInList = $from.index(listDepth);
  const isLast = indexInList === listNode.childCount - 1;
  if (isLast) {
    const pos = $from.after(listDepth);
    return { from: pos, to: pos };
  }

  // ─── Non-empty, MID/FIRST item: split the parent list ────────────────
  // Split point sits inside the parent list, between the current item
  // and the next sibling. depth=1 splits ONLY the list (not the item).
  // After split, the new top-level boundary at the parent level (doc)
  // is `splitPos + 1`.
  const splitPos = $from.after(listItemDepth);
  tr.split(splitPos, 1);
  const pos = splitPos + 1;
  return { from: pos, to: pos };
}
