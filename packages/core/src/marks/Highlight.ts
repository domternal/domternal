/**
 * Highlight Mark
 *
 * Applies highlight/background color formatting to text.
 *
 * @example
 * ```ts
 * import { Highlight } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Highlight],
 * });
 *
 * // Toggle highlight with keyboard shortcut: Mod-Shift-h
 * // Or use input rule: ==text==
 * ```
 */
import { Mark } from '../Mark.js';
import { markInputRule, markInputRulePatterns } from '../helpers/markInputRule.js';
import type { ToolbarItem } from '../types/Toolbar.js';

/**
 * Options for the Highlight mark
 */
export interface HighlightOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
  /**
   * Whether to support multiple colors
   * @default false
   */
  multicolor: boolean;
}

/**
 * Highlight mark for text formatting
 */
export const Highlight = Mark.create<HighlightOptions>({
  name: 'highlight',

  addOptions() {
    return {
      HTMLAttributes: {},
      multicolor: false,
    };
  },

  addAttributes() {
    if (!this.options.multicolor) {
      return {};
    }

    return {
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-color') ??
          element.style.backgroundColor.replace(/['"]/g, ''),
        renderHTML: (attributes) => {
          const color = attributes['color'];
          if (!color || typeof color !== 'string') {
            return {};
          }

          return {
            'data-color': color,
            style: `background-color: ${color}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'mark' },
      {
        style: 'background-color',
        getAttrs: (value) => {
          if (typeof value !== 'string') return false;
          return value ? {} : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor?.commands['toggleMark']?.('highlight') ?? false,
      'Mod-Shift-H': () => this.editor?.commands['toggleMark']?.('highlight') ?? false,
    };
  },

  addCommands() {
    return {
      setHighlight:
        (attributes?: { color?: string }) =>
        ({ commands }) => commands.setMark('highlight', attributes),
      unsetHighlight:
        () =>
        ({ commands }) => commands.unsetMark('highlight'),
      toggleHighlight:
        (attributes?: { color?: string }) =>
        ({ commands }) => commands.toggleMark('highlight', attributes),
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'highlight',
        command: 'toggleHighlight',
        isActive: 'highlight',
        icon: 'highlighterCircle',
        label: 'Highlight',
        shortcut: 'Mod-Shift-H',
        group: 'format',
        priority: 150,
      },
    ];
  },

  addInputRules() {
    const markType = this.markType;
    if (!markType) return [];

    return [
      // ==text==
      markInputRule({
        find: markInputRulePatterns.highlight,
        type: markType,
      }),
    ];
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setHighlight: CommandSpec<[attributes?: { color?: string }]>;
    unsetHighlight: CommandSpec;
    toggleHighlight: CommandSpec<[attributes?: { color?: string }]>;
  }
}
