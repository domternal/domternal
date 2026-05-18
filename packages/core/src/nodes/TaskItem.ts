/**
 * Enter / Backspace state machine for taskItem (cursor's parent must be a paragraph):
 *
 *  LABEL paragraph (childIndex 0):
 *    Enter, empty     -> splitListItem fall-through, then taskItem-in-listItem
 *                        promotion (nested orderedList > listItem > taskList > taskItem
 *                        context), else liftListItem.
 *    Enter, non-empty -> splitListItem (new sibling taskItem)
 *    Backspace, empty -> liftListItem (exit empty checkbox)
 *
 *  CHILDREN-ZONE paragraph (childIndex > 0):
 *    Enter, empty     -> insertChildrenZoneSibling (accumulate inside the item)
 *    Enter, non-empty -> splitBlock (both halves stay inside the same item)
 *    Backspace, empty -> liftEmptyChildrenZoneParagraph (exit as top-level)
 *
 * Tab / Shift-Tab sink / lift the item; Mod-Enter toggles checked state.
 */
import { Node } from '../Node.js';
import { splitListItem, liftListItem, sinkListItem } from '@domternal/pm/schema-list';
import { Selection } from '@domternal/pm/state';
import { splitBlock } from '@domternal/pm/commands';
import type { CommandSpec } from '../types/Commands.js';
import { getListItemCursorContext } from '../utils/listItemCursorContext.js';
import { insertChildrenZoneSibling } from '../utils/insertChildrenZoneSibling.js';
import { liftEmptyChildrenZoneParagraph } from '../utils/liftEmptyChildrenZoneParagraph.js';
import { TaskItemNodeView } from './TaskItemNodeView.js';

declare module '../types/Commands.js' {
  interface RawCommands {
    toggleTask: CommandSpec;
  }
}

export interface TaskItemOptions {
  HTMLAttributes: Record<string, unknown>;
  nested: boolean;
}

export const TaskItem = Node.create<TaskItemOptions>({
  name: 'taskItem',

  // Paragraph must be the first child so flex alignment binds to the label
  // baseline; a heading-first child would visually break the checkbox.
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
            'aria-label': 'Task status',
          },
        ],
      ],
      ['div', 0],
    ];
  },

  addNodeView() {
    const options = this.options;
    return (node, view, getPos) =>
      new TaskItemNodeView({ options, node, view, getPos });
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
    return {
      Enter: () => {
        if (!this.editor || !this.nodeType) return false;
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.depth < 1 || $from.node(-1).type !== this.nodeType) return false;
        // Defer if cursor is in a nested non-paragraph block (heading, codeBlock)
        // so that block's own Enter handler runs instead of splitListItem.
        if ($from.parent.type.name !== 'paragraph') return false;

        // Children-zone Enter accumulates inside the taskItem (Notion semantics).
        const ctx = getListItemCursorContext($from);
        if (ctx?.isInChildrenZone) {
          if (ctx.paragraphIsEmpty) {
            if (insertChildrenZoneSibling(state, view.dispatch, ctx)) return true;
          } else {
            if (splitBlock(state, view.dispatch)) return true;
          }
        }

        // Standard split for non-empty items. Pass `{ checked: false }` so
        // a freshly-spawned task item always starts unchecked - splitting
        // off a checked task otherwise inherits checked: true (Notion
        // semantics: each new task is fresh work). Other attrs assigned
        // by sibling extensions (UniqueID's `id`, etc.) are intentionally
        // NOT forwarded so those extensions can regenerate them.
        if (splitListItem(this.nodeType, { checked: false })(state, view.dispatch)) return true;

        // For empty taskItem nested inside a parent list item (e.g. orderedList > listItem > taskList > taskItem),
        // delete the taskItem, clean up the taskList if empty, and create a new parent listItem.
        // Without this, liftListItem alone leaves a bare empty paragraph inside the listItem.
        if ($from.parent.content.size === 0) {
          const listItemType = state.schema.nodes['listItem'];
          if (listItemType) {
            let parentListItemDepth = -1;
            for (let d = $from.depth - 2; d > 0; d--) {
              if ($from.node(d).type === listItemType) {
                parentListItemDepth = d;
                break;
              }
            }

            if (parentListItemDepth > 0) {
              const tr = state.tr;
              const taskItemDepth = $from.depth - 1;
              const taskItemNode = $from.node(taskItemDepth);

              if (taskItemNode.childCount > 1) {
                // TaskItem has content beyond the empty paragraph (e.g. paragraph + nested list + empty paragraph).
                // Only delete the trailing empty paragraph, not the whole taskItem.
                tr.delete($from.before($from.depth), $from.after($from.depth));
              } else {
                const taskListDepth = taskItemDepth - 1;
                const taskListNode = $from.node(taskListDepth);

                if (taskListNode.childCount <= 1) {
                  // Only child - delete the entire taskList. Deleting just the taskItem
                  // would leave an empty taskList, violating its content spec and causing
                  // ProseMirror's replaceStep to silently skip the deletion.
                  tr.delete($from.before(taskListDepth), $from.after(taskListDepth));
                } else {
                  // Multiple children - delete just the empty taskItem
                  tr.delete($from.before(taskItemDepth), $from.after(taskItemDepth));
                }
              }

              // 3. Insert a new listItem after the parent listItem
              const listItemEnd = tr.mapping.map($from.after(parentListItemDepth));
              const newItem = listItemType.createAndFill();
              if (newItem) {
                tr.insert(listItemEnd, newItem);
                tr.setSelection(Selection.near(tr.doc.resolve(listItemEnd + 2)));
                view.dispatch(tr.scrollIntoView());
                return true;
              }
            }
          }
        }

        // Standard lift for non-nested empty items
        return liftListItem(this.nodeType)(state, view.dispatch);
      },
      Tab: () => {
        if (!this.editor || !this.nodeType) return false;
        const { $from } = this.editor.state.selection;
        if ($from.depth < 1 || $from.node(-1).type !== this.nodeType) return false;
        return sinkListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
      'Shift-Tab': () => {
        if (!this.editor || !this.nodeType) return false;
        const { $from } = this.editor.state.selection;
        if ($from.depth < 1 || $from.node(-1).type !== this.nodeType) return false;
        return liftListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
      Backspace: () => {
        if (!this.editor || !this.nodeType) return false;
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;

        // Only at start of a textblock with empty selection
        if (!empty || $from.parentOffset !== 0) return false;

        // Empty children-zone paragraph: lift it out as a top-level sibling.
        if ($from.parent.content.size === 0) {
          const ctx = getListItemCursorContext($from);
          if (ctx && ctx.isInChildrenZone && ctx.paragraphIsEmpty) {
            if (liftEmptyChildrenZoneParagraph(state, view.dispatch, ctx)) return true;
          }
        }

        // Find enclosing taskItem
        let taskItemDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === this.nodeType) {
            taskItemDepth = d;
            break;
          }
        }
        if (taskItemDepth === -1) return false;

        // Only lift when cursor is in the first child of the taskItem
        if ($from.index(taskItemDepth) !== 0) return false;

        return liftListItem(this.nodeType)(state, view.dispatch);
      },
      'Mod-Enter': () => {
        return this.editor?.commands['toggleTask']?.() ?? false;
      },
    };
  },
});
