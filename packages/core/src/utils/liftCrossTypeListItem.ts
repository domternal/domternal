/**
 * Outdent a list/task item that is nested inside a DIFFERENT-type parent list
 * item (e.g. a checked `taskItem` inside a bullet `listItem`, or a bullet
 * `listItem` inside a `taskItem`) WITHOUT dissolving it.
 *
 * ProseMirror's `liftListItem` can only keep an item's wrapper when the
 * surrounding list accepts that item type. Across a type boundary the
 * surrounding list rejects the item, so `liftListItem` falls back to
 * `liftOutOfList`, which unwraps the item into a bare paragraph - silently
 * dropping the marker and (for tasks) the `checked` state. This transform
 * instead lifts the whole item, re-wrapped in a fresh list of its OWN type,
 * out to the parent list's level (splitting that list when the containing
 * item is not its last child), preserving the item's type and attributes.
 *
 * It is a no-op (returns false) for the same-type and top-level cases so the
 * caller can fall back to the standard `liftListItem`.
 */
import { Selection } from '@domternal/pm/state';
import type { EditorState, Transaction } from '@domternal/pm/state';

const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);

export function liftCrossTypeListItem(
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
): boolean {
  const { $from } = state.selection;
  if (!state.selection.empty) return false;

  // Nearest enclosing list/task item.
  let itemDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if (LIST_ITEM_TYPES.has($from.node(d).type.name)) {
      itemDepth = d;
      break;
    }
  }
  // A cross-type NESTED case needs at least doc > outerList > outerItem >
  // innerList > item (depth 4). Shallower means a top-level item, which is
  // `liftListItem`'s job (un-listing to a paragraph is expected there).
  if (itemDepth < 4) return false;

  const item = $from.node(itemDepth);
  const wrapper = $from.node(itemDepth - 1); // the item's own list
  const parentItem = $from.node(itemDepth - 2);
  if (!LIST_ITEM_TYPES.has(parentItem.type.name)) return false; // not nested in an item
  // Same item type: the surrounding list accepts it, so liftListItem preserves
  // it cleanly. Only a type boundary triggers the dissolving fallback.
  if (parentItem.type === item.type) return false;

  const parentWrapper = $from.node(itemDepth - 3); // outer list (rejects item's type)
  const grandParent = $from.node(itemDepth - 4); // doc, or an enclosing list item
  const gpIndex = $from.index(itemDepth - 4); // parentWrapper's index in grandParent
  // The destination must accept a list of the item's own type as a sibling.
  if (!grandParent.canReplaceWith(gpIndex + 1, gpIndex + 1, wrapper.type)) return false;

  if (!dispatch) return true;

  const onlyChild = wrapper.childCount === 1;
  const removeFrom = onlyChild ? $from.before(itemDepth - 1) : $from.before(itemDepth);
  const removeTo = onlyChild ? $from.after(itemDepth - 1) : $from.after(itemDepth);
  const parentIsLast = $from.index(itemDepth - 3) === parentWrapper.childCount - 1;

  const tr = state.tr;
  // Remove the item (or its now-empty wrapper) from the parent item.
  tr.delete(removeFrom, removeTo);
  // Re-wrap the item in a fresh list of its own type at the outer list's level.
  const newList = wrapper.type.create(wrapper.attrs, item);
  if (parentIsLast) {
    // Lands right after the outer list.
    const insertAt = tr.mapping.map($from.after(itemDepth - 3));
    tr.insert(insertAt, newList);
    tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 2)));
  } else {
    // Split the outer list after the parent item so the rest stays intact,
    // and drop the new list between the two halves.
    const splitAt = tr.mapping.map($from.after(itemDepth - 2));
    tr.split(splitAt, 1);
    tr.insert(splitAt + 1, newList);
    tr.setSelection(Selection.near(tr.doc.resolve(splitAt + 2)));
  }
  dispatch(tr.scrollIntoView());
  return true;
}
