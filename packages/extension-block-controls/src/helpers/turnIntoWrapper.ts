import { TextSelection } from '@domternal/pm/state';
import type { Editor } from '@domternal/core';

/** Wrapper-style "Turn into" commands, each from the matching node extension.
 *  Lists use the per-item `turnInto*` commands (Notion turn-into: convert only
 *  the targeted block and split the run); the whole-list `toggle*List` commands
 *  stay reserved for the toolbar button and Mod-Shift shortcut. */
export type WrapperCommand =
  | 'turnIntoBulletList'
  | 'turnIntoOrderedList'
  | 'turnIntoTaskList'
  | 'toggleBlockquote';

/**
 * Wrap-style "Turn into" for non-textblock targets (lists, blockquote).
 * Textblock targets go through `turnIntoBlock`/`setBlockType`; wrappers can't,
 * since the inner block stays put and only its parent changes. So this helper:
 *
 *   1. (Optionally) downgrades the source to paragraph. ListItem/TaskItem
 *      declare `content: 'paragraph block*'`, so a list item's FIRST child must
 *      be a paragraph; a bare heading/codeBlock would be schema-rejected on wrap.
 *      Blockquote (`block+`) accepts any block, so step-down only applies to lists.
 *   2. Moves the selection into the (now-paragraph) block.
 *   3. Dispatches the wrapper command. `toggleList`/`toggleBlockquote` act on
 *      `state.selection`, so the selection must be set before the command runs.
 *
 * The step-down and wrapper command produce two undo steps; merging them would
 * mean re-implementing toggleList inline, an acceptable tradeoff for the rare
 * heading/codeBlock -> list path.
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
  // blockPos points at the block's OPENING token; +1 lands inside its inline
  // content (or the empty cursor position for an empty textblock).
  tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
  editor.view.dispatch(tr);

  // Dispatch via the commands map. It's typed `Record<string, (...) => boolean>`,
  // so switch on the discriminant to keep type-safety without a wide cast.
  switch (command) {
    case 'turnIntoBulletList':
      return editor.commands.turnIntoBulletList();
    case 'turnIntoOrderedList':
      return editor.commands.turnIntoOrderedList();
    case 'turnIntoTaskList':
      return editor.commands.turnIntoTaskList();
    case 'toggleBlockquote':
      return editor.commands.toggleBlockquote();
  }
}
