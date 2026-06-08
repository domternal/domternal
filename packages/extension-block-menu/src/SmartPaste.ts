/**
 * Pasting block-level content at an INLINE position normally goes through PM's
 * content fitter, which strips the block wrapper and pastes only inline text.
 * SmartPaste catches the relevant cases and routes each to the right strategy:
 *
 *  1. List slice into a list ancestor: items adapted (`convertListItemForParent`)
 *     and merged as siblings, preserving the surrounding list.
 *  2. Trailing hardBreak (Shift+Enter): trim the hardBreak, insert as sibling.
 *  3. Truly empty parent paragraph (`parentSize === 0`): replace the parent.
 *  4-6. Caret at start / end / middle: insert as sibling or split-and-insert.
 *  7. Range selection: delete first, then run through 2-6.
 *
 * Skipped (PM default applies) when: cursor isn't in a textblock; the slice's
 * top-level blocks are ALL plain paragraphs; or the slice is a SINGLE top-level
 * block of the SAME TYPE as the destination (heading-into-heading, etc.) where
 * PM's inline merge is what the user wants.
 *
 * Do NOT bail on `openStart > 0`: PM's clipboard parser routinely sets
 * `openStart=1` even for closed-looking input like `<h1>x</h1>`. Top-level
 * children of the slice are what matter.
 */

import { Extension } from '@domternal/core';
import { Plugin, TextSelection, Selection } from '@domternal/pm/state';
import type { Slice, Node as PMNode, Fragment } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import type { Transaction } from '@domternal/pm/state';
import { convertListItemForParent } from './helpers/convertListItemForParent.js';

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

export interface SmartPasteOptions {
  /**
   * Disable the plugin without removing the extension (falls back to PM's
   * default paste handling).
   * @default true
   */
  enabled?: boolean;
}

export const SmartPaste = Extension.create<SmartPasteOptions>({
  name: 'smartPaste',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    if (this.options.enabled === false) return [];
    return [
      new Plugin({
        props: {
          handlePaste: (view, _event, slice) => handleSmartPaste(view, slice),
        },
      }),
    ];
  },
});

