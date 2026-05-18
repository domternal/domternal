import type { EditorState, Transaction } from '@domternal/pm/state';
import { TextSelection } from '@domternal/pm/state';
import type { ListItemCursorContext } from './listItemCursorContext.js';

/**
 * Insert an empty paragraph as next sibling inside the same list/task item,
 * keeping the cursor in the children-zone so Enter accumulates blocks at the
 * same nesting level (Notion semantics). Exit paths are Backspace on empty,
 * Shift+Tab, or Enter on the empty label paragraph.
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
  // Stale-ctx guard: caller may have computed `ctx` against an older selection.
  if ($from.parent.type.name !== 'paragraph') return false;
  if ($from.parent.content.size !== 0) return false;

  if (!dispatch) return true;

  const insertPos = $from.after($from.depth);
  const tr = state.tr.insert(insertPos, paragraphType.create());
  tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
  dispatch(tr.scrollIntoView());
  return true;
}
