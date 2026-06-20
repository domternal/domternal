import type { Node } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

import type { BlockCandidate, BlockMatcher } from './blockMatcher.js';

/** Information about a top-level block in the document. */
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
 * a given absolute position. Returns `null` when `pos` resolves to the
 * document itself (depth 0) or is out of bounds.
 */
export function findTopLevelBlock(doc: Node, pos: number): TopLevelBlock | null {
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);

  // Position exactly at a top-level boundary; `doc.nodeAt(pos)` returns the
  // node starting here.
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
 * Resolves the deepest ancestor whose type name appears in `draggableTypes`,
 * falling back to `findTopLevelBlock` if none match. Used by `BlockHandle` in
 * `nested` mode, where the handle targets individual list/task items rather than
 * the whole list. Walks deepest-first so nested lists resolve to the innermost
 * matching item.
 */
export function findDraggableBlock(
  doc: Node,
  pos: number,
  draggableTypes: string[],
): TopLevelBlock | null {
  if (pos < 0 || pos > doc.content.size) return null;
  if (draggableTypes.length === 0) return findTopLevelBlock(doc, pos);
  const $pos = doc.resolve(pos);

  // Walk ancestors deepest to shallowest (skip depth 0 = doc).
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (draggableTypes.includes(node.type.name)) {
      const blockPos = $pos.before(depth);
      // Index within the direct parent, as the sibling-reorder logic expects.
      const index = $pos.index(depth - 1);
      return {
        node,
        pos: blockPos,
        end: blockPos + node.nodeSize,
        index,
      };
    }
  }

  // No matching ancestor: fall back to the top-level block so hover/drag still
  // works for plain paragraphs outside any container.
  return findTopLevelBlock(doc, pos);
}

/** Spatial result returned by {@link findDeepestBlockAtY}. */
export interface DeepestBlockMatch {
  node: Node;
  pos: number;
  dom: HTMLElement;
  rect: DOMRect;
}

/**
 * Hysteresis options for {@link findDeepestBlockAtY}, keeping the target stable
 * so it doesn't flip-flop near a nested-list boundary.
 */
export interface FindDeepestBlockOptions {
  /**
   * The previous dragover's resolved block. Its containment test is widened by
   * `hysteresisBand` so the cursor must move decisively out before a different
   * block (outer<->inner list item) takes over. Ranking unchanged; only
   * eligibility widens.
   */
  incumbentPos?: number | null;
  /** Sticky margin (px) for the incumbent's containment test. `0` disables. */
  hysteresisBand?: number;
}

/**
 * Finds the deepest (smallest-height) `allowedTypes` block whose vertical rect
 * contains `clientY`. X is ignored on purpose: the handle sits in the left
 * gutter, so X-based resolution would pick the outer block; Y anchors on the row
 * the cursor is actually in. `matchers` can `'reject'` candidates (e.g. a list
 * item's label paragraph). The gutter-bias alternative is Mode C
 * ({@link ./resolveDragTarget resolveDragTarget}). Returns `null` when nothing
 * matches (caller falls through to top-level).
 */
export function findDeepestBlockAtY(
  view: EditorView,
  clientY: number,
  allowedTypes: string[],
  matchers: readonly BlockMatcher[] = [],
  options: FindDeepestBlockOptions = {},
): DeepestBlockMatch | null {
  if (allowedTypes.length === 0) return null;
  const incumbentPos = options.incumbentPos ?? null;
  // Band only engages when there's an incumbent to be sticky about.
  const band = incumbentPos !== null ? Math.max(0, options.hysteresisBand ?? 0) : 0;
  let best: DeepestBlockMatch | null = null;
  view.state.doc.descendants((node, pos, parent, index) => {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return true;
    const rect = dom.getBoundingClientRect();
    // Prune the subtree when the cursor is outside this node (walk stays
    // O(depth)). Widened by `band` so the incumbent's ancestors stay walkable.
    if (clientY < rect.top - band || clientY > rect.bottom + band) return false;
    if (allowedTypes.includes(node.type.name)) {
      if (matchers.length > 0 && isRejectedByMatchers(view, node, pos, parent, index, matchers)) {
        return true;
      }
      // Normal candidates must strictly contain the cursor; the incumbent wins
      // within the banded extent. Ranking still uses the real height.
      const strictlyContains = clientY >= rect.top && clientY <= rect.bottom;
      const incumbentContains =
        pos === incumbentPos && clientY >= rect.top - band && clientY <= rect.bottom + band;
      if ((strictlyContains || incumbentContains) && (best === null || rect.height < best.rect.height)) {
        best = { node, pos, dom, rect };
      }
    }
    return true;
  });
  return best;
}

function isRejectedByMatchers(
  view: EditorView,
  node: Node,
  pos: number,
  parent: Node | null,
  index: number,
  matchers: readonly BlockMatcher[],
): boolean {
  const $pos = view.state.doc.resolve(pos);
  const candidate: BlockCandidate = {
    block: node,
    documentPos: pos,
    // `pos` sits right BEFORE `node`, so $pos.depth is the parent's depth and
    // `node` lives one level deeper.
    treeDepth: $pos.depth + 1,
    container: parent,
    positionInContainer: index,
    isFirstChild: index === 0,
    isLastChild: parent !== null ? index === parent.childCount - 1 : true,
    resolvedPos: $pos,
    editorView: view,
  };
  for (const matcher of matchers) {
    if (matcher.test(candidate) === 'reject') return true;
  }
  return false;
}
