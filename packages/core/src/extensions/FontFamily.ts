import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
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
import { TextStyle } from '../marks/TextStyle.js';
import { isBlankStyleValue, isSafeCssValue } from '../helpers/isSafeCssValue.js';

/**
 * The CSS value of a stored font family list, or null when it is not safe to
 * write. Quotes are dropped, as parsing pasted HTML does, and each family
 * name with a space is quoted again, so `"Times New Roman", serif` becomes
 * `'Times New Roman', serif`. A value with a function, such as a `var()`, is
 * written as it is.
 */
function fontFamilyValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const families = value.replace(/['"]+/g, '');
  if (!isSafeCssValue(families)) return null;
  if (families.includes('(')) return families.trim();
  const names = families.split(',').map(name => name.trim());
  if (names.some(name => name === '')) return null;
  return names.map(name => (/\s/.test(name) ? `'${name}'` : name)).join(', ');
}

declare module '@domternal/core' {
  interface RawCommands {
    setFontFamily: CommandSpec<[fontFamily: string]>;
    unsetFontFamily: CommandSpec;
  }
}

export interface FontFamilyOptions {
  /**
   * List of font families shown in the toolbar dropdown.
   * Any font family is accepted from pasted HTML regardless of this list.
   * @default ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Palatino Linotype', 'Courier New']
   */
  fontFamilies: string[];
}

export const FontFamily = Extension.create<FontFamilyOptions>({
  name: 'fontFamily',

  dependencies: ['textStyle'],

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
              // A stored value that could add a declaration or load a
              // resource is not written; the document keeps it.
              const value = fontFamilyValue(attributes['fontFamily']);
              return value === null ? null : { style: `font-family: ${value}` };
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
          // An empty value, such as a "Default" option, clears the family.
          if (isBlankStyleValue(fontFamily)) return commands.unsetFontFamily();
          if (fontFamilyValue(fontFamily) === null) return false;
          return commands.setMark('textStyle', { fontFamily });
        },

      unsetFontFamily:
        () =>
        ({ commands }) => {
          if (!commands.setMark('textStyle', { fontFamily: null })) return false;
          commands.removeEmptyTextStyle();
          return true;
        },
    };
  },

  addExtensions() {
    return [TextStyle];
  },

  addToolbarItems(): ToolbarItem[] {
    if (this.options.fontFamilies.length === 0) return [];

    return [
      {
        type: 'dropdown',
        name: 'fontFamily',
        icon: 'textAa',
        ...localizedLabel(this.editor?.i18n, coreMessages.fontFamily),
        group: 'textStyle',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupTextStyle),
        priority: 150,
        displayMode: 'text',
        dynamicLabel: true,
        computedStyleProperty: 'font-family',
        items: this.options.fontFamilies.map((font, i) => {
          const value = fontFamilyValue(font);
          return {
            type: 'button' as const,
            name: `fontFamily-${font}`,
            command: 'setFontFamily',
            commandArgs: [font],
            isActive: { name: 'textStyle', attributes: { fontFamily: font } },
            icon: 'textAa',
            label: font,
            ...(value !== null && { style: `font-family: ${value}` }),
            priority: 200 - i,
          };
        }),
      },
    ];
  },
});
