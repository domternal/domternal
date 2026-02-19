/**
 * TextAlign Extension
 *
 * Adds text alignment capabilities to specified node types.
 * Uses addGlobalAttributes to inject textAlign attribute into nodes.
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setTextAlign: CommandSpec<[alignment: string]>;
    unsetTextAlign: CommandSpec;
  }
}

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

          return this.options.types
            .map((type) => commands.updateAttributes(type, { textAlign: alignment }))
            .some(Boolean);
        },

      unsetTextAlign:
        () =>
        ({ commands }) => {
          return this.options.types
            .map((type) => commands.resetAttributes(type, 'textAlign'))
            .some(Boolean);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-l': () =>
        this.editor?.commands.setTextAlign('left') ?? false,
      'Mod-Shift-e': () =>
        this.editor?.commands.setTextAlign('center') ?? false,
      'Mod-Shift-r': () =>
        this.editor?.commands.setTextAlign('right') ?? false,
      'Mod-Shift-j': () =>
        this.editor?.commands.setTextAlign('justify') ?? false,
    };
  },

  addToolbarItems(): ToolbarItem[] {
    const types = this.options.types;
    const makeActive = (alignment: string): { name: string; attributes: Record<string, unknown> }[] =>
      types.map((t) => ({ name: t, attributes: { textAlign: alignment } }));

    return [
      {
        type: 'dropdown',
        name: 'textAlign',
        icon: 'textAlignLeft',
        label: 'Text Alignment',
        group: 'alignment',
        priority: 200,
        items: [
          {
            type: 'button',
            name: 'alignLeft',
            command: 'setTextAlign',
            commandArgs: ['left'],
            isActive: makeActive('left'),
            icon: 'textAlignLeft',
            label: 'Align Left',
            shortcut: 'Mod-Shift-L',
          },
          {
            type: 'button',
            name: 'alignCenter',
            command: 'setTextAlign',
            commandArgs: ['center'],
            isActive: makeActive('center'),
            icon: 'textAlignCenter',
            label: 'Align Center',
            shortcut: 'Mod-Shift-E',
          },
          {
            type: 'button',
            name: 'alignRight',
            command: 'setTextAlign',
            commandArgs: ['right'],
            isActive: makeActive('right'),
            icon: 'textAlignRight',
            label: 'Align Right',
            shortcut: 'Mod-Shift-R',
          },
          {
            type: 'button',
            name: 'alignJustify',
            command: 'setTextAlign',
            commandArgs: ['justify'],
            isActive: makeActive('justify'),
            icon: 'textAlignJustify',
            label: 'Justify',
            shortcut: 'Mod-Shift-J',
          },
          {
            type: 'button',
            name: 'unsetAlign',
            command: 'unsetTextAlign',
            icon: 'textAlignLeft',
            label: 'Default',
          },
        ],
      },
    ];
  },
});
