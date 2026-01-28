/**
 * Bold Mark
 *
 * Applies bold formatting to text. Supports multiple HTML tags
 * and CSS font-weight styles.
 *
 * @example
 * ```ts
 * import { Bold } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Bold],
 * });
 *
 * // Toggle bold with keyboard shortcut: Mod-b
 * // Or use input rule: **text**
 * ```
 */
import { Mark } from '../Mark.js';
import { markInputRule, markInputRulePatterns } from '../helpers/markInputRule.js';

/**
 * Options for the Bold mark
 */
export interface BoldOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Bold mark for text formatting
 */
export const Bold = Mark.create<BoldOptions>({
  name: 'bold',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'strong' },
      {
        tag: 'b',
        getAttrs: (node) => {
          if (typeof node === 'string') return {};
          const fontWeight = node.style.fontWeight;

          // Google Docs uses <b style="font-weight:normal"> for non-bold text
          if (fontWeight === 'normal' || fontWeight === '400') {
            return false;
          }

          return {};
        },
      },
      {
        style: 'font-weight',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;

          // Match numeric weight >= 600 (semibold and above)
          const numWeight = parseInt(value, 10);
          if (!isNaN(numWeight) && numWeight >= 600) return {};

          // Match named weights
          if (/^(bold|bolder)$/i.test(value)) return {};

          return false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['strong', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-b': () => this.editor?.commands['toggleMark']?.('bold') ?? false,
      'Mod-B': () => this.editor?.commands['toggleMark']?.('bold') ?? false,
    };
  },

  addCommands() {
    return {
      setBold:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['setMark']?.('bold') ?? false;
        },
      unsetBold:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['unsetMark']?.('bold') ?? false;
        },
      toggleBold:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['toggleMark']?.('bold') ?? false;
        },
    };
  },

  addInputRules() {
    const markType = this.markType;
    if (!markType) return [];

    return [
      // **text** or __text__
      markInputRule({
        find: markInputRulePatterns.bold,
        type: markType,
      }),
    ];
  },
});
