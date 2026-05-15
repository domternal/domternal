import { TextSelection } from '@domternal/pm/state';
import type { Editor } from '@domternal/core';

/**
 * Editor commands the menu can route to for wrapper-style "Turn into".
 * Each maps to a command from the corresponding node extension.
 */
export type WrapperCommand =
  | 'toggleBulletList'
  | 'toggleOrderedList'
  | 'toggleTaskList'
  | 'toggleBlockquote';

/**
 * Wrap-style "Turn into" for non-textblock targets (lists, blockquote).
 *
 * The textblock targets (paragraph, heading, codeBlock) are handled by
 * `turnIntoBlock` via `setBlockType`. Wrappers can't go through that
 * path - the inner block stays put, only its parent changes. So this
 * helper:
 *
 *   1. (Optionally) downgrades the source block to paragraph. ListItem
 *      and TaskItem both declare `content: 'paragraph block*'`, meaning
 *      the FIRST child of a list item must be a paragraph. A bare
 *      heading or codeBlock would be rejected by the schema during the
 *      wrap step. Blockquote has `content: 'block+'` and accepts any
 *      block, so step-down only applies to list targets.
 *   2. Moves the selection into the (now-paragraph) block.
 *   3. Dispatches the wrapper command. `toggleList` / `toggleBlockquote`
 *      operate on `state.selection`, so the selection-set must land
 *      before the command runs.
 *
 * Note: the step-down dispatch and the wrapper command produce two
 * undo steps. Composing them into a single transaction would require
 * re-implementing the toggleList Command's body inline; the two-step
 * undo is an acceptable tradeoff for the (rare) heading/codeBlock →
 * list path.
 */
export function turnIntoWrapper(
  editor: Editor,
  blockPos: number,
  command: WrapperCommand,
): boolean {
  const { state } = editor.view;
  if (blockPos < 0 || blockPos >= state.doc.content.size) return false;
  const node = state.doc.nodeAt(blockPos);
  if (!node?.type.isTextblock) return false;

  const isListTarget = command !== 'toggleBlockquote';
  const needsStepDown = isListTarget && node.type.name !== 'paragraph';

  const tr = state.tr;
  if (needsStepDown) {
    const paragraphType = state.schema.nodes['paragraph'];
    if (!paragraphType) return false;
    tr.setBlockType(blockPos, blockPos + node.nodeSize, paragraphType);
  }
  // blockPos points at the OPENING token of the block; +1 lands inside
  // its inline content (or at the empty cursor position for an empty
  // textblock).
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
  editor.view.dispatch(tr);

  // Dispatch the wrapper command via the editor's commands map. The
  // map is typed `Record<string, (...) => boolean>` so switch on the
  // discriminant to keep type-safety without a wide cast.
  switch (command) {
    case 'toggleBulletList':
      return editor.commands.toggleBulletList();
    case 'toggleOrderedList':
      return editor.commands.toggleOrderedList();
    case 'toggleTaskList':
      return editor.commands.toggleTaskList();
    case 'toggleBlockquote':
      return editor.commands.toggleBlockquote();
  }
}
