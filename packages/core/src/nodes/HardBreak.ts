/**
 * HardBreak Node
 *
 * Inline line break element (br).
 * Keyboard shortcuts: Mod-Enter, Shift-Enter
 */

import type { Node as NodeClass } from '../Node.js';
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
    const self = this as unknown as NodeClass<HardBreakOptions>;
    return ['br', { ...self.options.HTMLAttributes, ...HTMLAttributes }];
  },

  addCommands() {
    const self = this as unknown as NodeClass<HardBreakOptions>;
    return {
      setHardBreak:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<
            string,
            (content: { type: string }) => boolean
          >;
          return cmds['insertContent']?.({ type: self.name }) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<HardBreakOptions>;
    return {
      'Mod-Enter': () => {
        const editor = self.editor as {
          commands: Record<string, () => boolean>;
        } | null;
        return editor?.commands['setHardBreak']?.() ?? false;
      },
      'Shift-Enter': () => {
        const editor = self.editor as {
          commands: Record<string, () => boolean>;
        } | null;
        return editor?.commands['setHardBreak']?.() ?? false;
      },
    };
  },
});
