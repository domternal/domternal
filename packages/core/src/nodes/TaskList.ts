/**
 * TaskList Node
 *
 * Block-level task/checkbox list container.
 * Supports markdown-style input rules with `[ ]` and `[x]`.
 */

import { Node } from '../Node.js';
import { wrappingInputRule } from 'prosemirror-inputrules';

export interface TaskListOptions {
  HTMLAttributes: Record<string, unknown>;
  itemTypeName: string;
}

export const TaskList = Node.create<TaskListOptions>({
  name: 'taskList',
  group: 'block list',
  content: 'taskItem+',

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: 'taskItem',
    };
  },

  parseHTML() {
    return [
      {
        tag: `ul[data-type="${this.name}"]`,
        priority: 51, // Higher priority than regular bulletList
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'ul',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': this.name,
      },
      0,
    ];
  },

  addCommands() {
    const { name, options } = this;
    return {
      toggleTaskList:
        () =>
        ({ commands }) => {
          const cmds = commands as Record<string, (listName: string, itemName: string) => boolean>;
          return cmds['toggleList']?.(name, options.itemTypeName) ?? false;
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor } = this;
    return {
      'Mod-Shift-9': () => {
        return editor?.commands['toggleTaskList']?.() ?? false;
      },
    };
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      // [ ] at start of line creates unchecked task
      wrappingInputRule(/^\s*\[\s?\]\s$/, nodeType),
      // [x] or [X] at start of line creates checked task
      wrappingInputRule(/^\s*\[[xX]\]\s$/, nodeType),
    ];
  },
});
