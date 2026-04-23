import type { Node } from '@domternal/pm/model';

/**
 * Information about a top-level block in the document.
 */
export interface TopLevelBlock {
  /** The block node. */
  node: Node;
  /** Absolute position of the block (its start). */
  pos: number;
  /** Absolute position one past the block end (= pos + node.nodeSize). */
  end: number;
  /** Zero-based index among doc children. */
  index: number;
}

/**
 * Resolves the top-level block (direct child of the document) that contains
 * a given absolute position. Walks up from the resolved position to depth 1,
 * which is always a direct doc child in the standard schema.
 *
 * Returns `null` when `pos` resolves to the document itself (depth 0) or is
 * out of bounds.
 *
 * Used by:
 * - BlockHandle — resolve the block under the cursor for hover / drag / click
 * - SlashCommand — validate that the `/` trigger is at the start of a top-level block
 * - KeyboardReorder — find the block currently containing the selection to move
 * - ContextMenu — resolve the block whose options are being displayed
 */
export function findTopLevelBlock(doc: Node, pos: number): TopLevelBlock | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth === 0) return null;
  const node = $pos.node(1);
  const blockPos = $pos.before(1);
  const index = $pos.index(0);
  return {
    node,
    pos: blockPos,
    end: blockPos + node.nodeSize,
    index,
  };
}
