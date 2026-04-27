/**
 * Score-based drag target resolver. Walks ancestors at the cursor's
 * resolved position from deepest to shallowest, scores each one via
 * `BASE_SCORE - sum(rule deductions) - edgeDeduction(strength * depth)`,
 * and returns the highest-scoring candidate. Tie-break favours the
 * deepest depth so users hovering text get the nearest block, not the
 * document.
 *
 * Algorithm + scoring constants modelled on Tiptap's drag-handle
 * extension (MIT, `@tiptap/extension-drag-handle`).
 */
import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

import { BASE_SCORE } from './scoring.js';
import type { DragHandleRule, RuleContext } from './scoring.js';
import { calculateEdgeDeduction } from './edgeDetection.js';
import type { EdgeDetectionConfig } from './edgeDetection.js';

export interface FindBestDragTargetOptions {
  rules: DragHandleRule[];
  edgeConfig: EdgeDetectionConfig | null;
  /** When non-empty, only nodes whose type name is in this list can win. */
  allowedNodeTypes?: string[];
  /**
   * When non-empty, the candidate (or one of its ancestors) must include
   * a node of one of these type names. Used to scope nested mode to
   * specific structures (e.g. only inside `table`).
   */
  allowedContainers?: string[];
}

export interface DragTarget {
  pos: number;
  rect: DOMRect;
  dom: HTMLElement;
  /** Resolved depth in the document tree. */
  depth: number;
  /** Final score; exposed mainly for tests. */
  score: number;
  /** The PM node at `pos`. */
  node: Node;
}

/**
 * Returns the best drag target for the cursor at (clientX, clientY), or
 * `null` if no candidate scores above zero (or the position is outside
 * the doc).
 */
export function findBestDragTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  options: FindBestDragTargetOptions,
): DragTarget | null {
  const coord = view.posAtCoords({ left: clientX, top: clientY });
  if (!coord) return null;
  const $pos = view.state.doc.resolve(coord.pos);
  const candidates: DragTarget[] = [];

  // Walk ancestors deepest → shallowest; depth 0 is the document root,
  // never a drag target.
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    const pos = $pos.before(depth);
    const parent = depth > 0 ? $pos.node(depth - 1) : null;
    const index = depth > 0 ? $pos.index(depth - 1) : 0;
    const siblingCount = parent ? parent.childCount : 1;

    if (!isAllowedTarget(node, $pos, depth, options)) continue;

    const ctx: RuleContext = {
      node,
      pos,
      depth,
      parent,
      index,
      isFirst: index === 0,
      isLast: index === siblingCount - 1,
      $pos,
      view,
    };

    let score = BASE_SCORE;
    for (const rule of options.rules) {
      score -= rule.evaluate(ctx);
      if (score <= 0) break;
    }
    if (score <= 0) continue;

    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) continue;
    const rect = dom.getBoundingClientRect();

    if (options.edgeConfig) {
      score -= calculateEdgeDeduction(clientX, clientY, rect, depth, options.edgeConfig);
      if (score <= 0) continue;
    }

    candidates.push({ pos, rect, dom, depth, score, node });
  }

  // Atom-leaf fallback: images, horizontal rules, etc. live as
  // `$pos.nodeAfter` rather than as ancestors of `$pos`. Tiptap synthesises
  // a candidate at depth + 1 for them. We do the same so atoms still
  // surface a handle.
  const nodeAfter = $pos.nodeAfter;
  if (nodeAfter && nodeAfter.isAtom && !nodeAfter.isInline) {
    const depth = $pos.depth + 1;
    const parent = $pos.parent;
    const index = $pos.index();
    const siblingCount = parent.childCount;
    if (isAllowedTarget(nodeAfter, $pos, depth, options)) {
      const ctx: RuleContext = {
        node: nodeAfter,
        pos: $pos.pos,
        depth,
        parent,
        index,
        isFirst: index === 0,
        isLast: index === siblingCount - 1,
        $pos,
        view,
      };
      let score = BASE_SCORE;
      for (const rule of options.rules) {
        score -= rule.evaluate(ctx);
        if (score <= 0) break;
      }
      if (score > 0) {
        const dom = view.nodeDOM($pos.pos);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          if (options.edgeConfig) {
            score -= calculateEdgeDeduction(clientX, clientY, rect, depth, options.edgeConfig);
          }
          if (score > 0) {
            candidates.push({ pos: $pos.pos, rect, dom, depth, score, node: nodeAfter });
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Highest score wins; tie-break by deepest depth so users hovering
  // text get the leaf block, not its container, when no rule has
  // separated them.
  candidates.sort((a, b) => (b.score - a.score) || (b.depth - a.depth));
  return candidates[0] ?? null;
}

function isAllowedTarget(
  node: Node,
  $pos: ResolvedPos,
  depth: number,
  options: FindBestDragTargetOptions,
): boolean {
  if (options.allowedNodeTypes && options.allowedNodeTypes.length > 0) {
    if (!options.allowedNodeTypes.includes(node.type.name)) return false;
  }
  if (options.allowedContainers && options.allowedContainers.length > 0) {
    let foundAncestor = false;
    for (let d = depth - 1; d >= 1; d--) {
      const ancestor = $pos.node(d);
      if (options.allowedContainers.includes(ancestor.type.name)) {
        foundAncestor = true;
        break;
      }
    }
    if (!foundAncestor) return false;
  }
  return true;
}
