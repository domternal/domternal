/**
 * Subscript Mark
 *
 * Applies subscript formatting to text (e.g., H₂O).
 *
 * @example
 * ```ts
 * import { Subscript } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Subscript],
 * });
 *
 * // Toggle subscript with keyboard shortcut: Mod-,
 * ```
 */
import { Mark } from '../Mark.js';

/**
 * Options for the Subscript mark
 */
export interface SubscriptOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Subscript mark for text formatting
 */
export const Subscript = Mark.create<SubscriptOptions>({
  name: 'subscript',

  // Subscript and superscript are mutually exclusive
  excludes: 'superscript',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'sub' },
      {
        style: 'vertical-align',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          return value === 'sub' ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['sub', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-,': () => this.editor?.commands['toggleMark']?.('subscript') ?? false,
    };
  },

  addCommands() {
    return {
      setSubscript:
        () =>
        ({ commands }) => commands.setMark('subscript'),
      unsetSubscript:
        () =>
        ({ commands }) => commands.unsetMark('subscript'),
      toggleSubscript:
        () =>
        ({ commands }) => commands.toggleMark('subscript'),
    };
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setSubscript: CommandSpec;
    unsetSubscript: CommandSpec;
    toggleSubscript: CommandSpec;
  }
}
