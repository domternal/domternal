import type { Node } from '@domternal/pm/model';

/**
 * Walks up from `[from, to]` widening the range as long as the immediate
 * parent ancestor is a single-child container (i.e. removing the source
 * would leave the parent empty). Stops at the first ancestor with
 * siblings (or at the doc root).
 *
 * Shared by `moveBlock` and `deleteBlock`. Without it:
 *
 * - Move: dragging the only `<li>` out of a nested `<ul>` would force
 *   PM's content fitter to retain an empty `<li>` placeholder to satisfy
 *   `bulletList → listItem+`.
 * - Delete: deleting the only listItem inside a UL would either leave
 *   that empty placeholder OR (worse, depending on schema fitter
 *   behaviour) silently delete the whole list because PM tries to
 *   replace the LI with the next-best fit and may unwrap the wrapper.
 *
 * Expanding the range outward catches all single-child wrapper chains
 * so the deletion removes everything that would otherwise become an
 * orphan / placeholder.
 */
export function expandToEmptyWrappers(
  doc: Node,
  from: number,
  to: number,
): { from: number; to: number } {
  let curFrom = from;
  let curTo = to;
  let $pos = doc.resolve(curFrom);
  while ($pos.depth > 0 && $pos.node($pos.depth).childCount === 1) {
    curFrom = $pos.before($pos.depth);
    curTo = $pos.after($pos.depth);
    $pos = doc.resolve(curFrom);
  }
  return { from: curFrom, to: curTo };
}
