/**
 * Wrapping Input Rule Helper
 *
 * Drop-in replacement for ProseMirror's wrappingInputRule that exposes
 * the `undoable` option so extension authors can opt out of Backspace undo.
 */
import { InputRule } from '@domternal/pm/inputrules';
import { findWrapping, canJoin } from '@domternal/pm/transform';
import type { NodeType, Node, Attrs } from '@domternal/pm/model';
import type { EditorState } from '@domternal/pm/state';

export interface WrappingInputRuleOptions {
  /**
   * The regex pattern to match. Should start with `^` so it only
   * fires at the start of a textblock.
   */
  find: RegExp;

  /**
   * The node type to wrap in.
   */
  type: NodeType;

  /**
   * Whether Backspace can undo this input rule immediately after it fires.
   * @default true
   */
  undoable?: boolean;

  /**
   * Node attributes, or a function that computes them from the match.
   */
  getAttributes?: Attrs | null | ((match: RegExpMatchArray) => Attrs | null);

  /**
   * Predicate that decides whether to join with an adjacent node of
   * the same type above the newly wrapped node.
   */
  joinPredicate?: (match: RegExpMatchArray, node: Node) => boolean;

  /**
   * When `true`, also join with an adjacent same-type node AFTER the newly
   * wrapped node, not just the one before. Lists set this so creating a list
   * item on a paragraph between two same-type lists merges all three into one
   * (Notion groups consecutive list items into a single list). Off by default
   * so wrappers like blockquote, where adjacent blocks stay separate, are
   * unaffected. Honours `joinPredicate` against the following node.
   */
  joinForward?: boolean;

  /**
   * Optional guard predicate. When provided, the rule only fires if
   * this returns true. Use this to prevent wrapping in certain contexts
   * (e.g. don't create a nested list inside an existing list item).
   */
  guard?: (state: EditorState) => boolean;
}

/**
 * Creates an input rule that wraps a textblock in a given node type.
 *
 * @example
 * // `> ` at start of line wraps in blockquote
 * wrappingInputRule({
 *   find: /^\s*>\s$/,
 *   type: schema.nodes.blockquote,
 * });
 *
 * @example
 * // Non-undoable wrapping rule
 * wrappingInputRule({
 *   find: /^\s*>\s$/,
 *   type: schema.nodes.blockquote,
 *   undoable: false,
 * });
 */
export function wrappingInputRule(options: WrappingInputRuleOptions): InputRule {
  const { find, type, getAttributes = null, joinPredicate, undoable, guard, joinForward } = options;

  return new InputRule(
    find,
    (state, match, start, end) => {
      if (guard && !guard(state)) return null;
      const attrs = getAttributes instanceof Function ? getAttributes(match) : getAttributes;
      const tr = state.tr.delete(start, end);
      const $start = tr.doc.resolve(start);
      const range = $start.blockRange();
      const wrapping = range && findWrapping(range, type, attrs);
      if (!wrapping) return null;
      tr.wrap(range, wrapping);
      const before = tr.doc.resolve(start - 1).nodeBefore;
      if (before?.type === type && canJoin(tr.doc, start - 1) &&
          (!joinPredicate || joinPredicate(match, before))) {
        tr.join(start - 1);
      }

      // Forward join: merge with an adjacent same-type node AFTER the wrapped
      // one too (lists only). Without this, wrapping a paragraph that sits
      // between two same-type lists merges with the list above but leaves the
      // list below as a separate sibling. Resolve the cursor's wrapping node
      // (it may already have merged backward) and join the node after it.
      if (joinForward) {
        const $cursor = tr.selection.$from;
        for (let d = $cursor.depth; d >= 0; d--) {
          if ($cursor.node(d).type === type) {
            const after = $cursor.after(d);
            if (after < tr.doc.content.size && canJoin(tr.doc, after)) {
              const nodeAfter = tr.doc.nodeAt(after);
              if (nodeAfter?.type === type &&
                  (!joinPredicate || joinPredicate(match, nodeAfter))) {
                tr.join(after);
              }
            }
            break;
          }
        }
      }
      return tr;
    },
    undoable !== undefined ? { undoable } : {},
  );
}

/**
 * Guard predicate that prevents a wrapping input rule from firing
 * when the cursor is already inside a list item (listItem or taskItem).
 * Pass as the `guard` option to `wrappingInputRule`.
 */
export function notInsideList(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') return false;
  }
  return true;
}
