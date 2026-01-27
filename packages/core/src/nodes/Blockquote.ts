/**
 * Blockquote Node
 *
 * Block-level quote container that can hold other blocks.
 * Supports nested blockquotes and markdown-style input rule.
 */

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
    return ['blockquote', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const { name } = this;
    return {
      setBlockquote:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['wrapIn']?.(name) ?? false;
        },
      toggleBlockquote:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (name: string) => boolean>;
          return cmds['toggleWrap']?.(name) ?? false;
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
    const { editor } = this;
    return {
      'Mod-Shift-b': () => {
        return editor?.commands['toggleBlockquote']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      wrappingInputRule(/^\s*>\s$/, nodeType),
    ];
  },
});
