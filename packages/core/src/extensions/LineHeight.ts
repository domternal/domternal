/**
 * LineHeight Extension
 *
 * Adds line height styling to block nodes.
 *
 * @example
 * ```ts
 * import { LineHeight } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     LineHeight.configure({
 *       types: ['paragraph', 'heading'],
 *       lineHeights: ['1', '1.5', '2'],
 *     }),
 *   ],
 * });
 *
 * editor.commands.setLineHeight('1.5');
 * editor.commands.unsetLineHeight();
 * ```
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setLineHeight: CommandSpec<[lineHeight: string]>;
    unsetLineHeight: CommandSpec;
  }
}

export interface LineHeightOptions {
  /**
   * Node types that should support line height.
   * @default ['paragraph', 'heading']
   */
  types: string[];

  /**
   * List of allowed line heights (e.g., ['1', '1.5', '2']).
   * If empty, all values are allowed.
   * @default []
   */
  lineHeights: string[];

  /**
   * Default line height value.
   * @default null
   */
  defaultLineHeight: string | null;
}

export const LineHeight = Extension.create<LineHeightOptions>({
  name: 'lineHeight',

  addOptions() {
    return {
      types: ['paragraph', 'heading'],
      lineHeights: [],
      defaultLineHeight: null,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: this.options.defaultLineHeight,
            parseHTML: (element: HTMLElement) => {
              return element.style.lineHeight || this.options.defaultLineHeight;
            },
            renderHTML: (attributes: Record<string, unknown>) => {
              const lineHeight = attributes['lineHeight'] as string | null;

              // Don't render if it's the default
              if (!lineHeight || lineHeight === this.options.defaultLineHeight) {
                return null;
              }

              // Validate if lineHeights list is provided
              if (
                this.options.lineHeights.length > 0 &&
                !this.options.lineHeights.includes(lineHeight)
              ) {
                return null;
              }

              return { style: `line-height: ${lineHeight}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ commands }) => {
          // Validate if lineHeights list is provided
          if (
            this.options.lineHeights.length > 0 &&
            !this.options.lineHeights.includes(lineHeight)
          ) {
            return false;
          }

          return this.options.types
            .map((type) => commands.updateAttributes(type, { lineHeight }))
            .some(Boolean);
        },

      unsetLineHeight:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type) => commands.resetAttributes(type, 'lineHeight'))
            .some(Boolean);
        },
    };
  },
});
