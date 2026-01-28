/**
 * Italic Mark
 *
 * Applies italic formatting to text. Supports multiple HTML tags
 * and CSS font-style styles.
 *
 * @example
 * ```ts
 * import { Italic } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Italic],
 * });
 *
 * // Toggle italic with keyboard shortcut: Mod-i
 * // Or use input rule: *text* or _text_
 * ```
 */
import { Mark } from '../Mark.js';
import { markInputRule } from '../helpers/markInputRule.js';

/**
 * Options for the Italic mark
 */
export interface ItalicOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Italic mark for text formatting
 */
export const Italic = Mark.create<ItalicOptions>({
  name: 'italic',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'em' },
      {
        tag: 'i',
        getAttrs: (node) => {
          if (typeof node === 'string') return {};
          const fontStyle = node.style.fontStyle;

          // Google Docs uses <i style="font-style:normal"> for non-italic text
          if (fontStyle === 'normal') {
            return false;
          }

          return {};
        },
      },
      {
        style: 'font-style',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          return /^italic$/i.test(value) ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['em', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-i': () => this.editor?.commands['toggleMark']?.('italic') ?? false,
      'Mod-I': () => this.editor?.commands['toggleMark']?.('italic') ?? false,
    };
  },

  addCommands() {
    return {
      setItalic:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['setMark']?.('italic') ?? false;
        },
      unsetItalic:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['unsetMark']?.('italic') ?? false;
        },
      toggleItalic:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['toggleMark']?.('italic') ?? false;
        },
    };
  },

  addInputRules() {
    const markType = this.markType;
    if (!markType) return [];

    return [
      // *text* - using negative lookbehind to avoid matching **text**
      markInputRule({
        find: /(?<!\*)\*([^*]+)\*$/,
        type: markType,
      }),
      // _text_ - using negative lookbehind to avoid matching __text__
      markInputRule({
        find: /(?<!_)_([^_]+)_$/,
        type: markType,
      }),
    ];
  },
});
