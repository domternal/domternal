/**
 * FontSize Extension
 *
 * Adds font size styling via the TextStyle mark.
 * Requires TextStyle mark to be enabled.
 *
 * @example
 * ```ts
 * import { TextStyle, FontSize } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     TextStyle,
 *     FontSize.configure({
 *       fontSizes: ['12px', '14px', '16px', '18px', '24px', '32px'],
 *     }),
 *   ],
 * });
 *
 * editor.commands.setFontSize('16px');
 * editor.commands.unsetFontSize();
 * ```
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setFontSize: CommandSpec<[fontSize: string]>;
    unsetFontSize: CommandSpec;
  }
}

export interface FontSizeOptions {
  /**
   * List of allowed font sizes (e.g., ['12px', '14px', '16px']).
   * If empty, all sizes are allowed.
   * @default []
   */
  fontSizes: string[];
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return {
      fontSizes: [],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              return element.style.fontSize || null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const fontSize = attributes['fontSize'] as string | null;
              if (!fontSize) return null;

              // Validate size if fontSizes list is provided
              if (
                this.options.fontSizes.length > 0 &&
                !this.options.fontSizes.includes(fontSize)
              ) {
                return null;
              }

              return { style: `font-size: ${fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ commands }) => {
          // Validate size if fontSizes list is provided
          if (
            this.options.fontSizes.length > 0 &&
            !this.options.fontSizes.includes(fontSize)
          ) {
            return false;
          }

          return commands.setMark('textStyle', { fontSize });
        },

      unsetFontSize:
        () =>
        ({ commands }) => {
          commands.setMark('textStyle', { fontSize: null });
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },
});
