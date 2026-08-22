/**
 * Anchor-container hover resolution (experimental, paired with
 * `NestedConfig.anchorContainers`). Containers listed there (e.g. a `column`
 * node from a multi-column layout) get Notion-style per-block handles: the
 * cursor's RAW clientX picks the container, resolution then runs scoped to
 * that container's subtree, and the handle renders against the container's
 * left edge instead of the editor gutter.
 *
 * Design notes:
 * - X containment is tested against the raw pointer X, NOT the clamped one
 *   `clampToContent` produces: the clamp snaps gutter/margin X into the first
 *   top-level block's rect, which would collapse every side-by-side layout
 *   onto its left container.
 * - The gap BETWEEN two containers is the band of the container whose handle
 *   floats in it: handles always anchor at a container's LEFT edge, so the
 *   nearest container to the RIGHT owns the gap. Hovering the gap summons
 *   that neighbour's handle instantly, exactly like Notion; traveling from a
 *   block in that container to its own handle therefore never re-targets.
 *   (Divider affordances, e.g. a column-resize strip, appear on a dwell
 *   delay and partition the shared pixels on their side.)
 * - Page margins left/right of ALL containers resolve to the nearest one, so
 *   the classic "hover the left margin" gesture keeps working next to a
 *   layout row.
 * - Blocks that every matcher rejects (e.g. inside a container that is itself
 *   nested in an opaque `details`/`blockquote`) yield `null`; the caller then
 *   falls through to the classic global resolution, same as before this
 *   feature existed.
 */
import type { Node } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

import type { BlockMatcher } from './blockMatcher.js';
import { findDeepestBlockAtY, isRejectedByMatchers } from './findTopLevelBlock.js';

/** Loop guard for nested anchor containers (one nesting level is typical). */
const MAX_ANCHOR_DEPTH = 6;

/** Block resolved inside an anchor container, plus where to anchor the handle. */
export interface AnchorResolution {
  pos: number;
  rect: DOMRect;
  dom: HTMLElement;
  /**
   * Client X of the anchor container's left edge, or `null` when the container
   * is flush with the content column (the theme's CSS token position applies,
   * keeping the first container's handle pixel-identical to top-level blocks).
   */
  anchorLeft: number | null;
}

/**
 * `null` = no anchor container applies here; the caller falls through to the
 * classic resolution.
 */
export type AnchorOutcome = AnchorResolution | null;

interface ContainerCandidate {
  node: Node;
  pos: number;
  end: number;
  dom: HTMLElement;
  rect: DOMRect;
}

/**
 * Resolves the hovered block through the anchor-container model. See the
 * module doc for the rules; returns `null` when no container exists at this
 * Y so the caller's classic path stays byte-identical for plain documents.
 */
export function resolveWithinAnchorContainer(
  view: EditorView,
  rawClientX: number,
  clientY: number,
  anchorTypes: string[],
  allowedNodes: string[],
  matchers: readonly BlockMatcher[]
): AnchorOutcome {
  const candidates = collectContainersAtY(view, clientY, anchorTypes);
  if (candidates.length === 0) return null;

  const picked = pickContainer(candidates, rawClientX);
  if (picked === null) return null;

  return resolveInsideContainer(view, picked, clientY, allowedNodes, matchers);
}

/** All anchor-container nodes whose vertical extent contains `clientY`, in document order. */
function collectContainersAtY(
  view: EditorView,
  clientY: number,
  anchorTypes: string[]
): ContainerCandidate[] {
  const out: ContainerCandidate[] = [];
  view.state.doc.descendants((node, pos) => {
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return true;
    const rect = dom.getBoundingClientRect();
    // Prune subtrees the cursor is vertically outside of (same walk shape as
    // `findDeepestBlockAtY`).
    if (clientY < rect.top || clientY > rect.bottom) return false;
    if (anchorTypes.includes(node.type.name)) {
      out.push({ node, pos, end: pos + node.nodeSize, dom, rect });
    }
    return true;
  });
  return out;
}

/**
 * Picks the container the cursor belongs to. Document order puts a nested
 * container AFTER its ancestor, and side-by-side siblings are horizontally
 * disjoint, so "last candidate containing X" is the deepest one. When no
 * candidate contains X, the gap between siblings belongs to the container
 * it hosts the handle OF: handles anchor at a container's LEFT edge and
 * float in the gap left of it, so the nearest container to the RIGHT owns
 * the band (Notion summons the neighbour's handle from the gap the same
 * way; a left-margin X resolves identically since the leftmost container
 * is also the right-owner there). Right of the whole row nothing is left
 * to own the band, so the nearest container wins: the classic page-margin
 * gesture. The same rules re-apply per nesting level, so a cursor in a
 * NESTED layout's gap targets the inner neighbour rather than re-entering
 * the outer container's X-blind walk.
 */
