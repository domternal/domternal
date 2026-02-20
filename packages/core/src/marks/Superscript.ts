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
import type { ToolbarItem } from '../types/Toolbar.js';

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

  // Mutual exclusion handled in toggle commands (not schema)
  // so can() dry-run works correctly for toolbar disabled state
  excludes: '',

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
      'Mod-.': () => this.editor?.commands['toggleSuperscript']?.() ?? false,
    };
  },

  addCommands() {
    return {
      setSuperscript:
        () =>
        ({ commands }) => commands.setMark('superscript'),
      unsetSuperscript:
        () =>
        ({ commands }) => commands.unsetMark('superscript'),
      toggleSuperscript:
        () =>
        ({ commands }) => {
          commands.unsetMark('subscript');
          return commands.toggleMark('superscript');
        },
    };
  },
  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'superscript',
        command: 'toggleSuperscript',
        isActive: 'superscript',
        icon: 'textSuperscript',
        label: 'Superscript',
        shortcut: 'Mod-.',
        group: 'format',
        priority: 130,
      },
    ];
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setSuperscript: CommandSpec;
    unsetSuperscript: CommandSpec;
    toggleSuperscript: CommandSpec;
  }
}
