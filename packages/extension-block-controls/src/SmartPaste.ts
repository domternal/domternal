/**
 * Pasting block-level content at an INLINE position normally goes through PM's
 * content fitter, which strips the block wrapper and pastes only inline text.
 * SmartPaste catches the relevant cases and routes each to the right strategy:
 *
 *  1. List slice into a list ancestor: matching-kind and marker items merge as
 *     siblings unless explicit paste intent preserves ordered starts and blocks.
 *     Other lists keep their wrapper and split the host list around it.
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
 * children of the slice are what matter. The strategies insert those children
 * as whole nodes, so the slice's open sides are completed first (see
 * `wholeSliceContent`), and a slice that cannot be completed is left to PM.
 */

import { Extension } from '@domternal/core';
import { getClipboardPasteBehavior } from '@domternal/core/clipboard';
import { Plugin, TextSelection, Selection } from '@domternal/pm/state';
import { canSplit } from '@domternal/pm/transform';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode, ResolvedPos, NodeType } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import type { Transaction } from '@domternal/pm/state';
import { insertBlockSplittingList } from './helpers/moveBlock.js';
import { canMergeListWrappers } from './helpers/listMarkers.js';

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
          handlePaste: (view, event, slice) => handleSmartPaste(view, event, slice),
        },
      }),
    ];
  },
});

/** Returns `true` when this plugin handled the paste (PM skips its default). */
function handleSmartPaste(view: EditorView, event: ClipboardEvent, pasted: Slice): boolean {
  const { state } = view;
  const { selection } = state;
  const $from = selection.$from;

  // Cursor must be inline (inside a textblock); else PM's default is correct.
  if (!$from.parent.isTextblock) return false;

  // No non-paragraph block at top level: PM merges plain inline content cleanly.
  if (!sliceHasNonParagraphBlock(pasted)) return false;

  // Single block of the SAME TYPE as the destination (e.g. <h1> into <h1>):
  // splitting the parent to "preserve" the wrapper would shred the heading
  // into three pieces. PM's default inline merge is what the user wants.
  if (sliceIsSingleSameTypeAsParent(pasted, $from.parent.type.name)) return false;

  // Every strategy below inserts whole nodes. A slice whose open sides cannot
  // be completed is left to PM's paste, which fits an open slice itself.
  const whole = wholeSliceContent(pasted);
  if (whole === undefined) return false;
  const slice = new Slice(whole, 0, 0);

  // Strategy 1: list-slice into list ancestor, merge as siblings.
  if (tryPasteListSliceIntoList(view, event, slice)) return true;

  // Text copied from inside a list item, quote, table cell or details summary is text, though the
  // paste rebuilds the container the copy recorded around it: outside a list, where the rule above
  // keeps a copied item's list and marker, it joins the caret's textblock through PM's paste, as it
  // does without SmartPaste, instead of landing beside it in a list, quote, table or details.
  if (isCopiedText(event, pasted)) return false;

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

  // A textblock its blocks cannot leave, such as a details summary, can sit in a parent that takes
  // no block beside it, where the insertions below would split that parent in two. Such a paste
  // goes to the textblock's owner, as Details puts it in its content, or to ProseMirror's paste.
  if (parent.type.spec.isolating === true && $pos.depth > 0) {
    const container = $pos.node($pos.depth - 1);
    const index = $pos.index($pos.depth - 1);
    const at = offset === 0 && parentSize > 0 ? index : index + 1;
    if (!container.canReplace(parentSize === 0 ? index : at, at, slice.content)) return false;
  }

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
    // A block its parent cannot hold twice, such as a details summary, is left
    // to ProseMirror's paste.
    const cursorPos = $pos.pos;
    if (!canSplit(tr.doc, cursorPos)) return false;
    tr.split(cursorPos);
    const insertAt = cursorPos + 1;
    tr.insert(insertAt, slice.content);
    setCaretAtEndOfInserted(tr, insertAt, slice.content);
  }

  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
  return true;
}

/**
 * The slice's content as whole nodes, or undefined when it cannot be made valid.
 *
 * ProseMirror's clipboard parse leaves a slice open where the pasted HTML starts
 * or ends inside a node, and a node on an open side can lack what its schema
 * requires there. A web page copy that starts inside a nested list item gives a
 * list whose first item starts with the nested list and has no label paragraph;
 * a list in a list leaves an empty list; a copy that ends at the start of an
 * item leaves an empty item. Inserted as they are, such nodes break the
 * document, and an extension that then changes one of them, as UniqueID does,
 * throws and loses the paste. Each node on an open side therefore gets the
 * content its schema requires before its first child and after its last, as
 * ProseMirror completes a slice it closes: an empty label paragraph keeps a
 * nested list at its depth under an empty item. Valid nodes come back as they
 * were, so a slice that needs nothing is unchanged.
 */
function wholeSliceContent(slice: Slice): Fragment | undefined {
  const content = completeSides(slice.content, slice.openStart, slice.openEnd);
  if (content === null) return undefined;
  try {
    content.forEach((node) => { node.check(); });
  } catch {
    return undefined;
  }
  return content;
}

/** `fragment` with its first child completed `openStart` levels down and its last child `openEnd` levels down. */
function completeSides(fragment: Fragment, openStart: number, openEnd: number): Fragment | null {
  const last = fragment.childCount - 1;
  let result = fragment;
  for (const index of last > 0 ? [0, last] : last === 0 ? [0] : []) {
    const child = completeNode(result.child(index), index === 0 ? openStart : 0, index === last ? openEnd : 0);
    if (child === null) return null;
    if (child !== result.child(index)) result = result.replaceChild(index, child);
  }
  return result;
}

