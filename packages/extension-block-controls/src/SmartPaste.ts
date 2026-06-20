/**
 * Pasting block-level content at an INLINE position normally goes through PM's
 * content fitter, which strips the block wrapper and pastes only inline text.
 * SmartPaste catches the relevant cases and routes each to the right strategy:
 *
 *  1. List slice into a list ancestor: same-kind items merge as siblings; a
 *     different-kind list keeps its kind and splits the host list around it.
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
import { Fragment } from '@domternal/pm/model';
import type { Slice, Node as PMNode, ResolvedPos, NodeType } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import type { Transaction } from '@domternal/pm/state';
import { insertBlockSplittingList } from './helpers/moveBlock.js';

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

  // Caret sits in the LABEL paragraph (child 0) of a list/task item. The label
  // is the schema-required first child of `paragraph block*`, so inserting before
  // it (offset 0) would wedge the block INSIDE the item.
  const isListItemLabel = $pos.depth >= 2
    && LIST_ITEM_TYPES.has($pos.node($pos.depth - 1).type.name)
    && $pos.index($pos.depth - 1) === 0;

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
    // listItem/taskItem, replacing it would be schema-invalid or make PM's
    // content fitter inject a fresh empty paragraph. Insert AFTER the label
    // instead, so the content attaches as a nested child below the (still
    // empty) label.
    if (isListItemLabel) {
      tr.insert(parentEnd, slice.content);
      setCaretAtEndOfInserted(tr, parentEnd, slice.content);
    } else {
      tr.replaceWith(parentStart, parentEnd, slice.content);
      setCaretAtEndOfInserted(tr, parentStart, slice.content);
    }
  } else if (offset === 0) {
    if (isListItemLabel) {
      // Caret at the START of a list-item label: a non-list block keeps its type
      // and SPLITS the host list around the item (it lands at list level), rather
      // than being wedged inside the item, where PM's fitter would fabricate an
      // empty label and demote the item's own text into the children zone.
      // Matches the cross-kind drag rules (`moveBlock`).
      const $gap = tr.doc.resolve($pos.before($pos.depth - 1));
      const insertedAt = insertBlockSplittingList(tr, $gap, slice.content);
      setCaretAtEndOfInserted(tr, insertedAt, slice.content);
    } else {
      tr.insert(parentStart, slice.content);
      setCaretAtEndOfInserted(tr, parentStart, slice.content);
    }
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
 * When the slice top-level is a single list AND the caret has a list ancestor:
 *   - SAME list kind: adapt the items (a no-op for the same item type) and merge
 *     them as siblings of the current item, preserving the surrounding list.
 *   - DIFFERENT kind (e.g. to-dos pasted into a bullet list): the pasted list
 *     keeps its OWN kind, checked state, and ordered `start`, splitting the host
 *     list around it. This mirrors the cross-kind drag rules (`moveBlock`) and
 *     prevents the silent checked-state loss a blind adapt-and-merge caused.
 * Returns false (caller falls through) when this case doesn't apply.
 */
function tryPasteListSliceIntoList(view: EditorView, slice: Slice): boolean {
  const { state } = view;
  const { selection } = state;

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
  const sameKind = sliceTop.type === listParent.type;

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

  if (sameKind) {
    // Same wrapper kind: the items already match the host's item type, so insert
    // them as-is and merge them as siblings of the current item.
    const adapted = sliceTop.content;
    if (adapted.childCount === 0) return false;

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
      // A checked to-do split mid-label spawns an UNCHECKED tail (Notion; matches
      // the Enter handler), so a split half is never silently pre-checked.
      const cursorPos = $pos.pos;
      tr.split(cursorPos, 2, typesAfterUncheckedTail($pos, listItemDepth));
      insertAt = cursorPos + 2;
      tr.insert(insertAt, adapted);
    }

    setCaretAtEndOfInserted(tr, insertAt, adapted);
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  // Different list kind: keep the pasted list as its own wrapper and split the
  // host list around it, so kind / checked / `start` all survive.
  const content = Fragment.from(sliceTop);
  let insertedAt: number;
  if (hasTrailingHardBreakAtCursor(parent, offset, parentSize)) {
    const hbStart = parentEnd - 2;
    const hbEnd = parentEnd - 1;
    tr.delete(hbStart, hbEnd);
    insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(liEnd - 1), content);
  } else if (parentSize === 0 && itemHasOnlyOneChild) {
    // Empty item: drop it so the pasted list takes its place.
    const wrapperNode = $pos.node(listDepth);
    if (wrapperNode.childCount === 1) {
      // Host list is just this empty item: replace the whole wrapper.
      const wrapperStart = $pos.before(listDepth);
      const wrapperEnd = $pos.after(listDepth);
      tr.replaceWith(wrapperStart, wrapperEnd, sliceTop);
      insertedAt = wrapperStart;
    } else {
      tr.delete(liStart, liEnd);
      insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(liStart), content);
    }
  } else if (offset === 0) {
    insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(liStart), content);
  } else if (offset === parentSize) {
    insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(liEnd), content);
  } else {
    const cursorPos = $pos.pos;
    tr.split(cursorPos, 2, typesAfterUncheckedTail($pos, listItemDepth));
    insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(cursorPos + 2), content);
  }

  setCaretAtEndOfInserted(tr, insertedAt, content);
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * `typesAfter` for `tr.split(pos, 2)` inside a list item: rebuild the textblock
 * and item types for the tail half, forcing a `taskItem` tail to `checked: false`
 * so splitting a checked to-do never pre-checks the new item (Notion semantics).
 * Returns `undefined` (PM's default attr-copying split) for non-task items.
 */
function typesAfterUncheckedTail(
  $pos: ResolvedPos,
  listItemDepth: number,
): { type: NodeType; attrs?: Record<string, unknown> }[] | undefined {
  const item = $pos.node(listItemDepth);
  if (item.type.name !== 'taskItem') return undefined;
  return [
    { type: item.type, attrs: { ...item.attrs, checked: false } },
    { type: $pos.parent.type },
  ];
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
