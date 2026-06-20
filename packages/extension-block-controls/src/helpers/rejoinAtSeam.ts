import { canJoin } from '@domternal/pm/transform';
import type { Transaction } from '@domternal/pm/state';

const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Joins two list wrappers that ended up directly adjacent at `seam` (a position
 * in the CURRENT `tr.doc`, already mapped through any prior steps by the caller).
 * Restricted to two wrappers of the SAME type: a bullet and an ordered list share
 * `listItem` content and would otherwise `canJoin`, silently converting one kind
 * into the other. Adjacent paragraphs are joinable too, but merging them on a
 * reorder/delete would be wrong, hence the wrapper gate.
 *
 * `tr.join` keeps the FIRST wrapper's attrs, so a stale ordered-list `start` on
 * the second half is discarded and numbering stays continuous. Shared by
 * `moveBlock`, `moveBlockAsNestedChild`, and `deleteBlock` so every gesture that
 * can leave two same-type lists touching heals them the same way.
 */
export function rejoinAtSeam(tr: Transaction, seam: number): void {
  if (seam <= 0 || seam >= tr.doc.content.size) return;
  const $seam = tr.doc.resolve(seam);
  const before = $seam.nodeBefore;
  const after = $seam.nodeAfter;
  if (!before || !after) return;
  if (before.type !== after.type) return;
  if (!LIST_WRAPPER_TYPES.has(before.type.name)) return;
  if (canJoin(tr.doc, seam)) tr.join(seam);
}
