/**
 * OrderedList Node
 *
 * Block-level ordered (numbered) list container.
 * Supports start attribute and markdown-style input rules.
 */

import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';
import { ListItem } from './ListItem.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    toggleOrderedList: CommandSpec;
  }
}

export interface OrderedListOptions {
  HTMLAttributes: Record<string, unknown>;
  itemTypeName: string;
}

export const OrderedList = Node.create<OrderedListOptions>({
  name: 'orderedList',
  group: 'block list',
  content: 'listItem+',

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: 'listItem',
    };
  },

  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const start = element.getAttribute('start');
          return start ? parseInt(start, 10) : 1;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const start = attributes['start'] as number;
          if (start === 1) {
            return {};
          }
          return { start: String(start) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'ol' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const start = node.attrs['start'] as number;
    const attrs: Record<string, unknown> = { ...this.options.HTMLAttributes, ...HTMLAttributes };

    if (start !== 1) {
      attrs['start'] = String(start);
    }

    return ['ol', attrs, 0];
  },

  addCommands() {
    const { name, options } = this;
    return {
      toggleOrderedList:
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
        name: 'orderedList',
        command: 'toggleOrderedList',
        isActive: 'orderedList',
        icon: 'listNumbers',
        label: 'Ordered List',
        shortcut: 'Mod-Shift-7',
        group: 'lists',
        priority: 190,
      },
    ];
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-7': () => {
        return editor?.commands['toggleOrderedList']?.() ?? false;
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
      // 1. item (any number followed by . )
      wrappingInputRule(
        /^(\d+)\.\s$/,
        nodeType,
        (match) => {
          const num = match[1];
          return { start: num ? parseInt(num, 10) : 1 };
        }
      ),
    ];
  },
});
