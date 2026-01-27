/**
 * BulletList Node
 *
 * Block-level unordered list container.
 * Supports markdown-style input rules and keyboard shortcuts.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';

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
    const self = this as unknown as NodeClass<BulletListOptions>;
    return ['ul', { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    const self = this as unknown as NodeClass<BulletListOptions>;
    return {
      toggleBulletList:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (listName: string, itemName: string) => boolean>;
          return cmds['toggleList']?.(self.name, self.options.itemTypeName) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<BulletListOptions>;
    return {
      'Mod-Shift-8': () => {
        const editor = self.editor as { commands: Record<string, () => boolean> } | null;
        return editor?.commands['toggleBulletList']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const self = this as unknown as NodeClass<BulletListOptions>;
    const nodeType = self.nodeType;

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
