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
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setFontFamily: CommandSpec<[fontFamily: string]>;
    unsetFontFamily: CommandSpec;
  }
}

export interface FontFamilyOptions {
  /**
   * List of allowed font families.
   * @default ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Palatino Linotype', 'Courier New']
   */
  fontFamilies: string[];
}

export const FontFamily = Extension.create<FontFamilyOptions>({
  name: 'fontFamily',

  addOptions() {
    return {
      fontFamilies: ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Palatino Linotype', 'Courier New'],
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

              const value = fontFamily.includes(' ') ? `'${fontFamily}'` : fontFamily;
              return { style: `font-family: ${value}` };
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

          return commands.setMark('textStyle', { fontFamily });
        },

      unsetFontFamily:
        () =>
        ({ commands }) => {
          commands.setMark('textStyle', { fontFamily: null });
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    if (this.options.fontFamilies.length === 0) return [];

    return [
      {
        type: 'dropdown',
        name: 'fontFamily',
        icon: 'textAa',
        label: 'Font Family',
        group: 'textStyle',
        priority: 150,
        displayMode: 'text',
        dynamicLabel: true,
        items: this.options.fontFamilies.map((font, i) => ({
          type: 'button' as const,
          name: `fontFamily-${font}`,
          command: 'setFontFamily',
          commandArgs: [font],
          isActive: { name: 'textStyle', attributes: { fontFamily: font } },
          icon: 'textAa',
          label: font,
          style: `font-family: ${font.includes(' ') ? `'${font}'` : font}`,
          priority: 200 - i,
        })),
      },
    ];
  },
});
