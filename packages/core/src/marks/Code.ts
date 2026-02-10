/**
 * Code Mark
 *
 * Applies inline code formatting to text. This mark is exclusive,
 * meaning it cannot be combined with other marks like bold or italic.
 *
 * @example
 * ```ts
 * import { Code } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Code],
 * });
 *
 * // Toggle code with keyboard shortcut: Mod-e
 * // Or use input rule: `text`
 * ```
 */
import { Mark } from '../Mark.js';
import { markInputRule, markInputRulePatterns } from '../helpers/markInputRule.js';

/**
 * Options for the Code mark
 */
export interface CodeOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Code mark for inline code formatting
 */
export const Code = Mark.create<CodeOptions>({
  name: 'code',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  // Code mark is exclusive - it cannot be combined with other marks
  // ProseMirror uses '_' to mean "exclude all marks"
  excludes: '_',

  // Code should not span across multiple nodes
  spanning: false,

  parseHTML() {
    return [{ tag: 'code' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['code', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-e': () => this.editor?.commands['toggleMark']?.('code') ?? false,
      'Mod-E': () => this.editor?.commands['toggleMark']?.('code') ?? false,
    };
  },

  addCommands() {
    return {
      setCode:
        () =>
        ({ commands }) => commands.setMark('code'),
      unsetCode:
        () =>
        ({ commands }) => commands.unsetMark('code'),
      toggleCode:
        () =>
        ({ commands }) => commands.toggleMark('code'),
    };
  },

  addInputRules() {
    const markType = this.markType;
    if (!markType) return [];

    return [
      // `text`
      markInputRule({
        find: markInputRulePatterns.code,
        type: markType,
      }),
    ];
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setCode: CommandSpec;
    unsetCode: CommandSpec;
    toggleCode: CommandSpec;
  }
}
