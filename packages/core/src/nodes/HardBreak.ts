/**
 * HardBreak Node
 *
 * Inline line break element (br).
 * Keyboard shortcuts: Mod-Enter, Shift-Enter
 */

import { Node } from '../Node.js';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setHardBreak: CommandSpec;
  }
}

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
          return commands.insertContent({ type: name });
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
