/**
 * TextStyle Mark
 *
 * A "carrier mark" for inline text styling. This mark itself has no attributes,
 * but other extensions (TextColor, FontFamily, FontSize) can inject attributes
 * into it via addGlobalAttributes.
 *
 * @example
 * ```ts
 * import { TextStyle, TextColor, FontFamily } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     TextStyle,
 *     TextColor,
 *     FontFamily.configure({ fontFamilies: ['Arial', 'Times New Roman'] }),
 *   ],
 * });
 *
 * editor.commands.setTextColor('#ff0000');
 * editor.commands.setFontFamily('Arial');
 * ```
 */
import { Mark } from '../Mark.js';

export interface TextStyleOptions {
  /**
   * HTML attributes to add to the rendered element.
   * @default {}
   */
  HTMLAttributes: Record<string, unknown>;
}

export const TextStyle = Mark.create<TextStyleOptions>({
  name: 'textStyle',

  // Lower priority so it renders after other marks
  priority: 101,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (element) => {
          // Only parse spans that have style attributes
          if (typeof element === 'string') return false;
          const hasStyles = element.hasAttribute('style');
          if (!hasStyles) return false;
          return {};
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    return {
      setTextStyle:
        (attributes: Record<string, unknown>) =>
        ({ commands }) => commands.setMark('textStyle', attributes),

      removeTextStyle:
        () =>
        ({ commands }) => commands.unsetMark('textStyle'),

      removeEmptyTextStyle:
        () =>
        ({ state, dispatch }) => {
          // Check if textStyle mark exists with no meaningful attributes
          const { from, to } = state.selection;
          const markType = this.markType;

          if (!markType) return false;

          let hasEmptyTextStyle = false;

          state.doc.nodesBetween(from, to, (node) => {
            const textStyleMark = node.marks.find(
              (mark) => mark.type.name === this.name
            );
            if (textStyleMark) {
              // Check if all attribute values are null/undefined
              const hasNonNullAttr = Object.values(textStyleMark.attrs).some(
                (val) => val !== null && val !== undefined
              );
              if (!hasNonNullAttr) {
                hasEmptyTextStyle = true;
              }
            }
          });

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!hasEmptyTextStyle) return false;

          if (dispatch) {
            const tr = state.tr.removeMark(from, to, markType);
            dispatch(tr);
          }

          return true;
        },
    };
  },
});

declare module '../types/Commands.js' {
  interface RawCommands {
    setTextStyle: CommandSpec<[attributes: Record<string, unknown>]>;
    removeTextStyle: CommandSpec;
    removeEmptyTextStyle: CommandSpec;
  }
}
