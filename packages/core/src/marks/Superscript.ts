/**
 * Superscript Mark
 *
 * Applies superscript formatting to text (e.g., x²).
 *
 * @example
 * ```ts
 * import { Superscript } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Superscript],
 * });
 *
 * // Toggle superscript with keyboard shortcut: Mod-.
 * ```
 */
import { Mark } from '../Mark.js';

/**
 * Options for the Superscript mark
 */
export interface SuperscriptOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Superscript mark for text formatting
 */
export const Superscript = Mark.create<SuperscriptOptions>({
  name: 'superscript',

  // Superscript and subscript are mutually exclusive
  excludes: 'subscript',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'sup' },
      {
        style: 'vertical-align',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          return value === 'super' ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-.': () => this.editor?.commands['toggleMark']?.('superscript') ?? false,
    };
  },

  addCommands() {
    return {
      setSuperscript:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['setMark']?.('superscript') ?? false;
        },
      unsetSuperscript:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['unsetMark']?.('superscript') ?? false;
        },
      toggleSuperscript:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['toggleMark']?.('superscript') ?? false;
        },
    };
  },
});
