import type { Attrs, NodeType } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';

/**
 * Block-level transaction helpers shared between BlockContextMenu commands
 * (Delete, Duplicate, Turn into) and other feature implementations that
 * need to operate on a top-level block.
 *
 * All helpers mutate and return the given transaction (chainable) rather
 * than creating a new one.
 */

/**
 * Removes the block at `blockPos` entirely.
 */
export function deleteBlock(tr: Transaction, blockPos: number): Transaction {
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  tr.delete(blockPos, blockPos + node.nodeSize);
  return tr;
}

/**
 * Duplicates the block at `blockPos` by inserting a copy immediately after
 * it. The copy has the same content, attrs, and marks.
 */
export function duplicateBlock(tr: Transaction, blockPos: number): Transaction {
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  const blockEnd = blockPos + node.nodeSize;
  tr.insert(blockEnd, node.copy(node.content));
  return tr;
}

/**
 * Transforms the block at `blockPos` into a different textblock type while
 * preserving its inline content. Uses `tr.setBlockType` which only applies
 * when the target type is a textblock and the range contains textblocks.
 *
 * Returns the transaction unchanged if the target type is not a textblock
 * or if the node at `blockPos` can't be transformed.
 */
export function turnIntoBlock(
  tr: Transaction,
  blockPos: number,
  targetType: NodeType,
  attrs?: Attrs,
): Transaction {
  const node = tr.doc.nodeAt(blockPos);
  if (!node) return tr;
  // `setBlockType` requires the target to be a textblock; if it isn't, bail.
  if (!targetType.isTextblock) return tr;
  const blockEnd = blockPos + node.nodeSize;
  tr.setBlockType(blockPos, blockEnd, targetType, attrs);
  return tr;
}
