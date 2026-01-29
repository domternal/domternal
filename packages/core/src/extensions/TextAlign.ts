/**
 * TextAlign Extension
 *
 * Adds text alignment capabilities to specified node types.
 * Uses addGlobalAttributes to inject textAlign attribute into nodes.
 */
import { Extension } from '../Extension.js';

export interface TextAlignOptions {
  /**
   * Node types that can have text alignment.
   * @default ['heading', 'paragraph']
   */
  types: string[];

  /**
   * Allowed alignment values.
   * @default ['left', 'center', 'right', 'justify']
   */
  alignments: string[];

  /**
   * Default alignment value.
   * @default 'left'
   */
  defaultAlignment: string;
}

export const TextAlign = Extension.create<TextAlignOptions>({
  name: 'textAlign',

  addOptions() {
    return {
      types: ['heading', 'paragraph'],
      alignments: ['left', 'center', 'right', 'justify'],
      defaultAlignment: 'left',
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          textAlign: {
            default: this.options.defaultAlignment,
            parseHTML: (element: HTMLElement) =>
              element.style.textAlign || this.options.defaultAlignment,
            renderHTML: (attributes: Record<string, unknown>) => {
              const textAlign = attributes['textAlign'] as string;
              if (textAlign === this.options.defaultAlignment) {
                return null;
              }
              return { style: `text-align: ${textAlign}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (alignment: string) =>
        ({ commands }) => {
          if (!this.options.alignments.includes(alignment)) {
            return false;
          }

          const cmds = commands as Record<
            string,
            (type: string, attrs: Record<string, unknown>) => boolean
          >;

          return this.options.types.every((type) =>
            cmds['updateAttributes']?.(type, { textAlign: alignment })
          );
        },

      unsetTextAlign:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<
            string,
            (type: string, attr: string) => boolean
          >;

          return this.options.types.every((type) =>
            cmds['resetAttributes']?.(type, 'textAlign')
          );
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () =>
        this.editor?.commands['setTextAlign']?.('left') ?? false,
      'Mod-Shift-e': () =>
        this.editor?.commands['setTextAlign']?.('center') ?? false,
      'Mod-Shift-r': () =>
        this.editor?.commands['setTextAlign']?.('right') ?? false,
      'Mod-Shift-j': () =>
        this.editor?.commands['setTextAlign']?.('justify') ?? false,
    };
  },
});