/** `node`, open `openStart` levels at its start and `openEnd` at its end counting itself, with both sides completed. */
function completeNode(node: PMNode, openStart: number, openEnd: number): PMNode | null {
  if (node.isLeaf || (openStart <= 0 && openEnd <= 0)) return node;
  const inner = completeSides(node.content, openStart - 1, openEnd - 1);
  if (inner === null) return null;
  const before = node.type.contentMatch.fillBefore(inner);
  const filled = before?.append(inner);
  const after = filled && node.type.contentMatch.matchFragment(filled)?.fillBefore(Fragment.empty, true);
  if (!filled || !after) return null;
  const content = filled.append(after);
  return content.eq(node.content) ? node : node.copy(content);
}

// The context a ProseMirror copy records in its clipboard HTML: the nodes around the copied content.
const SLICE_CONTEXT = /\bdata-pm-slice="\d+ \d+(?: -\d+)? (\[[^"]*\])"/;

/**
 * Whether the paste is text copied from inside a textblock that sits in other nodes: the clipboard
 * HTML records those nodes as the slice's context, and the slice is one node open on both sides
 * at each level down to the textblock, which is open on both sides too.
 */
function isCopiedText(event: ClipboardEvent, slice: Slice): boolean {
  let html: string;
  try { html = event.clipboardData?.getData('text/html') ?? ''; } catch { return false; }
  const context = SLICE_CONTEXT.exec(html)?.[1];
  if (context === undefined || context === '[]') return false;
  let { content, openStart, openEnd } = slice;
  for (let node = content.firstChild; content.childCount === 1 && node !== null && openStart > 0 && openEnd > 0; node = content.firstChild) {
    if (node.isTextblock) return true;
    content = node.content;
    openStart--;
    openEnd--;
  }
  return false;
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
 * When the caret has a list ancestor and the slice is a single list, or explicit
 * paste behavior preserves a block fragment containing top-level ordered lists:
 *   - SAME list kind and marker: merge items as siblings, unless explicit paste
 *     behavior preserves the pasted ordered list's start in its own wrapper.
 *   - DIFFERENT kind or marker: the pasted list
 *     keeps its OWN kind, checked state, and ordered `start`, splitting the host
 *     list around it. This mirrors the cross-kind drag rules (`moveBlock`) and
 *     prevents the silent checked-state loss a blind adapt-and-merge caused.
 * Returns false (caller falls through) when this case doesn't apply.
 */
function tryPasteListSliceIntoList(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  const { state } = view;
  const { selection } = state;

  let preserveOrderedStart = false;
  if (getClipboardPasteBehavior(view, event)?.preserveOrderedListStart === true) {
    let hasOrderedList = false;
    let blocksOnly = true;
    for (let index = 0; index < slice.content.childCount; index++) {
      const node = slice.content.child(index);
      if (node.type.name === 'orderedList') hasOrderedList = true;
      if (!node.isBlock) blocksOnly = false;
    }
    preserveOrderedStart = hasOrderedList && blocksOnly;
  }

  // Explicit preservation also keeps restart wrappers and source interruptions
  // together at list level. Ordinary multi-block paste retains its usual route.
  const sliceTop = slice.content.firstChild;
  if (!sliceTop) return false;
  if (!preserveOrderedStart && (slice.content.childCount !== 1 || !LIST_TYPES.has(sliceTop.type.name))) return false;

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

  const tr = state.tr;
  if (!selection.empty) tr.deleteSelection();

  // Re-resolve after potential range delete. Bail if the list ancestor was
  // lost (selection straddled out), letting the fallback paths run.
  const $pos = tr.selection.$from;
  if ($pos.depth < listItemDepth) return false;
  if (!LIST_TYPES.has($pos.node(listDepth).type.name)) return false;
  const sameWrapper = canMergeListWrappers(sliceTop, $pos.node(listDepth));

  const parent = $pos.parent;
  const parentEnd = $pos.after($pos.depth);
  const offset = $pos.parentOffset;
  const parentSize = parent.content.size;
  const liStart = $pos.before(listItemDepth);
  const liEnd = $pos.after(listItemDepth);
  const itemHasOnlyOneChild = $pos.node(listItemDepth).childCount === 1;

  // Caret in the middle: the item splits around the pasted list only when the
  // caret's textblock is a child of the item and its tail can start an item.
  // A heading or code block cannot, and a block nested deeper, such as a
  // blockquote, keeps its own content: the list then lands at the caret.
  const typesAfter = typesAfterUncheckedTail($pos, listItemDepth);
  if (offset > 0 && offset < parentSize && ($pos.depth !== listItemDepth + 1 || !canSplit(tr.doc, $pos.pos, 2, typesAfter))) {
    return false;
  }

  if (sameWrapper && !preserveOrderedStart) {
    // Matching wrapper kind and marker: insert the items as siblings without
    // changing their list marker policy.
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
      tr.split(cursorPos, 2, typesAfter);
      insertAt = cursorPos + 2;
      tr.insert(insertAt, adapted);
    }

    setCaretAtEndOfInserted(tr, insertAt, adapted);
    view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
    return true;
  }

  // Preserve a different kind/marker or an explicitly requested ordered start
  // in its own wrapper, splitting the host list around the inserted content.
  const content = preserveOrderedStart ? slice.content : Fragment.from(sliceTop);
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
      tr.replaceWith(wrapperStart, wrapperEnd, content);
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
    tr.split(cursorPos, 2, typesAfter);
    insertedAt = insertBlockSplittingList(tr, tr.doc.resolve(cursorPos + 2), content);
  }

  setCaretAtEndOfInserted(tr, insertedAt, content);
  view.dispatch(tr.scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
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
