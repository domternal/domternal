import type { Node } from '@domternal/pm/model';

/**
 * Walks up from `[from, to]` widening the range as long as removing the
 * source from each ancestor would leave that ancestor effectively empty.
 * Stops at the first ancestor with meaningful sibling content (or at the
 * doc root).
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
 * Two collapse cases are handled:
 *
 * 1. **Single-child wrapper** (`block+` schema, classic case): the
 *    parent contains only the source. Walking up removes the empty
 *    wrapper outright.
 * 2. **Single-meaningful-child wrapper** (Notion-strict `paragraph
 *    block*` schema for list items): the parent contains the source
 *    plus one auto-injected empty filler paragraph (PM's content
 *    fitter prepends an empty paragraph so the list item is schema
 *    valid). Treating that filler as discardable keeps the wrapper
 *    chain collapsing all the way up, preserving the same behaviour
 *    we have under `block+`.
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
 * `sourceIndex` is the position the source occupies among the parent's
 * children (so we can identify the OTHER children when checking for
 * filler paragraphs).
 */
function isCollapsibleParent(parent: Node, sourceIndex: number): boolean {
  if (parent.childCount === 1) return true;
  if (parent.childCount !== 2) return false;
  const otherIndex = sourceIndex === 0 ? 1 : 0;
  const other = parent.child(otherIndex);
  return other.type.name === 'paragraph' && other.content.size === 0;
}
