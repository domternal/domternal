/**
 * Keyboard indent across list boundaries. `Tab` on a top-level block whose
 * previous sibling is a list moves the block INTO the last item as a nested
 * child; `Shift-Tab` reverses for a block sitting as the last child of the
 * last item.
 *
 * Trigger is intentionally narrow so ListKeymap retains in-list Tab/Shift-Tab
 * (`sinkListItem` / `liftListItem`). Schema is validated via `canReplaceWith`;
 * invalid placements are a clean no-op so the keymap chain falls through.
 *
 * Intentional design restrictions (NOT bugs to "fix"):
 *  - Tab indents into the IMMEDIATE last item only, not recursively into a
 *    deeper "deepest last item". Users get deeper nesting via repeated Tab
 *    inside the now-nested context (then ListKeymap takes over).
 *  - Tab only fires for cursors in TOP-LEVEL blocks (depth === 1). Cursors
 *    inside other containers (blockquote, table cell) fall through.
 *  - Shift-Tab only fires when the block is BOTH the last child of its
 *    item AND the item is the last in its wrapper. Mid-position outdent
 *    would require splitting the list item, which is deferred.
 *
 * Registration order: must come AFTER ListKeymap so this extension's keymap
 * runs FIRST and can defer to ListKeymap for in-list flows.
 */
import { Extension } from '../Extension.js';
import { NodeSelection, Selection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { insertAsListItemChild } from '../utils/insertAsListItemChild.js';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Returns true when ANY ancestor of the cursor's resolved position is
 * a list item. Used to defer Tab/Shift-Tab to ListKeymap whenever the
 * cursor is somewhere inside a list (nested heading, label paragraph,
 * deeply nested block, etc.).
 */
function isCursorInsideListItem(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if (LIST_ITEM_TYPES.has($from.node(d).type.name)) return true;
  }
  return false;
}

/**
 * `Tab` handler: indent a top-level block as the last child of the
 * last item of the immediately-preceding list wrapper. Returns true
 * when the operation succeeded (and dispatched, if `dispatch` is
 * provided), false when any precondition fails so the keymap chain
 * can fall through to the next handler.
 */
export function indentBlockAsListChild(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state;

  // Identify the top-level "subject" block to indent. Two paths:
  //  - TextSelection with empty caret in a top-level textblock: the
  //    block is the cursor's depth-1 ancestor.
  //  - NodeSelection on a top-level atom block (hr, image, etc.):
  //    user explicitly selected the block; treat it as the subject.
  // Anything else (range selection, deeper nesting, in-list-item)
  // bails so the keymap chain falls through.
  let blockIndex: number;
  let blockNode: PMNode;
  let blockStart: number;
  let blockEnd: number;

  if (selection instanceof NodeSelection) {
    const node = selection.node;
    const $pos = selection.$from;
    // Atom block selected at top-level: the selected node is a direct
    // child of the doc; the parent depth is 0.
    if ($pos.depth !== 0) return false;
    if (isCursorInsideListItem(state)) return false;
    blockIndex = $pos.index(0);
    blockNode = node;
    blockStart = selection.from;
    blockEnd = selection.to;
  } else {
    if (!selection.empty) return false;
    if (isCursorInsideListItem(state)) return false;
    const { $from } = selection;
    if ($from.depth !== 1) return false;
    blockIndex = $from.index(0);
    blockNode = $from.node(1);
    blockStart = $from.before(1);
    blockEnd = $from.after(1);
  }

  if (blockIndex === 0) return false;

  const prevSibling = state.doc.child(blockIndex - 1);
  if (!LIST_WRAPPER_TYPES.has(prevSibling.type.name)) return false;

  // Position of the previous sibling (= the list wrapper) at the doc
  // level. Pre-computed here so a dry-run (no dispatch) and the
  // dispatch path share the same value.
  let wrapperPos = 0;
  for (let i = 0; i < blockIndex - 1; i++) {
    wrapperPos += state.doc.child(i).nodeSize;
  }

  const tr = state.tr;
  const result = insertAsListItemChild({
    tr,
    wrapperPos,
    blockNode,
    sourceRange: { from: blockStart, to: blockEnd },
  });
  if (!result.ok || result.insertedAt === undefined) return false;
  if (!dispatch) return true;

  // Caret in the (now nested) block at offset 0 of its content.
  tr.setSelection(Selection.near(tr.doc.resolve(result.insertedAt + 1)));
  dispatch(tr.scrollIntoView());
  return true;
}

