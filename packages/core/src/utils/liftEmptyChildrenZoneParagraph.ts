import type { EditorState, Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import { liftTarget } from '@domternal/pm/transform';
import type { ListItemCursorContext } from './listItemCursorContext.js';

/**
 * "Notion-style exit-indent": when the cursor is in an EMPTY paragraph
 * inside the children-zone of a list/task item (NOT the first label
 * paragraph), pressing Backspace should lift JUST that paragraph as a
 * top-level sibling of the list, leaving every other child of the
 * list item (label, headings, codeBlocks, etc.) untouched.
 *
 * Without this helper, ListItem.Backspace / TaskItem.Backspace fall
 * through to PM defaults which would either merge the empty p with
 * the previous block (silently mangling the children-zone) or, for
 * the empty-LABEL case, lift the entire list item.
 *
 * Two paths:
 *
 *  1. **Standard lift path** (preferred when valid): when the empty
 *     paragraph sits at a position where PM can cleanly lift it via
 *     `tr.lift` + `liftTarget`, use that. Covers the common case of
 *     trailing empty paragraphs (and middle empty p when the IMMEDIATE
 *     next sibling is a paragraph that satisfies the listItem's
 *     "paragraph block*" content rule for the after-cut half).
 *     PM handles wrapper splitting, blockquote-wrapped lists, etc.
 *     automatically.
 *
 *  2. **Manual delete + insert path** (fallback): when `liftTarget`
 *     returns null - which happens when the empty paragraph is in
 *     the MIDDLE of children-zone AND its IMMEDIATE next sibling is
 *     a non-paragraph (heading / codeBlock / blockquote / hr), so
 *     cutting the list item there would leave the non-paragraph as
 *     the first child of the after-cut half, violating the strict
 *     `paragraph block*` schema. The helper simply removes the empty
 *     paragraph from its position - the remaining children stay
 *     valid because the label paragraph (the unaffected first child)
 *     still satisfies the schema. The new empty paragraph is then
 *     inserted at the top-level position appropriate for the wrapper
 *     context (after the wrapper for a single-item wrapper, or
 *     split-and-insert in the gap for a multi-item wrapper).
 *
 * The single transaction means Mod-Z restores the pre-lift shape in
 * one undo step.
 *
 * Used by:
 *  - `ListItem.Backspace` (Plan 4 Phase 6)
 *  - `TaskItem.Backspace` (Plan 4 Phase 6 mirror; the existing
 *    childIndex===0 branch for "lift entire empty taskItem" runs
 *    AFTER this children-zone branch so both stay live).
 *
 * Companion utility: `insertChildrenZoneSibling` performs the OPPOSITE
 * operation (insert empty paragraph as next sibling INSIDE the same
 * list item, accumulating). That utility is wired to the Enter
 * handler (Plan 4 Phase 5).
 */
export function liftEmptyChildrenZoneParagraph(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  ctx: ListItemCursorContext,
): boolean {
  if (!ctx.isInChildrenZone || !ctx.paragraphIsEmpty) return false;

  const { $from } = state.selection;
  // Guard: the resolved cursor must agree with the context. Protects
  // against stale `ctx` (caller computed it on an older selection or
  // doc snapshot).
  if ($from.parent.type.name !== 'paragraph') return false;
  if ($from.parent.content.size !== 0) return false;

  const paragraphType = state.schema.nodes['paragraph'];
  if (!paragraphType) return false;

  // Path 1: try the standard lift via PM's liftTarget. Works for any
  // empty paragraph whose surrounding list item / wrapper can be split
  // around the range without violating the schema.
  const range = $from.blockRange();
  if (range) {
    const target = liftTarget(range);
    if (target !== null) {
      if (!dispatch) return true;
      const tr = state.tr.lift(range, target);
      const oldParaStart = $from.before($from.depth);
      const newParaStart = tr.mapping.map(oldParaStart);
      tr.setSelection(TextSelection.create(tr.doc, newParaStart + 1));
      dispatch(tr.scrollIntoView());
      return true;
    }
  }

  // Path 2: manual fallback. Reached when liftTarget returns null -
  // typically a MIDDLE empty paragraph in a list item with non-paragraph
  // siblings (e.g. [label, empty-p, h1]) where cutting the list item
  // would yield an invalid second half ([h1] alone, missing required
  // first paragraph).
  //
  // Approach: delete the empty paragraph in place (post-deletion
  // children form [label, ...rest] which still satisfies "paragraph
  // block*"), then insert a fresh empty paragraph at the top-level
  // position appropriate for the wrapper context.

  const paraStart = $from.before($from.depth);
  const paraEnd = $from.after($from.depth);

  const itemNode = state.doc.nodeAt(ctx.itemPos);
  if (!itemNode) return false;
  const itemEnd = ctx.itemPos + itemNode.nodeSize;

  const wrapperNode = state.doc.nodeAt(ctx.wrapperPos);
  if (!wrapperNode) return false;
  const wrapperEnd = ctx.wrapperPos + wrapperNode.nodeSize;

  const isLastItem = ctx.itemIndexInWrapper === wrapperNode.childCount - 1;

  // Pre-flight schema check: wrapper's parent must accept a paragraph
  // at the lift target index. Without this, the manual operations
  // could leave the doc in an invalid state.
  const wrapperParentDepth = ctx.itemDepth - 2;
  if (wrapperParentDepth < 0) return false;
  const wrapperParent = $from.node(wrapperParentDepth);
  const wrapperIndexInParent = $from.index(wrapperParentDepth);
  if (
    !wrapperParent.canReplaceWith(
      wrapperIndexInParent + 1,
      wrapperIndexInParent + 1,
      paragraphType,
    )
  ) {
    return false;
  }

  if (!dispatch) return true;

  const newPara = paragraphType.create();
  const tr = state.tr;

  if (isLastItem) {
    // Single-item or last-item wrapper: delete in-place, insert after
    // the wrapper at parent depth (top-level slot).
    tr.delete(paraStart, paraEnd);
    const insertPos = tr.mapping.map(wrapperEnd);
    tr.insert(insertPos, newPara);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  } else {
    // Mid-list-wrapper: delete in-place, split the wrapper at the
    // boundary AFTER the current item, insert paragraph in the gap.
    // After tr.split(splitAt, 1) the top-level slot between the two
    // halves is at position `splitAt + 1` (= one position after the
    // close-token of the first half).
    tr.delete(paraStart, paraEnd);
    const splitAt = tr.mapping.map(itemEnd);
    tr.split(splitAt, 1);
    const insertPos = splitAt + 1;
    tr.insert(insertPos, newPara);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  }

  dispatch(tr.scrollIntoView());
  return true;
}
