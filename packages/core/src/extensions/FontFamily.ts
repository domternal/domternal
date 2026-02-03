/**
 * FontFamily Extension
 *
 * Adds font family styling via the TextStyle mark.
 * Requires TextStyle mark to be enabled.
 *
 * @example
 * ```ts
 * import { TextStyle, FontFamily } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     TextStyle,
 *     FontFamily.configure({
 *       fontFamilies: ['Arial', 'Times New Roman', 'Courier New'],
 *     }),
 *   ],
 * });
 *
 * editor.commands.setFontFamily('Arial');
 * editor.commands.unsetFontFamily();
 * ```
 */
import { Extension } from '../Extension.js';

export interface FontFamilyOptions {
  /**
   * List of allowed font families. If empty, all fonts are allowed.
   * @default []
   */
  fontFamilies: string[];
}

export const FontFamily = Extension.create<FontFamilyOptions>({
  name: 'fontFamily',

  addOptions() {
    return {
      fontFamilies: [],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontFamily: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              return element.style.fontFamily.replace(/['"]+/g, '') || null;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const fontFamily = attributes['fontFamily'] as string | null;
              if (!fontFamily) return null;

              // Validate font if fontFamilies list is provided
              if (
                this.options.fontFamilies.length > 0 &&
                !this.options.fontFamilies.includes(fontFamily)
              ) {
                return null;
              }

              return { style: `font-family: ${fontFamily}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontFamily:
        (fontFamily: string) =>
        ({ commands }) => {
          // Validate font if fontFamilies list is provided
          if (
            this.options.fontFamilies.length > 0 &&
            !this.options.fontFamilies.includes(fontFamily)
          ) {
            return false;
          }

          const cmd = commands as Record<
            string,
            (name: string, attrs?: Record<string, unknown>) => boolean
          >;
          return cmd['setMark']?.('textStyle', { fontFamily }) ?? false;
        },

      unsetFontFamily:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (...args: unknown[]) => boolean>;
          cmd['setMark']?.('textStyle', { fontFamily: null });
          cmd['removeEmptyTextStyle']?.();
          return true;
        },
    };
  },
});
