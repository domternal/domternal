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
      // Parse <mark> elements as textStyle (Highlight extension adds backgroundColor attribute)
      { tag: 'mark' },
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
        ({ state, tr, dispatch }) => {
          const { from, to, empty } = tr.selection;
          const markType = this.markType;

          if (!markType) return false;

          // For empty selection, check stored marks — setMark on empty selection
          // only modifies stored marks, so the document still has the old mark.
          // An empty textStyle stored mark (all attrs null) would cause future
          // typed text to get a meaningless <span> wrapper.
          if (empty) {
            const storedMarks = tr.storedMarks ?? state.storedMarks;
            if (storedMarks) {
              const storedTextStyle = storedMarks.find(m => m.type === markType);
              if (storedTextStyle) {
                const hasNonNullAttr = Object.values(storedTextStyle.attrs).some(
                  (val) => val !== null && val !== undefined
                );
                if (!hasNonNullAttr) {
                  if (dispatch) {
                    tr.removeStoredMark(markType);
                    dispatch(tr);
                  }
                  return true;
                }
              }
            }
            return false;
          }

          // Non-empty selection: check document marks
          let hasEmptyTextStyle = false;

          tr.doc.nodesBetween(from, to, (node) => {
            const textStyleMark = node.marks.find(
              (mark) => mark.type.name === this.name
            );
            if (textStyleMark) {
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
            // Only remove textStyle from nodes where ALL attributes are null.
            // A blanket tr.removeMark(from, to) would also strip marks that
            // have active attributes (e.g. color) on adjacent nodes.
            tr.doc.nodesBetween(from, to, (node, pos) => {
              const mark = node.marks.find(m => m.type === markType);
              if (mark) {
                const hasActiveAttr = Object.values(mark.attrs).some(
                  v => v !== null && v !== undefined,
                );
                if (!hasActiveAttr) {
                  const nodeFrom = Math.max(pos, from);
                  const nodeTo = Math.min(pos + node.nodeSize, to);
                  tr.removeMark(nodeFrom, nodeTo, markType);
                }
              }
            });
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
