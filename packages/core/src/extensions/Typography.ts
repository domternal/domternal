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

    // Em-dash: -- → —
    if (this.options.emDash) {
      rules.push(
        new InputRule(/--$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('—'));
        })
      );
    }

    // Ellipsis: ... → …
    if (this.options.ellipsis) {
      rules.push(
        new InputRule(/\.\.\.$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('…'));
        })
      );
    }

    // Arrows
    if (this.options.arrows) {
      // <- → ←
      rules.push(
        new InputRule(/<-$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('←'));
        })
      );
      // -> → →
      rules.push(
        new InputRule(/->$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('→'));
        })
      );
      // => → ⇒
      rules.push(
        new InputRule(/=>$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('⇒'));
        })
      );
    }

    // Fractions
    if (this.options.fractions) {
      rules.push(
        new InputRule(/1\/2$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('½'));
        })
      );
      rules.push(
        new InputRule(/1\/4$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('¼'));
        })
      );
      rules.push(
        new InputRule(/3\/4$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('¾'));
        })
      );
      rules.push(
        new InputRule(/1\/3$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('⅓'));
        })
      );
      rules.push(
        new InputRule(/2\/3$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('⅔'));
        })
      );
    }

    // Symbols
    if (this.options.symbols) {
      // (c) → ©
      rules.push(
        new InputRule(/\(c\)$/i, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('©'));
        })
      );
      // (r) → ®
      rules.push(
        new InputRule(/\(r\)$/i, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('®'));
        })
      );
      // (tm) → ™
      rules.push(
        new InputRule(/\(tm\)$/i, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('™'));
        })
      );
      // (sm) → ℠
      rules.push(
        new InputRule(/\(sm\)$/i, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('℠'));
        })
      );
    }

    // Math symbols
    if (this.options.math) {
      // +/- → ±
      rules.push(
        new InputRule(/\+\/-$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('±'));
        })
      );
      // != → ≠
      rules.push(
        new InputRule(/!=$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('≠'));
        })
      );
      // <= → ≤
      rules.push(
        new InputRule(/<=$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('≤'));
        })
      );
      // >= → ≥
      rules.push(
        new InputRule(/>=$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('≥'));
        })
      );
    }

    // Guillemets
    if (this.options.guillemets) {
      // << → «
      rules.push(
        new InputRule(/<<$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('«'));
        })
      );
      // >> → »
      rules.push(
        new InputRule(/>>$/, (state, _match, start, end) => {
          return state.tr.replaceWith(start, end, state.schema.text('»'));
        })
      );
    }

    // Smart quotes
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
