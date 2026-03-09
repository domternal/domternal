/**
 * TextColor Extension
 *
 * Adds text color styling via the TextStyle mark.
 * Requires TextStyle mark to be enabled.
 *
 * @example
 * ```ts
 * import { TextStyle, TextColor } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     TextStyle,
 *     TextColor, // uses the default 80-color palette
 *   ],
 * });
 *
 * editor.commands.setTextColor('#ff0000');
 * editor.commands.unsetTextColor();
 * ```
 */
import { Extension } from '../Extension.js';
import { normalizeColor } from '../helpers/normalizeColor.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setTextColor: CommandSpec<[color: string]>;
    unsetTextColor: CommandSpec;
  }
}

/**
 * Default 25-color palette (5 columns x 5 rows).
 * Row 1: neutrals (black → white)
 * Row 2: pastel tints
 * Row 3: vivid / saturated
 * Row 4: medium shades
 * Row 5: dark shades
 *
 * Columns: Red, Orange/Yellow, Green, Blue, Purple
 */
export const DEFAULT_TEXT_COLORS: string[] = [
  // Row 1 — Neutrals
  '#000000', '#595959', '#a6a6a6', '#d9d9d9', '#ffffff',
  // Row 2 — Pastel
  '#ffc9c9', '#fff3bf', '#b2f2bb', '#a5d8ff', '#d0bfff',
  // Row 3 — Vivid
  '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8',
  // Row 4 — Medium
  '#ff6b6b', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa',
  // Row 5 — Dark
  '#c92a2a', '#e67700', '#2b8a3e', '#1864ab', '#6741d9',
];

export interface TextColorOptions {
  /**
   * List of color values for the palette.
   * Defaults to a 25-color grid (5 cols x 5 rows).
   * Pass a custom array to restrict to specific colors.
   */
  colors: string[];

  /**
   * Number of columns in the palette grid.
   * @default 5
   */
  columns: number;
}

export const TextColor = Extension.create<TextColorOptions>({
  name: 'textColor',

  addOptions() {
    return {
      colors: DEFAULT_TEXT_COLORS,
      columns: 5,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const raw = element.style.color.replace(/['"]+/g, '');
              return raw ? normalizeColor(raw) : null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const color = attributes['color'] as string | null;
              if (!color) return null;

              return { style: `color: ${color}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ commands }) => {
          return commands.setMark('textStyle', { color });
        },

      unsetTextColor:
        () =>
        ({ commands }) => {
          if (!commands.setMark('textStyle', { color: null })) return false;
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    if (this.options.colors.length === 0) return [];

    return [
      {
        type: 'dropdown',
        name: 'textColor',
        icon: 'textAUnderline',
        label: 'Text Color',
        group: 'textStyle',
        priority: 200,
        layout: 'grid',
        gridColumns: this.options.columns,
        defaultIndicatorColor: '#000000',
        items: [
          {
            type: 'button' as const,
            name: 'unsetTextColor',
            command: 'unsetTextColor',
            icon: 'prohibit',
            label: 'Default',
          },
          ...this.options.colors.map((color, i) => ({
            type: 'button' as const,
            name: `textColor-${color}`,
            command: 'setTextColor',
            commandArgs: [color],
            isActive: { name: 'textStyle', attributes: { color } },
            icon: '',
            label: color,
            color,
            priority: 200 - i,
          })),
        ],
      },
    ];
  },
});
