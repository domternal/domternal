/**
 * Paragraph Node
 *
 * The default block-level text container.
 * Contains inline content (text and inline nodes).
 */

import { Node } from '../Node.js';

export interface ParagraphOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const Paragraph = Node.create<ParagraphOptions>({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'p' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const { name } = this;
    return {
      setParagraph:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['setBlockType']?.(name) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Alt-0': () => {
        return editor?.commands['setParagraph']?.() ?? false;
      },
    };
  },
});
