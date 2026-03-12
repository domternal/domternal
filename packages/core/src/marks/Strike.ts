/**
 * Strike Mark
 *
 * Applies strikethrough formatting to text.
 *
 * @example
 * ```ts
 * import { Strike } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Strike],
 * });
 *
 * // Toggle strike with keyboard shortcut: Mod-Shift-s
 * // Or use input rule: ~~text~~
 * ```
 */
import { Mark } from '../Mark.js';
import { markInputRule, markInputRulePatterns } from '../helpers/markInputRule.js';
import type { ToolbarItem } from '../types/Toolbar.js';

/**
 * Options for the Strike mark
 */
export interface StrikeOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Strike mark for text formatting
 */
export const Strike = Mark.create<StrikeOptions>({
  name: 'strike',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 's' },
      { tag: 'del' },
      { tag: 'strike' }, // Deprecated but still common
      {
        style: 'text-decoration',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          return value.includes('line-through') ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['s', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-s': () => this.editor?.commands['toggleMark']?.('strike') ?? false,
    };
  },

  addCommands() {
    return {
      setStrike:
        () =>
        ({ commands }) => commands.setMark('strike'),
      unsetStrike:
        () =>
        ({ commands }) => commands.unsetMark('strike'),
      toggleStrike:
        () =>
        ({ commands }) => commands.toggleMark('strike'),
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'strike',
        command: 'toggleStrike',
        isActive: 'strike',
        icon: 'textStrikethrough',
        label: 'Strikethrough',
        shortcut: 'Mod-Shift-S',
        group: 'format',
        priority: 170,
      },
    ];
  },

  addInputRules() {
    const markType = this.markType;
    if (!markType) return [];

    return [
      // ~~text~~
      markInputRule({
        find: markInputRulePatterns.strike,
        type: markType,
      }),
    ];
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setStrike: CommandSpec;
    unsetStrike: CommandSpec;
    toggleStrike: CommandSpec;
  }
}