/** Returns `true` when this plugin handled the paste (PM skips its default). */
function handleSmartPaste(view: EditorView, slice: Slice): boolean {
  const { state } = view;
  const { selection } = state;
  const $from = selection.$from;

  // Cursor must be inline (inside a textblock); else PM's default is correct.
  if (!$from.parent.isTextblock) return false;

  // No non-paragraph block at top level: PM merges plain inline content cleanly.
  if (!sliceHasNonParagraphBlock(slice)) return false;

  // Single block of the SAME TYPE as the destination (e.g. <h1> into <h1>):
  // splitting the parent to "preserve" the wrapper would shred the heading
  // into three pieces. PM's default inline merge is what the user wants.
  if (sliceIsSingleSameTypeAsParent(slice, $from.parent.type.name)) return false;

  // Strategy 1: list-slice into list ancestor, merge as siblings.
  if (tryPasteListSliceIntoList(view, slice)) return true;

  // Strategies 2-7: collapse range, then route by parent state + offset.
  const tr = state.tr;
  if (!selection.empty) tr.deleteSelection();

  const $pos = tr.selection.$from;
  const parent = $pos.parent;
  const parentStart = $pos.before($pos.depth);
  const parentEnd = $pos.after($pos.depth);
  const offset = $pos.parentOffset;
  const parentSize = parent.content.size;

  if (hasTrailingHardBreakAtCursor(parent, offset, parentSize)) {
    // Shift+Enter: trim the trailing hardBreak, insert the slice as a SIBLING
    // after the parent. Text before the break is preserved ("Existing<br>|"
    // keeps "Existing" as a paragraph, heading lands next). Empty case
    // "<p><br></p>" becomes "<p></p>" + slice.
    const hbStart = parentEnd - 2; // hardBreak occupies 1 position before parent close
    const hbEnd = parentEnd - 1;
    tr.delete(hbStart, hbEnd);
    const adjustedParentEnd = parentEnd - 1;
    tr.insert(adjustedParentEnd, slice.content);
    setCaretAtEndOfInserted(tr, adjustedParentEnd, slice.content);
  } else if (parentSize === 0) {
    // Truly-empty parent: replace it with the slice so we don't leave a stray
    // empty paragraph beside the inserted block.
    //
    // Carve-out: when the empty paragraph is the LABEL slot of a
    // listItem/taskItem (schema-required first child of `paragraph block*`),
    // replacing it would be schema-invalid or make PM's content fitter inject
    // a fresh empty paragraph. Insert AFTER the label instead, so the content
    // attaches as a nested child below the (still empty) label.
    const isListItemLabel = $pos.depth >= 2
      && LIST_ITEM_TYPES.has($pos.node($pos.depth - 1).type.name)
      && $pos.index($pos.depth - 1) === 0;
    if (isListItemLabel) {
      tr.insert(parentEnd, slice.content);
      setCaretAtEndOfInserted(tr, parentEnd, slice.content);
    } else {
      tr.replaceWith(parentStart, parentEnd, slice.content);
      setCaretAtEndOfInserted(tr, parentStart, slice.content);
    }
  } else if (offset === 0) {
    tr.insert(parentStart, slice.content);
    setCaretAtEndOfInserted(tr, parentStart, slice.content);
  } else if (offset === parentSize) {
    tr.insert(parentEnd, slice.content);
    setCaretAtEndOfInserted(tr, parentEnd, slice.content);
  } else {
    // Caret in the middle: split the textblock, insert at the boundary between
    // the two halves. After split the cursor's pos sits at the END of the first
    // half (before its close marker); the boundary is one past that, cursorPos+1.
    const cursorPos = $pos.pos;
    tr.split(cursorPos);
    const insertAt = cursorPos + 1;
    tr.insert(insertAt, slice.content);
    setCaretAtEndOfInserted(tr, insertAt, slice.content);
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}

/** True if any top-level slice child is a block other than `paragraph`. */
function sliceHasNonParagraphBlock(slice: Slice): boolean {
  let result = false;
  slice.content.forEach((child) => {
    if (child.isBlock && child.type.name !== 'paragraph') result = true;
  });
  return result;
}

/**
 * True when the slice is exactly one top-level block whose type matches the
 * destination parent (heading-into-heading, etc.). Here PM's default strips the
 * matching wrapper and inline-merges, which is better than splitting the parent.
 */
function sliceIsSingleSameTypeAsParent(slice: Slice, parentTypeName: string): boolean {
  if (slice.content.childCount !== 1) return false;
  return slice.content.firstChild?.type.name === parentTypeName;
}

/** Cursor at the very end of the parent AND parent's last child is a hardBreak (Shift+Enter trigger). */
function hasTrailingHardBreakAtCursor(parent: PMNode, offset: number, parentSize: number): boolean {
  if (offset !== parentSize) return false;
  return parent.lastChild?.type.name === 'hardBreak';
}

/**
 * When the slice top-level is a single list AND the caret has a list ancestor,
 * adapt the slice's items to the ancestor list's item type
 * (`convertListItemForParent`) and merge them as siblings of the current item.
 * Returns false (caller falls through) when this case doesn't apply.
 */
function tryPasteListSliceIntoList(view: EditorView, slice: Slice): boolean {
  const { state } = view;
  const { selection, schema } = state;

  // Slice must be exactly one top-level list node.
  if (slice.content.childCount !== 1) return false;
  const sliceTop = slice.content.firstChild;
  if (!sliceTop || !LIST_TYPES.has(sliceTop.type.name)) return false;

  // Find nearest list-wrapper ancestor of the caret.
  const $from = selection.$from;
  let listDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if (LIST_TYPES.has($from.node(d).type.name)) { listDepth = d; break; }
  }
  if (listDepth === -1) return false;

  // The corresponding listItem (one level inside the list).
  const listItemDepth = listDepth + 1;
  if ($from.depth < listItemDepth) return false;

  const listParent = $from.node(listDepth);
  const adapted = convertListItemForParent(schema, sliceTop.content, listParent.type);
  if (adapted.childCount === 0) return false;

  const tr = state.tr;
  if (!selection.empty) tr.deleteSelection();

  // Re-resolve after potential range delete. Bail if the list ancestor was
  // lost (selection straddled out), letting the fallback paths run.
  const $pos = tr.selection.$from;
  if ($pos.depth < listItemDepth) return false;
  if (!LIST_TYPES.has($pos.node(listDepth).type.name)) return false;

  const parent = $pos.parent;
  const parentEnd = $pos.after($pos.depth);
  const offset = $pos.parentOffset;
  const parentSize = parent.content.size;
  const liStart = $pos.before(listItemDepth);
  const liEnd = $pos.after(listItemDepth);
  const itemHasOnlyOneChild = $pos.node(listItemDepth).childCount === 1;

  let insertAt: number;
  if (hasTrailingHardBreakAtCursor(parent, offset, parentSize)) {
    // Shift+Enter inside a listItem: trim the trailing hardBreak, insert the
    // adapted items as siblings AFTER the current listItem (empty row stays).
    const hbStart = parentEnd - 2;
    const hbEnd = parentEnd - 1;
    tr.delete(hbStart, hbEnd);
    const adjustedLiEnd = liEnd - 1;
    tr.insert(adjustedLiEnd, adapted);
    insertAt = adjustedLiEnd;
  } else if (parentSize === 0 && itemHasOnlyOneChild) {
    // Truly-empty listItem: replace it so we don't leave a stray empty item.
    tr.replaceWith(liStart, liEnd, adapted);
    insertAt = liStart;
  } else if (offset === 0) {
    tr.insert(liStart, adapted);
    insertAt = liStart;
  } else if (offset === parentSize) {
    tr.insert(liEnd, adapted);
    insertAt = liEnd;
  } else {
    // Caret in middle: split the listItem, insert items between the halves.
    // `tr.split(pos, depth)` doubles close+open at each level; for depth=2
    // (textblock + listItem) the boundary is pos + 2 (after both close tokens).
    const cursorPos = $pos.pos;
    tr.split(cursorPos, 2);
    insertAt = cursorPos + 2;
    tr.insert(insertAt, adapted);
  }

  setCaretAtEndOfInserted(tr, insertAt, adapted);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Place the cursor at the END of the last inserted block. Text-bearing blocks
 * land at the end of the deepest textblock; atom blocks (hr, image) use
 * Selection.near for the closest valid selection.
 *
 * The fragment occupies `[insertAt, insertAt + content.size)`; subtracting 1
 * lands just before the outermost close-token, i.e. the end of its content.
 */
function setCaretAtEndOfInserted(tr: Transaction, insertAt: number, content: Fragment): void {
  if (content.childCount === 0) return;
  const target = Math.max(0, Math.min(tr.doc.content.size, insertAt + content.size - 1));
  const $target = tr.doc.resolve(target);
  if ($target.parent.isTextblock) {
    tr.setSelection(TextSelection.create(tr.doc, target));
  } else {
    tr.setSelection(Selection.near($target, -1));
  }
}
