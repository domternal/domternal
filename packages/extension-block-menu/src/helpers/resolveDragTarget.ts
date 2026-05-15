/**
 * Two-stage drag target resolver: filter eligible candidates by matcher
 * verdicts, then rank survivors by depth (and optional gutter bias).
 *
 * Algorithm:
 *   1. Resolve cursor to a doc position via `posAtCoords`.
 *   2. Walk ancestors from the deepest (innermost) outward.
 *   3. Each ancestor is checked against type/container constraints, then
 *      against every matcher's `test()`. Any 'reject' verdict drops it.
 *   4. Atom leaves (image, horizontal rule, etc.) are not ancestors of
 *      the resolved position - they live at `$pos.nodeAfter`. A separate
 *      pass adds them as candidates at depth + 1.
 *   5. The survivor list is ranked: when no gutter bias is configured,
 *      depth alone decides (deepest wins). When bias is configured, each
 *      candidate's effective rank is `treeDepth - gutterPenalty`, where
 *      `gutterPenalty = strength * depth` for in-gutter rects and 0
 *      otherwise.
 *   6. Highest effective rank wins; ties break by deeper depth.
 */
import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

import type { BlockCandidate, BlockMatcher, MatchVerdict } from './blockMatcher.js';
import { gutterBiasWeight } from './gutterBias.js';
import type { GutterBiasConfig } from './gutterBias.js';

export interface ResolveDragTargetOptions {
  /** Matchers applied to every candidate. Empty array = no filtering. */
  matchers: readonly BlockMatcher[];
  /** Active gutter-bias config, or `null` to disable. */
  gutterBias: GutterBiasConfig | null;
  /**
   * Allow-list of PM node type names. When non-empty, only nodes whose
   * type name appears here can become the drag target.
   */
  allowedTypes?: readonly string[];
  /**
   * Required ancestor types. When non-empty, the candidate's chain must
   * contain at least one ancestor whose type name appears here.
   */
  requiredAncestorTypes?: readonly string[];
}

export interface DragTarget {
  pos: number;
  rect: DOMRect;
  dom: HTMLElement;
  /** Tree depth at which the target sits. */
  depth: number;
  /** Effective rank used to pick this candidate. Exposed for tests. */
  rank: number;
  /** The PM node at `pos`. */
  node: Node;
}

interface RankedCandidate extends DragTarget {}

/**
 * Find the best drag target for cursor `(x, y)`, or `null` when no
 * candidate survives the matcher pass.
 */
export function resolveDragTarget(
  view: EditorView,
  x: number,
  y: number,
  options: ResolveDragTargetOptions,
): DragTarget | null {
  const coord = view.posAtCoords({ left: x, top: y });
  if (coord === null) return null;

  const $pos = view.state.doc.resolve(coord.pos);
  const survivors: RankedCandidate[] = [];

  collectAncestors($pos, view, options, survivors);
  collectAtomLeaf($pos, view, options, survivors);

  if (survivors.length === 0) return null;
  applyGutterBias(survivors, x, y, options.gutterBias);
  return chooseWinner(survivors);
}

function collectAncestors(
  $pos: ResolvedPos,
  view: EditorView,
  options: ResolveDragTargetOptions,
  out: RankedCandidate[],
): void {
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const block = $pos.node(depth);
    const documentPos = $pos.before(depth);
    const container = depth > 0 ? $pos.node(depth - 1) : null;
    const positionInContainer = depth > 0 ? $pos.index(depth - 1) : 0;
    const containerSize = container?.childCount ?? 1;

    if (!passesScopeFilters(block, $pos, depth, options)) continue;

    const candidate: BlockCandidate = {
      block,
      documentPos,
      treeDepth: depth,
      container,
      positionInContainer,
      isFirstChild: positionInContainer === 0,
      isLastChild: positionInContainer === containerSize - 1,
      resolvedPos: $pos,
      editorView: view,
    };

    if (rejectedByMatchers(candidate, options.matchers)) continue;

    const dom = view.nodeDOM(documentPos);
    if (!(dom instanceof HTMLElement)) continue;

    out.push({
      pos: documentPos,
      rect: dom.getBoundingClientRect(),
      dom,
      depth,
      rank: depth,
      node: block,
    });
  }
}

function collectAtomLeaf(
  $pos: ResolvedPos,
  view: EditorView,
  options: ResolveDragTargetOptions,
  out: RankedCandidate[],
): void {
  const leaf = $pos.nodeAfter;
  if (leaf === null) return;
  if (!leaf.isAtom || leaf.isInline) return;

  const synthDepth = $pos.depth + 1;
  if (!passesScopeFilters(leaf, $pos, synthDepth, options)) return;

  const parent = $pos.parent;
  const positionInContainer = $pos.index();
  const containerSize = parent.childCount;

  const candidate: BlockCandidate = {
    block: leaf,
    documentPos: $pos.pos,
    treeDepth: synthDepth,
    container: parent,
    positionInContainer,
    isFirstChild: positionInContainer === 0,
    isLastChild: positionInContainer === containerSize - 1,
    resolvedPos: $pos,
    editorView: view,
  };

  if (rejectedByMatchers(candidate, options.matchers)) return;

  const dom = view.nodeDOM($pos.pos);
  if (!(dom instanceof HTMLElement)) return;

  out.push({
    pos: $pos.pos,
    rect: dom.getBoundingClientRect(),
    dom,
    depth: synthDepth,
    rank: synthDepth,
    node: leaf,
  });
}

function passesScopeFilters(
  block: Node,
  $pos: ResolvedPos,
  depth: number,
  options: ResolveDragTargetOptions,
): boolean {
  const { allowedTypes, requiredAncestorTypes } = options;

  if (allowedTypes !== undefined && allowedTypes.length > 0) {
    if (!allowedTypes.includes(block.type.name)) return false;
  }

  if (requiredAncestorTypes !== undefined && requiredAncestorTypes.length > 0) {
    if (!hasMatchingAncestor($pos, depth, requiredAncestorTypes)) return false;
  }

  return true;
}

function hasMatchingAncestor(
  $pos: ResolvedPos,
  depth: number,
  acceptableTypes: readonly string[],
): boolean {
  for (let d = depth - 1; d >= 1; d--) {
    const ancestor = $pos.node(d);
    if (acceptableTypes.includes(ancestor.type.name)) return true;
  }
  return false;
}

function rejectedByMatchers(
  candidate: BlockCandidate,
  matchers: readonly BlockMatcher[],
): boolean {
  for (const matcher of matchers) {
    const verdict: MatchVerdict = matcher.test(candidate);
    if (verdict === 'reject') return true;
  }
  return false;
}

function applyGutterBias(
  candidates: RankedCandidate[],
  x: number,
  y: number,
  config: GutterBiasConfig | null,
): void {
  if (config === null) return;
  for (const c of candidates) {
    const penalty = gutterBiasWeight(x, y, c.rect, c.depth, config);
    c.rank = c.depth - penalty;
  }
}

function chooseWinner(candidates: readonly RankedCandidate[]): DragTarget {
  // Caller guarantees `candidates.length > 0`; the `reduce` keeps the
  // type narrowing happy without non-null assertions on indexed access.
  return candidates.reduce((best, c) => {
    if (c.rank > best.rank) return c;
    if (c.rank === best.rank && c.depth > best.depth) return c;
    return best;
  });
}
