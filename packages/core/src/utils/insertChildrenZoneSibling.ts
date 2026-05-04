import type { EditorState, Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import type { ListItemCursorContext } from './listItemCursorContext.js';

/**
 * "Notion-style accumulate": when the cursor is in an EMPTY paragraph
 * inside the children-zone of a list/task item (NOT the first label
 * paragraph), pressing Enter should INSERT another empty paragraph as
 * the next sibling INSIDE the same list item - keeping the cursor in
 * the children-zone so the user can continue building elaborate nested
 * content (notes, tables, code blocks, etc.) via subsequent Enter +
 * slash-command flows.
 *
 * Notion documents this behaviour as the universal rule: Enter on any
 * line creates a sibling block at the same nesting level. The OPPOSITE
 * of "exit on Enter". Users exit the children-zone via:
 *  - Backspace at the start of an empty children-zone block (handled
 *    separately by the Backspace shortcut in ListItem/TaskItem)
 *  - Shift+Tab (when applicable, via ListIndent extension)
 *  - Enter on an empty list-item LABEL (childIndex === 0, falls
 *    through to the default `liftListItem` flow)
 *
 * Used by:
 *  - `ListItem.Enter` (Plan 4 Phase 5)
 *  - `TaskItem.Enter` (Plan 4 Phase 5 mirror)
 *
 * Companion util: `liftEmptyChildrenZoneParagraph` performs the OPPOSITE
 * operation (lift the empty paragraph OUT of the list item as a
 * top-level sibling). That util is now wired to the Backspace handler
 * (Plan 4 Phase 6).
 */
export function insertChildrenZoneSibling(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  ctx: ListItemCursorContext,
): boolean {
  if (!ctx.isInChildrenZone || !ctx.paragraphIsEmpty) return false;

  const paragraphType = state.schema.nodes['paragraph'];
  if (!paragraphType) return false;

  const { $from } = state.selection;
  // Guard: the resolved cursor must agree with the context. Protects
  // against stale `ctx` (caller computed it on an older selection or
  // doc snapshot).
  if ($from.parent.type.name !== 'paragraph') return false;
  if ($from.parent.content.size !== 0) return false;

  if (!dispatch) return true;

  // Insert position is right AFTER the current empty paragraph (= the
  // close-token offset of the parent paragraph). The new paragraph
  // becomes the next sibling inside the list item.
  const insertPos = $from.after($from.depth);
  const tr = state.tr.insert(insertPos, paragraphType.create());
  // Cursor at offset 0 inside the new paragraph. `insertPos` points
  // BEFORE the inserted node; +1 skips the open token.
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  dispatch(tr.scrollIntoView());
  return true;
}
