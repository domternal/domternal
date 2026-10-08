/**
 * Get the range of a mark at a resolved position.
 *
 * Walks backward and forward from the position to find contiguous
 * text nodes that share the same mark type, returning the full range.
 */
import type { Mark, MarkType, Node as PMNode, ResolvedPos } from '@domternal/pm/model';

export interface MarkRange {
  from: number;
  to: number;
}

/**
 * @internal The range of the siblings around the node at `pos` that carry
 * exactly `mark`, attributes included, so an adjacent link of the same type
 * is never part of it.
 */
export function getExactMarkRange(doc: PMNode, pos: number, mark: Mark): MarkRange {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  let first = $pos.index();
  let last = first;
  while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--;
  while (last + 1 < parent.childCount && mark.isInSet(parent.child(last + 1).marks)) last++;
  let from = $pos.start();
  for (let index = 0; index < first; index++) from += parent.child(index).nodeSize;
  let to = from;
  for (let index = first; index <= last; index++) to += parent.child(index).nodeSize;
  return { from, to };
}

/**
 * Returns the contiguous range of a mark around the given resolved position.
 * Returns undefined if the mark is not present at the position.
 */
export function getMarkRange(
  $pos: ResolvedPos,
  type: MarkType,
): MarkRange | undefined {
  const parent = $pos.parent;

  // Try the node at/after cursor first, then the node before
  let start = parent.childAfter($pos.parentOffset);

  if (!start.node || !type.isInSet(start.node.marks)) {
    start = parent.childBefore($pos.parentOffset);
  }

  if (!start.node || !type.isInSet(start.node.marks)) {
    return undefined;
  }

  let startIndex = start.index;
  let startPos = $pos.start() + start.offset;
  let endIndex = startIndex + 1;
  let endPos = startPos + start.node.nodeSize;

  // Walk backward
  while (startIndex > 0 && type.isInSet(parent.child(startIndex - 1).marks)) {
    startIndex -= 1;
    startPos -= parent.child(startIndex).nodeSize;
  }

  // Walk forward
  while (endIndex < parent.childCount && type.isInSet(parent.child(endIndex).marks)) {
    endPos += parent.child(endIndex).nodeSize;
    endIndex += 1;
  }

  return { from: startPos, to: endPos };
}
