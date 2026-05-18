/**
 * Shared helpers for locating a list/task item ancestor of a resolved
 * position. Centralises the `LIST_ITEM_TYPE_NAMES` constant + ancestor
 * walk so the four+ consumers (liftCurrentListItem, splitListForInsert,
 * TaskItem keymap, Details proactive lift, slash menu filtering) stay
 * in sync.
 */
import type { ResolvedPos } from '@domternal/pm/model';

export const LIST_ITEM_TYPE_NAMES = new Set(['listItem', 'taskItem']);

/**
 * Returns the depth at which the nearest list/task item ancestor sits,
 * or -1 if none.
 *
 * Walks UP from `$pos.depth` toward 1 (we skip depth 0 = doc itself).
 */
export function findListItemAncestorDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d >= 1; d--) {
    if (LIST_ITEM_TYPE_NAMES.has($pos.node(d).type.name)) return d;
  }
  return -1;
}

/** Convenience: true when the cursor has a list/task item ancestor. */
export function isInsideListItem($pos: ResolvedPos): boolean {
  return findListItemAncestorDepth($pos) !== -1;
}

/**
 * True when the cursor sits in the LABEL paragraph (index 0) of its
 * nearest list/task item ancestor. Used to gate Notion-style "operate
 * on the label" commands (slash menu CONVERT, INSERT, etc.).
 */
export function isInListItemLabel($pos: ResolvedPos): boolean {
  const d = findListItemAncestorDepth($pos);
  if (d === -1) return false;
  return $pos.index(d) === 0;
}
