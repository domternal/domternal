/**
 * Predicate-based block matching for nested drag-target resolution.
 *
 * A matcher answers one question for a candidate node: "should this be
 * eligible to become the drag target?" Predicates return a verdict (allow
 * or reject), and the resolver filters the candidate list before ranking.
 *
 * This replaces the score-deduction approach with explicit verdicts so
 * the contract is binary: a candidate is either eligible or it isn't,
 * with rank decided separately by depth + optional gutter bias.
 */
import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

/** Eligibility verdict returned by a matcher's `test()`. */
export type MatchVerdict = 'allow' | 'reject';

/**
 * Information passed to a matcher about the node being considered.
 * Bundles the node itself, its position metadata, its parent context,
 * and the live editor view (in case a matcher needs DOM lookups).
 */
export interface BlockCandidate {
  /** The PM node being considered as a drag target. */
  block: Node;
  /** Document position immediately before `block`. */
  documentPos: number;
  /** Depth in the PM tree; 0 is the doc root and is never a candidate. */
  treeDepth: number;
  /** Parent node, or `null` when there is no parent. */
  container: Node | null;
  /** Index of `block` inside `container.content`. */
  positionInContainer: number;
  /** Convenience: `positionInContainer === 0`. */
  isFirstChild: boolean;
  /** Convenience: `positionInContainer === container.childCount - 1`. */
  isLastChild: boolean;
  /** The ProseMirror resolved position the resolver started from. */
  resolvedPos: ResolvedPos;
  /** Live editor view; matchers may call `editorView.nodeDOM(pos)`. */
  editorView: EditorView;
}

/**
 * A single matcher with a stable name (for debugging / opt-out) and a
 * pure-function predicate.
 */
export interface BlockMatcher {
  name: string;
  test(candidate: BlockCandidate): MatchVerdict;
}
