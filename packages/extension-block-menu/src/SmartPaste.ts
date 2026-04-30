/**
 * SmartPaste extension
 *
 * Pasting block-level content (heading, codeBlock, blockquote, image,
 * horizontalRule, etc.) at an INLINE position (anywhere inside a
 * textblock) normally goes through PM's content fitter, which strips
 * the block wrapper and pastes only the inline text — losing the
 * original formatting.
 *
 * Common user trigger: copy a heading, click into a list item / body
 * paragraph, press Shift+Enter (creates a hardBreak — cursor stays
 * inline), paste. Without this plugin: heading text is pasted as plain
 * text. With this plugin: the textblock is split at the cursor and
 * the heading is inserted as a sibling block, preserving its tag
 * + attrs (level, id, colors).
 *
 * Behaviour:
 * - Selection at START of textblock → block content inserted BEFORE
 *   the parent textblock (no empty leading paragraph).
 * - Selection at END of textblock → block content inserted AFTER
 *   the parent textblock (no empty trailing paragraph).
 * - Selection in the MIDDLE → textblock split at cursor, block
 *   content inserted between the two halves.
 * - Selection range (non-empty) → range deleted first, then same
 *   logic on the resulting collapsed cursor.
 *
 * Skipped (PM default kicks in) when:
 * - Cursor isn't inside a textblock (already at a block boundary).
 * - Slice is "open" (`openStart > 0`) — text-merge paste, not block.
 * - Slice's blocks are ALL plain paragraphs — PM's default smoothly
 *   merges them with the current textblock, which is the right
 *   behaviour for ordinary text.
 */

import { Extension } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import type { Slice } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

const SMART_PASTE_PLUGIN_KEY = 'smartPaste';

export interface SmartPasteOptions {
  /**
   * Disable the plugin without removing the extension. Useful for tests
   * or to fall back to PM's default paste handling temporarily.
   * @default true
   */
  enabled?: boolean;
}

export const SmartPaste = Extension.create<SmartPasteOptions>({
  name: SMART_PASTE_PLUGIN_KEY,

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

/**
 * Returns `true` when this plugin handled the paste (PM should skip its
 * default), `false` otherwise.
 */
function handleSmartPaste(view: EditorView, slice: Slice): boolean {
  const { state } = view;
  const { selection } = state;
  const $from = selection.$from;

  // Cursor must be at an inline position (inside a textblock). Otherwise
  // PM's default block-paste already does the right thing.
  if (!$from.parent.isTextblock) return false;

  // We only step in when the slice carries a non-paragraph block at its
  // top level (heading, codeBlock, blockquote, hr, image, etc.). For
  // pure-text or pure-paragraph pastes, PM's default merges inline
  // content with the current textblock — exactly what users expect.
  //
  // Note: PM's clipboard parser routinely sets `openStart=1` even for
  // closed-looking input like `<h1>x</h1>`. We deliberately do NOT
  // bail on `openStart > 0` because it would silently re-introduce the
  // bug this plugin exists to fix. The slice's TOP-LEVEL children are
  // what matter — if any is a non-paragraph block, treat it as a
  // block paste regardless of the openness hint.
  const blocks: { name: string; isBlock: boolean }[] = [];
  slice.content.forEach((child) => {
    blocks.push({ name: child.type.name, isBlock: child.isBlock });
  });
  const hasNonParagraphBlock = blocks.some((b) => b.isBlock && b.name !== 'paragraph');
  if (!hasNonParagraphBlock) return false;

  const tr = state.tr;
  // Collapse any selection range first so the rest of the logic only
  // has to reason about a caret position.
  if (!selection.empty) tr.deleteSelection();

  const $pos = tr.selection.$from;
  const parentStart = $pos.before($pos.depth);
  const parentEnd = $pos.after($pos.depth);
  const offset = $pos.parentOffset;
  const parentSize = $pos.parent.content.size;

  if (offset === 0) {
    // Caret at the very start of the textblock — insert before the parent.
    tr.insert(parentStart, slice.content);
  } else if (offset === parentSize) {
    // Caret at the very end — insert after the parent.
    tr.insert(parentEnd, slice.content);
  } else {
    // Caret in the middle. Split the textblock at the cursor, then
    // insert the slice content at the BOUNDARY between the two new
    // halves. After split, the cursor's original pos sits at the END
    // of the first half (just before its close marker); the boundary
    // we want is one past that — `cursorPos + 1` (between the close
    // of the first half and the open of the second).
    const cursorPos = $pos.pos;
    tr.split(cursorPos);
    tr.insert(cursorPos + 1, slice.content);
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}
