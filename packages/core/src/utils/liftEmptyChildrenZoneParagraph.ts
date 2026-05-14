import type { EditorState, Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import { liftTarget } from '@domternal/pm/transform';
import type { ListItemCursorContext } from './listItemCursorContext.js';

/**
 * Lift an empty children-zone paragraph out of its list/task item as a
 * top-level sibling. PM's `liftTarget` covers the common case; we fall
 * back to manual delete-and-insert when it returns null (empty p sandwiched
 * before a non-paragraph would leave the after-cut half violating the
 * `paragraph block*` schema).
 */
export function liftEmptyChildrenZoneParagraph(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  ctx: ListItemCursorContext,
): boolean {
  if (!ctx.isInChildrenZone || !ctx.paragraphIsEmpty) return false;

  const { $from } = state.selection;
  // Stale-ctx guard: caller may have computed `ctx` against an older selection.
  if ($from.parent.type.name !== 'paragraph') return false;
  if ($from.parent.content.size !== 0) return false;

  const paragraphType = state.schema.nodes['paragraph'];
  if (!paragraphType) return false;

  // Path 1: standard lift via PM's liftTarget.
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

  // Path 2: liftTarget returned null. Delete the empty paragraph in place
  // (label + rest still satisfies `paragraph block*`), then insert a fresh
  // empty paragraph at the top-level slot next to the wrapper.
  const paraStart = $from.before($from.depth);
  const paraEnd = $from.after($from.depth);

  const itemNode = state.doc.nodeAt(ctx.itemPos);
  if (!itemNode) return false;
  const itemEnd = ctx.itemPos + itemNode.nodeSize;

  const wrapperNode = state.doc.nodeAt(ctx.wrapperPos);
  if (!wrapperNode) return false;
  const wrapperEnd = ctx.wrapperPos + wrapperNode.nodeSize;

  const isLastItem = ctx.itemIndexInWrapper === wrapperNode.childCount - 1;

  // Pre-flight: wrapper's parent must accept a paragraph at the lift slot,
  // otherwise the manual edits would leave an invalid doc.
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
    // Last-item case: insert after the wrapper.
    tr.delete(paraStart, paraEnd);
    const insertPos = tr.mapping.map(wrapperEnd);
    tr.insert(insertPos, newPara);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  } else {
    // Mid-wrapper: split after the current item; new paragraph lands in the gap.
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
