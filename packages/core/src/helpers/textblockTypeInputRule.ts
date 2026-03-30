/**
 * Textblock Type Input Rule Helper
 *
 * Drop-in replacement for ProseMirror's textblockTypeInputRule that exposes
 * the `undoable` option so extension authors can opt out of Backspace undo.
 */
import { InputRule } from '@domternal/pm/inputrules';
import type { NodeType, Attrs } from '@domternal/pm/model';

export interface TextblockTypeInputRuleOptions {
  /**
   * The regex pattern to match. Should start with `^` so it only
   * fires at the start of a textblock.
   */
  find: RegExp;

  /**
   * The node type to change the textblock to.
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
}

/**
 * Creates an input rule that changes the type of a textblock.
 *
 * @example
 * // `## ` at start of line converts to heading level 2
 * textblockTypeInputRule({
 *   find: /^(#{1,4})\s$/,
 *   type: schema.nodes.heading,
 *   getAttributes: (match) => ({ level: match[1].length }),
 * });
 */
export function textblockTypeInputRule(options: TextblockTypeInputRuleOptions): InputRule {
  const { find, type, getAttributes = null, undoable } = options;

  return new InputRule(
    find,
    (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      const attrs = getAttributes instanceof Function ? getAttributes(match) : getAttributes;
      if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), type)) return null;
      return state.tr
        .delete(start, end)
        .setBlockType(start, start, type, attrs);
    },
    undoable !== undefined ? { undoable } : {},
  );
}
