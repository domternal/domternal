/**
 * Blockquote Node
 *
 * Block-level quote container that can hold other blocks.
 * Supports nested blockquotes and markdown-style input rule.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';

export interface BlockquoteOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const Blockquote = Node.create<BlockquoteOptions>({
  name: 'blockquote',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote' }];
  },

  renderHTML({ HTMLAttributes }) {
    const self = this as unknown as NodeClass<BlockquoteOptions>;
    return ['blockquote', { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const self = this as unknown as NodeClass<BlockquoteOptions>;
    return {
      setBlockquote:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['wrapIn']?.(self.name) ?? false;
        },
      toggleBlockquote:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['toggleWrap']?.(self.name) ?? false;
        },
      unsetBlockquote:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, () => boolean>;
          return cmds['lift']?.() ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<BlockquoteOptions>;
    return {
      'Mod-Shift-b': () => {
        const editor = self.editor as { commands: Record<string, () => boolean> } | null;
        return editor?.commands['toggleBlockquote']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const self = this as unknown as NodeClass<BlockquoteOptions>;
    const nodeType = self.nodeType;

    if (!nodeType) {
      return [];
    }

    return [
      wrappingInputRule(/^\s*>\s$/, nodeType),
    ];
  },
});
