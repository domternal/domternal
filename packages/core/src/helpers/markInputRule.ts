/**
 * Mark Input Rule Helper
 *
 * Creates input rules for applying marks based on regex patterns.
 * Used for markdown-style shortcuts like **bold**, *italic*, ~~strike~~, etc.
 */
import { InputRule } from '@domternal/pm/inputrules';
import type { MarkType } from '@domternal/pm/model';
import type { EditorState } from '@domternal/pm/state';

/**
 * Options for creating a mark input rule
 */
export interface MarkInputRuleOptions {
  /**
   * The regex pattern to match.
   * Must have a capture group for the content to be marked.
   *
   * @example
   * // Match **text**
   * /(?:\*\*)([^*]+)(?:\*\*)$/
   */
  find: RegExp;

  /**
   * The mark type to apply
   */
  type: MarkType;

  /**
   * Whether Backspace can undo this input rule immediately after it fires.
   * @default true
   */
  undoable?: boolean;

  /**
   * Optional: get attributes from the match
   *
   * @param match - The regex match array
   * @returns Mark attributes or null to skip
   */
  getAttributes?: (match: RegExpMatchArray) => Record<string, unknown> | null;
}

/**
 * Creates an input rule that applies a mark to matched text.
 *
 * When the user types text matching the pattern, the delimiters are removed
 * and the mark is applied to the content.
 *
 * @example
 * // **text** → applies bold mark to "text"
 * markInputRule({
 *   find: /(?:\*\*)([^*]+)(?:\*\*)$/,
 *   type: schema.marks.bold,
 * });
 *
 * @example
 * // `text` → applies code mark to "text"
 * markInputRule({
 *   find: /(?:`)([^`]+)(?:`)$/,
 *   type: schema.marks.code,
 * });
 *
 * @param options - Configuration options
 * @returns ProseMirror InputRule
 */
export function markInputRule(options: MarkInputRuleOptions): InputRule {
  const { find, type, getAttributes, undoable } = options;

  return new InputRule(
    find,
    (state: EditorState, match: RegExpMatchArray, start: number, end: number) => {
      const attributes = getAttributes ? getAttributes(match) : null;

      // If getAttributes returned null, skip this rule
      if (getAttributes && attributes === null) {
        return null;
      }

      // match[0] = full match (e.g., "**text**")
      // match[1] = captured content (e.g., "text")
      const textContent = match[1];
      if (!textContent) {
        return null;
      }

      const { tr } = state;

      // Replace the matched text (including delimiters) with just the content.
      // The replacement carries the marks the matched text already had
      // (stored marks first, like Transaction.insertText), so firing a rule
      // inside commented or colored text does not strip those marks. Schema
      // exclusion still applies when the new mark is added below: addToSet
      // drops any preserved mark the new mark excludes.
      const marks = tr.storedMarks ?? tr.doc.resolve(start).marksAcross(tr.doc.resolve(end));
      tr.replaceWith(start, end, state.schema.text(textContent, marks));

      // Apply the mark to the inserted text
      tr.addMark(start, start + textContent.length, type.create(attributes ?? undefined));

      // Remove the mark at the end so typing continues without the mark
      tr.removeStoredMark(type);

      return tr;
    },
    undoable !== undefined ? { undoable } : {},
  );
}

/**
 * Pre-built regex patterns for common mark input rules
 */
export const markInputRulePatterns = {
  /**
   * Bold: **text** or __text__
   * Matches text wrapped in double asterisks or underscores
   */
  bold: /(?:\*\*|__)([^*_]+)(?:\*\*|__)$/,

  /**
   * Strike: ~~text~~
   * Matches text wrapped in double tildes
   */
  strike: /(?:~~)([^~]+)(?:~~)$/,

  /**
   * Code: `text`
   * Matches text wrapped in backticks
   */
  code: /(?:`)([^`]+)(?:`)$/,

  /**
   * Highlight: ==text==
   * Matches text wrapped in double equals
   */
  highlight: /(?:==)([^=]+)(?:==)$/,
} as const;