function pickContainer(
  candidates: ContainerCandidate[],
  rawClientX: number
): ContainerCandidate | null {
  let pool = rootsOf(candidates);
  let scope: ContainerCandidate | null = null;

  for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth++) {
    if (pool.length === 0) return scope;
    const containing = pool.filter((c) => rawClientX >= c.rect.left && rawClientX <= c.rect.right);
    let next: ContainerCandidate | null;
    if (containing.length > 0) {
      next = containing[containing.length - 1] ?? null;
    } else {
      next = nearestRightOwner(pool, rawClientX) ?? nearestByX(pool, rawClientX);
    }
    if (!next) return scope;
    scope = next;
    pool = childrenOf(candidates, next);
  }
  return scope;
}

/** The container whose left edge is nearest to the RIGHT of `x` (gap owner). */
function nearestRightOwner(pool: ContainerCandidate[], x: number): ContainerCandidate | null {
  let best: ContainerCandidate | null = null;
  for (const c of pool) {
    if (c.rect.left > x && (best === null || c.rect.left < best.rect.left)) {
      best = c;
    }
  }
  return best;
}

/** Candidates not contained inside another candidate (outermost layer). */
function rootsOf(candidates: ContainerCandidate[]): ContainerCandidate[] {
  return candidates.filter(
    (c) => !candidates.some((o) => o !== c && c.pos > o.pos && c.end <= o.end)
  );
}

/** Candidates directly inside `scope` (next nesting layer, any depth below it). */
function childrenOf(
  candidates: ContainerCandidate[],
  scope: ContainerCandidate
): ContainerCandidate[] {
  const inside = candidates.filter((c) => c.pos > scope.pos && c.end <= scope.end);
  return rootsOf(inside);
}

function nearestByX(pool: ContainerCandidate[], x: number): ContainerCandidate | null {
  let best: ContainerCandidate | null = null;
  let bestDist = Infinity;
  for (const c of pool) {
    const dist = x < c.rect.left ? c.rect.left - x : x > c.rect.right ? x - c.rect.right : 0;
    if (dist < bestDist) {
      best = c;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Classic resolution scoped to one container: deep walk first (nested list
 * items etc.), then the nearest matcher-eligible DIRECT child by Y: the
 * scoped equivalent of `resolveTopLevelByY`'s closest-block fallback, so
 * gaps between blocks and a short column's empty lower area still anchor on
 * the nearest real block.
 */
function resolveInsideContainer(
  view: EditorView,
  scope: ContainerCandidate,
  clientY: number,
  allowedNodes: string[],
  matchers: readonly BlockMatcher[]
): AnchorResolution | null {
  const anchorLeft = anchorLeftFor(view, scope.rect);

  const deep = findDeepestBlockAtY(view, clientY, allowedNodes, matchers, {
    range: { from: scope.pos + 1, to: scope.end - 1 },
  });
  if (deep) return { pos: deep.pos, rect: deep.rect, dom: deep.dom, anchorLeft };

  const child = nearestEligibleChild(view, scope, clientY, matchers);
  if (child) return { ...child, anchorLeft };
  return null;
}

/**
 * Nearest direct child of `scope` by vertical distance whose matcher verdict
 * is `allow`. Distance 0 when the child's rect contains `clientY`.
 */
function nearestEligibleChild(
  view: EditorView,
  scope: ContainerCandidate,
  clientY: number,
  matchers: readonly BlockMatcher[]
): { pos: number; rect: DOMRect; dom: HTMLElement } | null {
  let best: { pos: number; rect: DOMRect; dom: HTMLElement; dist: number } | null = null;
  let childPos = scope.pos + 1;
  for (let i = 0; i < scope.node.childCount; i++) {
    const child = scope.node.child(i);
    const dom = view.nodeDOM(childPos);
    if (dom instanceof HTMLElement) {
      const rejected =
        matchers.length > 0 && isRejectedByMatchers(view, child, childPos, scope.node, i, matchers);
      if (!rejected) {
        const rect = dom.getBoundingClientRect();
        const dist =
          clientY < rect.top
            ? rect.top - clientY
            : clientY > rect.bottom
              ? clientY - rect.bottom
              : 0;
        if (best === null || dist < best.dist) {
          best = { pos: childPos, rect, dom, dist };
        }
      }
    }
    childPos += child.nodeSize;
  }
  if (!best) return null;
  return { pos: best.pos, rect: best.rect, dom: best.dom };
}

/**
 * The handle's anchor X for a container, or `null` when the container's left
 * edge is flush with the content column: there the theme's CSS token position
 * applies, keeping the handle pixel-identical to neighbouring top-level
 * blocks (no X jitter when hovering across the boundary).
 */
function anchorLeftFor(view: EditorView, containerRect: DOMRect): number | null {
  const first = view.dom.firstElementChild;
  if (first) {
    const contentLeft = first.getBoundingClientRect().left;
    if (Math.abs(containerRect.left - contentLeft) < 2) return null;
  }
  return containerRect.left;
}
