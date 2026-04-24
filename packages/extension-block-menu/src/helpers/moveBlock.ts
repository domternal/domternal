import type { Transaction } from '@domternal/pm/state';

/**
 * Moves a top-level block from `sourcePos` to `targetPos` in-place on the
 * given transaction. Single source of truth for block reorder position math:
 * used by BlockHandle drag-drop and KeyboardReorder shortcuts.
 *
 * Position math:
 * - Slice the source node first (before delete).
 * - Delete the source range.
 * - Adjust target: if target was after the source, subtract the removed size
 *   because positions after the deletion shift left.
 * - Insert the slice at the adjusted target.
 *
 * Self-drop safety:
 * - If `targetPos` falls inside `[sourcePos, sourceEnd]`, return the
 *   transaction unchanged (moving a block into itself is invalid).
 * - If there's no node at `sourcePos`, return unchanged.
 *
 * Returns the same transaction (chainable), not a new one.
 */
export function moveBlock(
  tr: Transaction,
  sourcePos: number,
  targetPos: number,
): Transaction {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return tr;
  const sourceNode = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return tr;
  const sourceEnd = sourcePos + sourceNode.nodeSize;
  if (targetPos >= sourcePos && targetPos <= sourceEnd) return tr;

  const slice = tr.doc.slice(sourcePos, sourceEnd);
  tr.delete(sourcePos, sourceEnd);
  const adjustedTarget = targetPos > sourcePos
    ? targetPos - (sourceEnd - sourcePos)
    : targetPos;
  tr.insert(adjustedTarget, slice.content);
  return tr;
}
