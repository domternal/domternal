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
import type { ToolbarButton, ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setFontSize: CommandSpec<[fontSize: string]>;
    unsetFontSize: CommandSpec;
  }
}

export interface FontSizeOptions {
  /**
   * List of font sizes shown in the toolbar dropdown.
   * Any font size is accepted from pasted HTML regardless of this list.
   * @default ['12px', '14px', '16px', '18px', '24px', '32px']
   */
  fontSizes: string[];

  /**
   * Show an unset/reset button at the end of the dropdown.
   * @default false
   */
  showReset: boolean;
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return {
      fontSizes: ['12px', '14px', '16px', '18px', '24px', '32px'],
      showReset: false,
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

  addToolbarItems(): ToolbarItem[] {
    if (this.options.fontSizes.length === 0) return [];

    const sizes = this.options.fontSizes.includes('16px')
      ? this.options.fontSizes
      : ['16px', ...this.options.fontSizes];

    const items: ToolbarButton[] = sizes.map((size, i) => ({
      type: 'button' as const,
      name: `fontSize-${size}`,
      command: 'setFontSize',
      commandArgs: [size],
      isActive: { name: 'textStyle', attributes: { fontSize: size } },
      icon: 'textSize',
      label: size,
      priority: 200 - i,
    }));

    if (this.options.showReset) {
      items.push({
        type: 'button' as const,
        name: 'unsetFontSize',
        command: 'unsetFontSize',
        icon: 'textSize',
        label: '–',
        priority: 0,
      });
    }

    return [
      {
        type: 'dropdown',
        name: 'fontSize',
        icon: 'textSize',
        label: 'Font Size',
        group: 'textStyle',
        priority: 100,
        displayMode: 'text',
        dynamicLabel: true,
        dynamicLabelFallback: '16px',
        computedStyleProperty: 'font-size',
        items,
      },
    ];
  },
});
