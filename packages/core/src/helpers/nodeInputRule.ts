/**
 * Node Input Rule Helper
 *
 * Creates input rules that replace matched text with a node.
 * Used for nodes like HorizontalRule, Image, Emoji, etc.
 */
import { InputRule } from '@domternal/pm/inputrules';
import type { NodeType, Attrs } from '@domternal/pm/model';
import type { EditorState } from '@domternal/pm/state';

export interface NodeInputRuleOptions {
  /**
   * The regex pattern to match.
   */
  find: RegExp;

  /**
   * The node type to insert.
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
  getAttributes?: Attrs | null | ((match: RegExpMatchArray, state: EditorState) => Attrs | null);
}

/**
 * Creates an input rule that replaces matched text with a node.
 *
 * @example
 * // `:smile:` inserts an emoji node
 * nodeInputRule({
 *   find: /:([a-zA-Z0-9_+-]+):$/,
 *   type: schema.nodes.emoji,
 *   getAttributes: (match) => ({ name: match[1] }),
 * });
 */
export function nodeInputRule(options: NodeInputRuleOptions): InputRule {
  const { find, type, getAttributes = null, undoable } = options;

  return new InputRule(
    find,
    (state, match, start, end) => {
      const attrs = getAttributes instanceof Function ? getAttributes(match, state) : getAttributes;
      if (getAttributes instanceof Function && attrs === null) return null;
      return state.tr.replaceWith(start, end, type.create(attrs));
    },
    undoable !== undefined ? { undoable } : {},
  );
}
