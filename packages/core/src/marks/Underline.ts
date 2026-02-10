/**
 * Underline Mark
 *
 * Applies underline formatting to text.
 *
 * @example
 * ```ts
 * import { Underline } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Underline],
 * });
 *
 * // Toggle underline with keyboard shortcut: Mod-u
 * ```
 */
import { Mark } from '../Mark.js';

/**
 * Options for the Underline mark
 */
export interface UnderlineOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Underline mark for text formatting
 */
export const Underline = Mark.create<UnderlineOptions>({
  name: 'underline',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          // text-decoration can be "underline" or "underline dotted" etc.
          return value.includes('underline') ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['u', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-u': () => this.editor?.commands['toggleMark']?.('underline') ?? false,
      'Mod-U': () => this.editor?.commands['toggleMark']?.('underline') ?? false,
    };
  },

  addCommands() {
    return {
      setUnderline:
        () =>
        ({ commands }) => commands.setMark('underline'),
      unsetUnderline:
        () =>
        ({ commands }) => commands.unsetMark('underline'),
      toggleUnderline:
        () =>
        ({ commands }) => commands.toggleMark('underline'),
    };
  },

  // No input rules for underline (no common markdown syntax)
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setUnderline: CommandSpec;
    unsetUnderline: CommandSpec;
    toggleUnderline: CommandSpec;
  }
}