/**
 * `Shift-Tab` handler: lift a non-label nested block out of its list
 * item to become a top-level sibling AFTER the list wrapper. Only
 * fires for the strict end-of-end case (last child of last item) so
 * the lift is deterministic and never needs to split a list item.
 *
 * Precondition table:
 *   - cursor empty
 *   - cursor textblock parent is NOT a paragraph (so we never
 *     accidentally outdent the label; ListKeymap.Shift-Tab handles
 *     in-label cases via liftListItem)
 *   - the cursor's enclosing list item exists in the ancestry
 *   - the cursor's containing block is a DIRECT child of the list
 *     item (depth = listItemDepth + 1) - keeps the math local to
 *     immediate li children rather than reaching deeper into nested
 *     containers
 *   - the block is the LAST child of the list item
 *   - the list item is the LAST child of its wrapper
 *   - the wrapper's parent accepts the block as a sibling (schema)
 */
export function outdentBlockFromListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;

  // Find the immediate list item ancestor.
  let listItemDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if (LIST_ITEM_TYPES.has($from.node(d).type.name)) {
      listItemDepth = d;
      break;
    }
  }
  if (listItemDepth === -1) return false;

  // The block to outdent is the DIRECT child of the list item that
  // contains the cursor - identified by walking from the cursor's
  // depth down to listItemDepth + 1. The cursor itself can be deeper
  // (e.g. cursor in a paragraph INSIDE a blockquote that sits as a
  // direct li child); we still treat the blockquote as the subject.
  const blockDepth = listItemDepth + 1;
  if ($from.depth < blockDepth) return false;

  const listItem = $from.node(listItemDepth);
  const blockIndexInItem = $from.index(listItemDepth);
  // Skip first-child (the label paragraph slot). Defers the in-label
  // case to ListKeymap.Shift-Tab (`liftListItem`).
  if (blockIndexInItem === 0) return false;
  // MVP: only outdent when the block is the LAST child of the item.
  if (blockIndexInItem !== listItem.childCount - 1) return false;

  // List item must be the LAST in its wrapper. (Wrapper is the parent
  // of the list item, which sits at depth = listItemDepth - 1.)
  const wrapperDepth = listItemDepth - 1;
  if (wrapperDepth < 0) return false;
  // Use $from.index(wrapperDepth) - the list item's index inside the
  // wrapper. (A previous attempt used `wrapperDepth - 1` here, which
  // returns the wrapper's index in ITS parent - the wrong number.)
  const liIndexInWrapper = $from.index(wrapperDepth);
  const wrapper = $from.node(wrapperDepth);
  if (liIndexInWrapper !== wrapper.childCount - 1) return false;

  // Schema check: can the wrapper's parent accept the block as a
  // sibling right AFTER the wrapper?
  // `wrapperDepth - 1` may equal -1 only when the wrapper sits at
  // depth 0 - i.e. the wrapper IS the doc itself. The schema disallows
  // this, but we guard defensively below.
  if (wrapperDepth - 1 < 0) return false;
  const wrapperParent = $from.node(wrapperDepth - 1);
  const wrapperIndexInParent = $from.index(wrapperDepth - 1);
  const blockNode = $from.node(blockDepth);
  if (
    !wrapperParent.canReplaceWith(
      wrapperIndexInParent + 1,
      wrapperIndexInParent + 1,
      blockNode.type,
    )
  ) {
    return false;
  }

  if (!dispatch) return true;

  const blockStart = $from.before(blockDepth);
  const blockEnd = $from.after(blockDepth);
  const wrapperEnd = $from.after(wrapperDepth);

  const tr = state.tr;
  // Delete the block from inside the list item; positions AFTER the
  // delete shift left by `blockEnd - blockStart`. The wrapper end
  // sits AFTER the deleted range so we adjust it.
  const blockSize = blockEnd - blockStart;
  tr.delete(blockStart, blockEnd);
  const insertAt = wrapperEnd - blockSize;
  tr.insert(insertAt, blockNode);
  // Caret at offset 0 of the lifted block's content.
  tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 1)));
  dispatch(tr.scrollIntoView());
  return true;
}

export const ListIndent = Extension.create({
  name: 'listIndent',

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      Tab: () => {
        if (!editor) return false;
        return indentBlockAsListChild(editor.state, editor.view.dispatch);
      },
      'Shift-Tab': () => {
        if (!editor) return false;
        return outdentBlockFromListItem(editor.state, editor.view.dispatch);
      },
    };
  },
});
