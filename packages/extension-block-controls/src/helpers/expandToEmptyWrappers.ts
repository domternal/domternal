import type { Node } from '@domternal/pm/model';

/**
 * Walks up from `[from, to]` widening the range while removing the source from
 * each ancestor would leave it effectively empty. Stops at the first ancestor
 * with meaningful sibling content (or the doc root). Shared by `moveBlock` and
 * `deleteBlock`. Without it:
 *
 * - Move: dragging the only `<li>` out of a nested `<ul>` leaves PM fitting an
 *   empty `<li>` placeholder to satisfy `bulletList -> listItem+`.
 * - Delete: deleting the only listItem either leaves that placeholder or (worse,
 *   per fitter) unwraps and silently deletes the whole list.
 *
 * Two collapse cases:
 *
 * 1. Single-child wrapper (`block+`): parent holds only the source; walking up
 *    removes the empty wrapper outright.
 * 2. Single-meaningful-child wrapper (Notion-strict `paragraph block*` list
 *    items): parent holds the source plus an auto-injected empty filler
 *    paragraph (PM prepends one to keep the item schema-valid). Treating that
 *    filler as discardable keeps the chain collapsing as under `block+`.
 */
export function expandToEmptyWrappers(
  doc: Node,
  from: number,
  to: number,
): { from: number; to: number } {
  let curFrom = from;
  let curTo = to;
  let $pos = doc.resolve(curFrom);
  while ($pos.depth > 0 && isCollapsibleParent($pos.node($pos.depth), $pos.index($pos.depth))) {
    curFrom = $pos.before($pos.depth);
    curTo = $pos.after($pos.depth);
    $pos = doc.resolve(curFrom);
  }
  return { from: curFrom, to: curTo };
}

/**
 * Parent collapses if removing the source leaves no meaningful content.
 * `sourceIndex` locates the source among the parent's children so we can find
 * the OTHER child when checking for a filler paragraph.
 */
function isCollapsibleParent(parent: Node, sourceIndex: number): boolean {
  if (parent.childCount === 1) return true;
  if (parent.childCount !== 2) return false;
  const otherIndex = sourceIndex === 0 ? 1 : 0;
  const other = parent.child(otherIndex);
  return other.type.name === 'paragraph' && other.content.size === 0;
}
