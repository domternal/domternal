import type { Node } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

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
 * - BlockHandle - resolve the block under the cursor for hover / drag / click
 * - SlashCommand - validate that the `/` trigger is at the start of a top-level block
 * - KeyboardReorder - find the block currently containing the selection to move
 * - ContextMenu - resolve the block whose options are being displayed
 */
export function findTopLevelBlock(doc: Node, pos: number): TopLevelBlock | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);

  // Position exactly at a top-level boundary (between blocks, or at doc
  // start). `doc.nodeAt(pos)` returns the node that starts at this position.
  if ($pos.depth === 0) {
    const node = doc.nodeAt(pos);
    if (!node) return null;
    return {
      node,
      pos,
      end: pos + node.nodeSize,
      index: $pos.index(0),
    };
  }

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

/**
 * Resolves the deepest ancestor whose node type name appears in
 * `draggableTypes`. Falls back to `findTopLevelBlock` (depth-1 walk) if no
 * ancestor in the list matches.
 *
 * Used by `BlockHandle` when the `nested` option is active: the plugin
 * hovers over list items / task items individually instead of always
 * anchoring on the whole list.
 *
 * Walking is deepest-first so nested lists resolve to the innermost
 * matching item (the one the cursor is actually inside).
 */
export function findDraggableBlock(
  doc: Node,
  pos: number,
  draggableTypes: string[],
): TopLevelBlock | null {
  if (pos < 0 || pos > doc.content.size) return null;
  if (draggableTypes.length === 0) return findTopLevelBlock(doc, pos);
  const $pos = doc.resolve(pos);

  // Walk ancestors from deepest to shallowest (skip depth 0 = doc itself).
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (draggableTypes.includes(node.type.name)) {
      const blockPos = $pos.before(depth);
      // The "index" for a nested draggable is its index within its direct
      // parent - consistent with what the block's drag logic expects when
      // reordering siblings.
      const index = $pos.index(depth - 1);
      return {
        node,
        pos: blockPos,
        end: blockPos + node.nodeSize,
        index,
      };
    }
  }

  // No allowed-node ancestor found - fall back to the top-level block so
  // hover/drag still works for plain paragraphs outside any container.
  return findTopLevelBlock(doc, pos);
}

/**
 * Spatial result returned by {@link findDeepestBlockAtY}.
 */
export interface DeepestBlockMatch {
  node: Node;
  pos: number;
  dom: HTMLElement;
  rect: DOMRect;
}

/**
 * Finds the **deepest (innermost)** block at a given client Y coordinate
 * by walking the doc tree and comparing each node's DOM rect against
 * `clientY`. Among all blocks whose vertical rect contains `clientY`
 * AND whose type appears in `allowedTypes`, the one with the **smallest
 * height** wins (innermost in a vertical block layout).
 *
 * X is intentionally ignored - the gutter where the BlockHandle visually
 * lives sits to the left of `.ProseMirror`, so any X-based resolution
 * (`posAtCoords`, point-in-rect tests) would resolve to whatever happens
 * to be at the editor's left edge, which is the OUTER block when nested
 * lists are indented further right. This is the "Notion behaviour" - the
 * handle anchors on the row the cursor is actually in, regardless of how
 * far left the cursor strayed.
 *
 * Tiptap's drag-handle deliberately does the opposite via "edge promotion"
 * (deduct `strength * depth` near the left edge → shallower wins). That
 * mode is exposed here as Mode C (`promoteOnEdge`) and uses
 * {@link ./findBestDragTarget findBestDragTarget} instead.
 *
 * Returns `null` when no allowed block contains `clientY` (e.g. cursor is
 * above the first block, below the last, or hovering a top-level node not
 * in `allowedTypes`). Callers should treat `null` as "fall through to
 * top-level resolution".
 */
export function findDeepestBlockAtY(
  view: EditorView,
  clientY: number,
  allowedTypes: string[],
): DeepestBlockMatch | null {
  if (allowedTypes.length === 0) return null;
  let best: DeepestBlockMatch | null = null;
  view.state.doc.descendants((node, pos) => {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return true;
    const rect = dom.getBoundingClientRect();
    // Skip the entire subtree when the cursor isn't vertically inside this
    // node - children of a non-containing parent can't contain the cursor
    // either, so pruning here is what keeps the walk O(depth) instead of
    // O(doc).
    if (clientY < rect.top || clientY > rect.bottom) return false;
    if (
      allowedTypes.includes(node.type.name) &&
      (best === null || rect.height < best.rect.height)
    ) {
      best = { node, pos, dom, rect };
    }
    return true;
  });
  return best;
}
