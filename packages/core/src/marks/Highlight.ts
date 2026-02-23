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
 * Default 25-color highlight palette (5 columns x 5 rows).
 * Row 1–2: warm pastels (yellow → pink)
 * Row 3–4: cool pastels (green → purple)
 * Row 5: neutrals
 */
export const DEFAULT_HIGHLIGHT_COLORS: string[] = [
  // Row 1 — Classic warm highlights
  '#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8',
  // Row 2 — Lighter warm pastels
  '#fef9c3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3',
  // Row 3 — Cool highlights
  '#a7f3d0', '#99f6e4', '#a5f3fc', '#bfdbfe', '#c4b5fd',
  // Row 4 — Lighter cool pastels
  '#d1fae5', '#ccfbf1', '#cffafe', '#dbeafe', '#ede9fe',
  // Row 5 — Neutrals
  '#e5e7eb', '#d1d5db', '#f3f4f6', '#fafafa', '#ffffff',
];

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
   * @default true
   */
  multicolor: boolean;
  /**
   * List of color values for the highlight palette.
   * Pass an empty array to get a simple toggle button instead of a dropdown.
   */
  colors: string[];
  /**
   * Number of columns in the palette grid.
   * @default 5
   */
  columns: number;
}

/**
 * Highlight mark for text formatting
 */
export const Highlight = Mark.create<HighlightOptions>({
  name: 'highlight',

  addOptions() {
    return {
      HTMLAttributes: {},
      multicolor: true,
      colors: DEFAULT_HIGHLIGHT_COLORS,
      columns: 5,
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
    if (this.options.colors.length === 0) {
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
    }

    return [
      {
        type: 'dropdown',
        name: 'highlight',
        icon: 'highlighterCircle',
        label: 'Highlight',
        group: 'format',
        priority: 150,
        layout: 'grid',
        gridColumns: this.options.columns,
        items: [
          {
            type: 'button' as const,
            name: 'unsetHighlight',
            command: 'unsetHighlight',
            icon: 'prohibit',
            label: 'No highlight',
          },
          ...this.options.colors.map((color, i) => ({
            type: 'button' as const,
            name: `highlight-${color}`,
            command: 'setHighlight',
            commandArgs: [{ color }],
            isActive: { name: 'highlight', attributes: { color } },
            icon: '',
            label: color,
            color,
            priority: 200 - i,
          })),
        ],
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
