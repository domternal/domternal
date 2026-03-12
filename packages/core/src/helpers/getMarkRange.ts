/**
 * Get the range of a mark at a resolved position.
 *
 * Walks backward and forward from the position to find contiguous
 * text nodes that share the same mark type, returning the full range.
 */
import type { MarkType, ResolvedPos } from '@domternal/pm/model';

export interface MarkRange {
  from: number;
  to: number;
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
