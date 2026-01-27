/**
 * OrderedList Node
 *
 * Block-level ordered (numbered) list container.
 * Supports start attribute and markdown-style input rules.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';

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
    const self = this as unknown as NodeClass<OrderedListOptions>;
    const start = node.attrs['start'] as number;
    const attrs: Record<string, unknown> = { ...self.options.HTMLAttributes, ...HTMLAttributes };

    if (start !== 1) {
      attrs['start'] = String(start);
    }

    return ['ol', attrs, 0];
  },

  addCommands() {
    const self = this as unknown as NodeClass<OrderedListOptions>;
    return {
      toggleOrderedList:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (listName: string, itemName: string) => boolean>;
          return cmds['toggleList']?.(self.name, self.options.itemTypeName) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<OrderedListOptions>;
    return {
      'Mod-Shift-7': () => {
        const editor = self.editor as { commands: Record<string, () => boolean> } | null;
        return editor?.commands['toggleOrderedList']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const self = this as unknown as NodeClass<OrderedListOptions>;
    const nodeType = self.nodeType;

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
