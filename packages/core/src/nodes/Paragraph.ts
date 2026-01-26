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
    return {
      setParagraph:
        () =>
        ({ commands }) => {
          return commands.setBlockType(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor!.commands.setParagraph(),
    };
  },
});
