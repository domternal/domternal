/**
 * Predicate-based block matching for nested drag-target resolution. A matcher
 * answers "is this candidate eligible to become the drag target?" with an
 * allow/reject verdict; the resolver filters before ranking. The contract is
 * binary (eligible or not), with rank decided separately by depth + optional
 * gutter bias.
 */
import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

/** Eligibility verdict returned by a matcher's `test()`. */
export type MatchVerdict = 'allow' | 'reject';

/**
 * Information passed to a matcher: the node, its position metadata, parent
 * context, and the live editor view (for DOM lookups).
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

/** A matcher: a stable name (for debugging / opt-out) and a pure predicate. */
export interface BlockMatcher {
  name: string;
  test(candidate: BlockCandidate): MatchVerdict;
}
