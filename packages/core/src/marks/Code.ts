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
import type { CommandSpec } from '../types/Commands.js';
import { markInputRule, markInputRulePatterns } from '../helpers/markInputRule.js';
import type { ToolbarItem } from '../types/Toolbar.js';

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

  // Code cannot be combined with other FORMATTING marks (bold, italic,
  // color...), but semantic marks outside the group (link, a comment
  // thread anchor) survive: code excludes the 'formatting' group instead
  // of '_' (everything). Third-party formatting marks opt into the same
  // exclusion by declaring group: 'formatting'. Code is in the group
  // itself, which also keeps it self-exclusive.
  group: 'formatting',
  excludes: 'formatting',

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

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'code',
        command: 'toggleCode',
        isActive: 'code',
        icon: 'code',
        label: 'Code',
        shortcut: 'Mod-E',
        group: 'format',
        priority: 160,
      },
    ];
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

declare module '@domternal/core' {
  interface RawCommands {
    setCode: CommandSpec;
    unsetCode: CommandSpec;
    toggleCode: CommandSpec;
  }
}
