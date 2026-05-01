/**
 * Scoring infrastructure for resolving the best drag target among the
 * nodes under a cursor. The model is borrowed from Tiptap's drag-handle
 * extension (MIT) - every candidate node starts at `BASE_SCORE` (1000),
 * each rule subtracts a deduction, and the highest-scoring candidate
 * wins. Returning a deduction `>= BASE_SCORE` effectively excludes the
 * node from consideration.
 */
import type { Node, ResolvedPos } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';

/** Starting score for every candidate before deductions. */
export const BASE_SCORE = 1000;

/**
 * Context passed to a rule's `evaluate()` callback. Captures everything
 * a rule might need to decide whether the node should be excluded or
 * deprioritised - node + position info, parent + siblings, depth, plus
 * the live editor view for ad-hoc DOM queries.
 */
export interface RuleContext {
  /** The candidate node being evaluated. */
  node: Node;
  /** Document position right BEFORE the candidate node. */
  pos: number;
  /** Depth in the doc tree (0 = doc, 1 = top-level block, etc.). */
  depth: number;
  /** Parent node, or `null` when the candidate is the document. */
  parent: Node | null;
  /** Index of `node` within `parent.content`. 0 when parent is null. */
  index: number;
  /** True when `index === 0`. */
  isFirst: boolean;
  /** True when `index === parent.childCount - 1`. */
  isLast: boolean;
  /** ProseMirror resolved position the resolver started from. */
  $pos: ResolvedPos;
  /** Live editor view; rules may call `view.nodeDOM(pos)` if needed. */
  view: EditorView;
}

/**
 * A scoring rule. Implementations return a non-negative deduction that
 * is subtracted from the candidate's score. Returning `BASE_SCORE` or
 * higher effectively excludes the candidate.
 */
export interface DragHandleRule {
  /** Stable identifier for debugging / overriding. */
  id: string;
  evaluate: (ctx: RuleContext) => number;
}
