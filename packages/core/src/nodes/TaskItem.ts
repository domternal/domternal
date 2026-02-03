/**
 * TaskItem Node
 *
 * Individual task/checkbox item that can contain paragraphs and nested blocks.
 * Used by TaskList.
 *
 * Keyboard shortcuts:
 * - Enter: Split task item at cursor
 * - Tab: Sink (indent) task item
 * - Shift-Tab: Lift (outdent) task item
 * - Mod-Enter: Toggle task checked state
 */

import { Node } from '../Node.js';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface TaskItemOptions {
  HTMLAttributes: Record<string, unknown>;
  nested: boolean;
}

export const TaskItem = Node.create<TaskItemOptions>({
  name: 'taskItem',

  content: 'paragraph block*',

  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      nested: true,
    };
  },

  addAttributes() {
    return {
      checked: {
        default: false,
        keepOnSplit: false,
        parseHTML: (element: HTMLElement) => {
          const dataChecked = element.getAttribute('data-checked');
          return dataChecked === 'true' || dataChecked === '';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-checked': attributes['checked'] ? 'true' : 'false',
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: `li[data-type="${this.name}"]`,
        priority: 51,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      {
        ...this.options.HTMLAttributes,
        ...HTMLAttributes,
        'data-type': this.name,
      },
      [
        'label',
        { contenteditable: 'false' },
        [
          'input',
          {
            type: 'checkbox',
            checked: node.attrs['checked'] ? 'checked' : null,
          },
        ],
      ],
      ['div', 0],
    ];
  },

  addCommands() {
    const { name } = this;
    return {
      toggleTask:
        () =>
        ({ state, dispatch }) => {
          const { selection } = state;
          const { $from } = selection;

          // Find the task item node
          let taskItemPos: number | null = null;
          let taskItemNode = null;

          for (let depth = $from.depth; depth >= 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === name) {
              taskItemPos = $from.before(depth);
              taskItemNode = node;
              break;
            }
          }

          if (taskItemPos === null || !taskItemNode) return false;

          if (dispatch) {
            const tr = state.tr.setNodeMarkup(taskItemPos, undefined, {
              ...taskItemNode.attrs,
              checked: !taskItemNode.attrs['checked'],
            });
            dispatch(tr);
          }

          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const { editor, nodeType } = this;
    return {
      Enter: () => {
        if (!editor || !nodeType) return false;
        const { state, view } = editor as { state: EditorState; view: EditorView };
        return splitListItem(nodeType)(state, view.dispatch);
      },
      Tab: () => {
        if (!editor || !nodeType) return false;
        const { state, view } = editor as { state: EditorState; view: EditorView };
        return sinkListItem(nodeType)(state, view.dispatch);
      },
      'Shift-Tab': () => {
        if (!editor || !nodeType) return false;
        const { state, view } = editor as { state: EditorState; view: EditorView };
        return liftListItem(nodeType)(state, view.dispatch);
      },
      'Mod-Enter': () => {
        return editor?.commands['toggleTask']?.() ?? false;
      },
    };
  },
});
