/**
 * Text Input Rule Helper
 *
 * Creates input rules for simple text replacements (e.g. `--` to em dash).
 */
import { InputRule } from '@domternal/pm/inputrules';

export interface TextInputRuleOptions {
  /**
   * The regex pattern to match.
   */
  find: RegExp;

  /**
   * The replacement text.
   */
  replace: string;

  /**
   * Whether Backspace can undo this input rule immediately after it fires.
   * @default true
   */
  undoable?: boolean;
}

/**
 * Creates an input rule that replaces matched text with a string.
 *
 * @example
 * // `--` converts to em dash
 * textInputRule({ find: /--$/, replace: '\u2014' });
 *
 * @example
 * // Non-undoable replacement
 * textInputRule({ find: /->$/, replace: '\u2192', undoable: false });
 */
export function textInputRule(options: TextInputRuleOptions): InputRule {
  const { find, replace, undoable } = options;

  return new InputRule(
    find,
    (state, _match, start, end) => state.tr.replaceWith(start, end, state.schema.text(replace)),
    undoable !== undefined ? { undoable } : {},
  );
}
