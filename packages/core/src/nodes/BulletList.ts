/**
 * BulletList Node
 *
 * Block-level unordered list container.
 * Supports markdown-style input rules and keyboard shortcuts.
 */

import { Node } from '../Node.js';
import { wrappingInputRule, notInsideList } from '../helpers/wrappingInputRule.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';
import type { FloatingMenuItem } from '../types/FloatingMenu.js';
import { ListItem } from './ListItem.js';

declare module '@domternal/core' {
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

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'bulletList',
        command: 'toggleBulletList',
        isActive: 'bulletList',
        icon: 'listBullets',
        label: 'Bullet List',
        shortcut: 'Mod-Shift-8',
        group: 'lists',
        priority: 200,
      },
    ];
  },

  addFloatingMenuItems(): FloatingMenuItem[] {
    return [
      {
        name: 'bullet-list',
        label: 'Bulleted list',
        description: 'Create a simple bulleted list',
        icon: 'listBullets',
        group: 'Lists',
        priority: 200,
        keywords: ['bullet', 'list', 'unordered', 'ul'],
        shortcut: '- ',
        command: 'toggleBulletList',
        // Don't offer "Bulleted list" while cursor is already inside one,
        // otherwise picking it lifts the user out of the list.
        hideWhenInside: ['bulletList'],
      },
    ];
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-8': () => {
        return editor?.commands['toggleBulletList']?.() ?? false;
      },
    };
  },

  addExtensions() {
    return [ListItem];
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      // - item
      wrappingInputRule({ find: /^\s*[-]\s$/, type: nodeType, guard: notInsideList }),
      // * item
      wrappingInputRule({ find: /^\s*[*]\s$/, type: nodeType, guard: notInsideList }),
      // + item
      wrappingInputRule({ find: /^\s*[+]\s$/, type: nodeType, guard: notInsideList }),
    ];
  },
});
