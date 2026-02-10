/**
 * Paragraph Node
 *
 * The default block-level text container.
 * Contains inline content (text and inline nodes).
 */

import { Node } from '../Node.js';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setParagraph: CommandSpec;
  }
}

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
          return commands.setBlockType(name);
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
