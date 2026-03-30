/**
 * TaskList Node
 *
 * Block-level task/checkbox list container.
 * Supports markdown-style input rules with `[ ]` and `[x]`.
 */

import { Node } from '../Node.js';
import { wrappingInputRule, notInsideList } from '../helpers/wrappingInputRule.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ToolbarItem } from '../types/Toolbar.js';
import { TaskItem } from './TaskItem.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    toggleTaskList: CommandSpec;
  }
}

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
          return commands.toggleList(name, options.itemTypeName);
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

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'taskList',
        command: 'toggleTaskList',
        isActive: 'taskList',
        icon: 'listChecks',
        label: 'Task List',
        shortcut: 'Mod-Shift-9',
        group: 'lists',
        priority: 170,
      },
    ];
  },

  addExtensions() {
    return [TaskItem];
  },

  addInputRules() {
    const { nodeType } = this;

    if (!nodeType) {
      return [];
    }

    return [
      // [ ] at start of line creates unchecked task
      wrappingInputRule({ find: /^\s*\[\s?\]\s$/, type: nodeType, guard: notInsideList }),
      // [x] or [X] at start of line creates checked task
      wrappingInputRule({ find: /^\s*\[[xX]\]\s$/, type: nodeType, guard: notInsideList }),
    ];
  },
});
