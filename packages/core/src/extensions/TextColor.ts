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
              return element.style.color?.replace(/['"]+/g, '') || null;
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

          const cmd = commands as Record<
            string,
            (name: string, attrs?: Record<string, unknown>) => boolean
          >;
          return cmd['setMark']?.('textStyle', { color }) ?? false;
        },

      unsetTextColor:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (...args: unknown[]) => boolean>;
          cmd['setMark']?.('textStyle', { color: null });
          cmd['removeEmptyTextStyle']?.();
          return true;
        },
    };
  },
});
