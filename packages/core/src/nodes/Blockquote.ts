/**
 * Blockquote Node
 *
 * Block-level quote container that can hold other blocks.
 * Supports nested blockquotes and markdown-style input rule.
 */

import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    setBlockquote: CommandSpec;
    toggleBlockquote: CommandSpec;
    unsetBlockquote: CommandSpec;
  }
}

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
          return commands.wrapIn(name);
        },
      toggleBlockquote:
        () =>
        ({ commands }) => {
          return commands.toggleWrap(name);
        },
      unsetBlockquote:
        () =>
        ({ commands }) => {
          return commands.lift();
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

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'blockquote',
        command: 'toggleBlockquote',
        isActive: 'blockquote',
        icon: 'quotes',
        label: 'Blockquote',
        shortcut: 'Mod-Shift-B',
        group: 'blocks',
        priority: 150,
      },
    ];
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
