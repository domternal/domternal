/**
 * HardBreak Node
 *
 * Inline line break element (br).
 * Keyboard shortcuts: Mod-Enter, Shift-Enter
 */

import { Node } from '../Node.js';

export interface HardBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const HardBreak = Node.create<HardBreakOptions>({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'br' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['br', { ...this.options.HTMLAttributes, ...HTMLAttributes }];
  },

  addCommands() {
    const { name } = this;
    return {
      setHardBreak:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<
            string,
            (content: { type: string }) => boolean
          >;
          return cmds['insertContent']?.({ type: name }) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Enter': () => {
        return editor?.commands['setHardBreak']?.() ?? false;
      },
      'Shift-Enter': () => {
        return editor?.commands['setHardBreak']?.() ?? false;
      },
    };
  },
});
