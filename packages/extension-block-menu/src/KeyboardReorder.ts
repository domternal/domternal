/**
 * `Mod-Shift-ArrowUp` / `Mod-Shift-ArrowDown` move the top-level block
 * containing the selection. Accessibility companion to BlockHandle drag.
 * Shares `moveBlock` so position math and self-move rejection match.
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
  if (!editor.isEditable) return false;
  const { state, view } = editor;
  const { $from } = state.selection;

  const topLevel = findTopLevelBlock(state.doc, $from.pos);
  if (!topLevel) return false;

  if (direction === 'up' && topLevel.index === 0) return false;
  if (direction === 'down' && topLevel.index >= state.doc.childCount - 1) return false;

  // Relative offset of the selection WITHIN the source block (survives
  // nested containers like list-item/details-content because we work with
  // absolute positions inside the block, not depth-based math).
  const selectionOffsetInBlock = Math.max(
    0,
    Math.min($from.pos - topLevel.pos, topLevel.node.nodeSize - 1),
  );

  let targetPos: number;
  if (direction === 'up') {
    targetPos = state.doc.resolve(topLevel.pos).posAtIndex(topLevel.index - 1, 0);
  } else {
    const nextSibling = state.doc.child(topLevel.index + 1);
    const nextStart = state.doc.resolve(topLevel.pos).posAtIndex(topLevel.index + 1, 0);
    targetPos = nextStart + nextSibling.nodeSize;
  }

  const tr = state.tr;
  moveBlock(tr, topLevel.pos, targetPos);

  // Restore selection inside the moved block. `moveBlock` deletes then
  // inserts; the block's new start position is `adjustedTarget`, which
  // equals `targetPos` when moving up and `targetPos - source.nodeSize`
  // when moving down.
  const newBlockPos = direction === 'up'
    ? targetPos
    : targetPos - topLevel.node.nodeSize;
  const selectionPos = Math.min(
    newBlockPos + selectionOffsetInBlock,
    Math.max(0, tr.doc.content.size - 1),
  );
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));

  view.dispatch(tr.scrollIntoView());
  return true;
}
