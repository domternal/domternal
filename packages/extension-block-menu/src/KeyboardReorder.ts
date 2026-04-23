/**
 * KeyboardReorder Extension
 *
 * Keyboard shortcuts to move the top-level block containing the selection
 * up or down — accessibility companion to BlockHandle's drag UX:
 *
 * - `Mod-Shift-ArrowUp`   → move current block above the previous sibling
 * - `Mod-Shift-ArrowDown` → move current block below the next sibling
 *
 * Uses the same `moveBlock` helper as BlockHandle drop, so position math
 * and self-move rejection behave identically.
 *
 * Edge cases:
 * - Selection inside a nested block (list item, details content) walks up
 *   to the top-level block and moves the whole container.
 * - At the first block, `ArrowUp` is a no-op.
 * - At the last block, `ArrowDown` is a no-op.
 * - Selection inside the moved block is preserved at the same inline offset.
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { findTopLevelBlock } from './helpers/findTopLevelBlock.js';
import { moveBlock } from './helpers/moveBlock.js';

export const KeyboardReorder = Extension.create({
  name: 'keyboardReorder',

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-ArrowUp': () => moveCurrentBlock(editor as Editor | null, 'up'),
      'Mod-Shift-ArrowDown': () => moveCurrentBlock(editor as Editor | null, 'down'),
    };
  },
});

/**
 * Moves the top-level block containing the current selection up or down.
 * Returns `true` when a move happened, `false` otherwise (lets the browser
 * handle the shortcut if we don't consume it).
 */
function moveCurrentBlock(editor: Editor | null, direction: 'up' | 'down'): boolean {
  if (!editor || editor.isDestroyed) return false;
  const { state, view } = editor;
  const { $from } = state.selection;

  const topLevel = findTopLevelBlock(state.doc, $from.pos);
  if (!topLevel) return false;

  const docChildCount = state.doc.childCount;
  if (direction === 'up' && topLevel.index === 0) return false;
  if (direction === 'down' && topLevel.index >= docChildCount - 1) return false;

  // Inline offset inside the block (so cursor lands at the same position
  // after the move).
  const inlineOffset = Math.max(0, $from.pos - topLevel.pos - 1);

  let targetPos: number;
  if (direction === 'up') {
    const prevSiblingStart = state.doc.resolve(topLevel.pos).posAtIndex(topLevel.index - 1);
    targetPos = prevSiblingStart;
  } else {
    const nextSibling = state.doc.child(topLevel.index + 1);
    const nextStart = state.doc.resolve(topLevel.pos).posAtIndex(topLevel.index + 1);
    targetPos = nextStart + nextSibling.nodeSize;
  }

  const tr = state.tr;
  moveBlock(tr, topLevel.pos, targetPos);

  // Restore selection inside the moved block.
  const newBlockPos = direction === 'up'
    ? targetPos
    : targetPos - topLevel.node.nodeSize;
  const selectionPos = Math.min(
    newBlockPos + 1 + inlineOffset,
    tr.doc.content.size,
  );
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));

  view.dispatch(tr.scrollIntoView());
  return true;
}
