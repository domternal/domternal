/**
 * Typography Extension
 *
 * Provides automatic typographic replacements via input rules:
 * - -- → — (em-dash)
 * - ... → … (ellipsis)
 * - Smart quotes
 * - Arrows, fractions, symbols
 */
import { InputRule } from '@domternal/pm/inputrules';
import { Extension } from '../Extension.js';

export interface TypographyOptions {
  /**
   * Enable em-dash replacement (-- → —)
   * @default true
   */
  emDash: boolean;

  /**
   * Enable ellipsis replacement (... → …)
   * @default true
   */
  ellipsis: boolean;

  /**
   * Enable arrow replacements (<- → ←, -> → →)
   * @default true
   */
  arrows: boolean;

  /**
   * Enable fraction replacements (1/2 → ½, 1/4 → ¼, 3/4 → ¾)
   * @default true
   */
  fractions: boolean;

  /**
   * Enable symbol replacements ((c) → ©, (r) → ®, (tm) → ™)
   * @default true
   */
  symbols: boolean;

  /**
   * Enable math replacements (+/- → ±, != → ≠)
   * @default true
   */
  math: boolean;

  /**
   * Enable guillemet replacements (<< → «, >> → »)
   * @default true
   */
  guillemets: boolean;

  /**
   * Enable smart quote replacements ("text" → "text", 'text' → 'text')
   * @default true
   */
  smartQuotes: boolean;

  /**
   * Opening double quote character.
   * @default '"'
   */
  openDoubleQuote: string;

  /**
   * Closing double quote character.
   * @default '"'
   */
  closeDoubleQuote: string;

  /**
   * Opening single quote character.
   * @default '''
   */
  openSingleQuote: string;

  /**
   * Closing single quote character.
   * @default '''
   */
  closeSingleQuote: string;
}

export const Typography = Extension.create<TypographyOptions>({
  name: 'typography',

  addOptions() {
    return {
      emDash: true,
      ellipsis: true,
      arrows: true,
      fractions: true,
      symbols: true,
      math: true,
      guillemets: true,
      smartQuotes: true,
      openDoubleQuote: '\u201C', // "
      closeDoubleQuote: '\u201D', // "
      openSingleQuote: '\u2018', // '
      closeSingleQuote: '\u2019', // '
    };
  },

  addInputRules() {
    const rules: InputRule[] = [];

    // Helper for simple text replacement rules
    const textReplace = (find: RegExp, replacement: string): InputRule =>
      new InputRule(find, (state, _match, start, end) =>
        state.tr.replaceWith(start, end, state.schema.text(replacement)));

    if (this.options.emDash) {
      rules.push(textReplace(/--$/, '\u2014')); // -- → —
    }

    if (this.options.ellipsis) {
      rules.push(textReplace(/\.\.\.$/, '\u2026')); // ... → …
    }

    if (this.options.arrows) {
      rules.push(textReplace(/<-$/, '\u2190'));  // <- → ←
      rules.push(textReplace(/->$/, '\u2192'));  // -> → →
      rules.push(textReplace(/=>$/, '\u21D2'));  // => → ⇒
    }

    if (this.options.fractions) {
      rules.push(textReplace(/1\/2$/, '\u00BD')); // 1/2 → ½
      rules.push(textReplace(/1\/4$/, '\u00BC')); // 1/4 → ¼
      rules.push(textReplace(/3\/4$/, '\u00BE')); // 3/4 → ¾
      rules.push(textReplace(/1\/3$/, '\u2153')); // 1/3 → ⅓
      rules.push(textReplace(/2\/3$/, '\u2154')); // 2/3 → ⅔
    }

    if (this.options.symbols) {
      rules.push(textReplace(/\(c\)$/i, '\u00A9'));  // (c) → ©
      rules.push(textReplace(/\(r\)$/i, '\u00AE'));  // (r) → ®
      rules.push(textReplace(/\(tm\)$/i, '\u2122')); // (tm) → ™
      rules.push(textReplace(/\(sm\)$/i, '\u2120')); // (sm) → ℠
    }

    if (this.options.math) {
      rules.push(textReplace(/\+\/-$/, '\u00B1')); // +/- → ±
      rules.push(textReplace(/!=$/, '\u2260'));     // != → ≠
      rules.push(textReplace(/<=$/, '\u2264'));     // <= → ≤
      rules.push(textReplace(/>=$/, '\u2265'));     // >= → ≥
    }

    if (this.options.guillemets) {
      rules.push(textReplace(/<<$/, '\u00AB')); // << → «
      rules.push(textReplace(/>>$/, '\u00BB')); // >> → »
    }

    // Smart quotes (need match groups, can't use textReplace)
    if (this.options.smartQuotes) {
      const { openDoubleQuote, closeDoubleQuote, openSingleQuote, closeSingleQuote } = this.options;

      // "text" → "text" (double quotes)
      rules.push(
        new InputRule(/"([^"]+)"$/, (state, match, start, end) => {
          const text = match[1] ?? '';
          return state.tr.replaceWith(
            start,
            end,
            state.schema.text(openDoubleQuote + text + closeDoubleQuote)
          );
        })
      );

      // 'text' → 'text' (single quotes - only when clearly a quote pair)
      // Use pattern to avoid matching apostrophes in contractions
      rules.push(
        new InputRule(/(?:^|[\s([{])'([^']+)'$/, (state, match, start, end) => {
          const text = match[1] ?? '';
          const prefix = match[0].charAt(0);
          // If there's a prefix character (space, bracket, etc.), keep it
          const hasPrefix = prefix !== "'";
          return state.tr.replaceWith(
            start,
            end,
            state.schema.text(
              hasPrefix
                ? prefix + openSingleQuote + text + closeSingleQuote
                : openSingleQuote + text + closeSingleQuote
            )
          );
        })
      );
    }

    return rules;
  },
});
