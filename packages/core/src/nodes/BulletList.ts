/**
 * BulletList Node
 *
 * Block-level unordered list container.
 * Supports markdown-style input rules and keyboard shortcuts.
 */

import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';
import type { CommandSpec } from '../types/Commands.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    toggleBulletList: CommandSpec;
  }
}

export interface BulletListOptions {
  HTMLAttributes: Record<string, unknown>;
  itemTypeName: string;
}

export const BulletList = Node.create<BulletListOptions>({
  name: 'bulletList',
  group: 'block list',
  content: 'listItem+',

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: 'listItem',
    };
  },

  parseHTML() {
    return [{ tag: 'ul' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const { name, options } = this;
    return {
      toggleBulletList:
        () =>
        ({ commands }) => {
          return commands.toggleList(name, options.itemTypeName);
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-8': () => {
        return editor?.commands['toggleBulletList']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      // - item
      wrappingInputRule(/^\s*[-]\s$/, nodeType),
      // * item
      wrappingInputRule(/^\s*[*]\s$/, nodeType),
      // + item
      wrappingInputRule(/^\s*[+]\s$/, nodeType),
    ];
  },
});
