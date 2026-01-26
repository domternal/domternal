/**
 * Paragraph Node
 *
 * The default block-level text container.
 * Contains inline content (text and inline nodes).
 */

import type { Node as NodeClass } from '../Node.js';
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
    const self = this as unknown as NodeClass<ParagraphOptions>;
    return ['p', { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const self = this as unknown as NodeClass<ParagraphOptions>;
    return {
      setParagraph:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['setBlockType']?.(self.name) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<ParagraphOptions>;
    return {
      'Mod-Alt-0': () => {
        const editor = self.editor as { commands: Record<string, () => boolean> } | null;
        return editor?.commands['setParagraph']?.() ?? false;
      },
    };
  },
});
