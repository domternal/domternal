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
 *     TextColor.configure({
 *       colors: ['#ff0000', '#00ff00', '#0000ff'], // Optional: restrict to these colors
 *     }),
 *   ],
 * });
 *
 * editor.commands.setTextColor('#ff0000');
 * editor.commands.unsetTextColor();
 * ```
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';

/**
 * Normalizes browser-computed color values (rgb/rgba) to hex format.
 * Browsers convert hex colors to rgb() in element.style, causing
 * isActive mismatches when comparing stored values after HTML re-parsing.
 */
function normalizeColor(color: string): string {
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgbMatch?.[1] && rgbMatch[2] && rgbMatch[3]) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}

declare module '../types/Commands.js' {
  interface RawCommands {
    setTextColor: CommandSpec<[color: string]>;
    unsetTextColor: CommandSpec;
  }
}

export interface TextColorOptions {
  /**
   * List of allowed color values. If empty, all colors are allowed.
   * @default []
   */
  colors: string[];
}

export const TextColor = Extension.create<TextColorOptions>({
  name: 'textColor',

  addOptions() {
    return {
      colors: [],
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

              // Validate color if colors list is provided
              if (
                this.options.colors.length > 0 &&
                !this.options.colors.includes(color)
              ) {
                return null;
              }

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
          // Validate color if colors list is provided
          if (
            this.options.colors.length > 0 &&
            !this.options.colors.includes(color)
          ) {
            return false;
          }

          return commands.setMark('textStyle', { color });
        },

      unsetTextColor:
        () =>
        ({ commands }) => {
          commands.setMark('textStyle', { color: null });
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },
});
