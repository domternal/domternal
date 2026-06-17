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
import { canSplit } from '@domternal/pm/transform';
import type { CommandSpec } from '../types/Commands.js';
import { getListItemCursorContext } from '../utils/listItemCursorContext.js';
import { insertChildrenZoneSibling } from '../utils/insertChildrenZoneSibling.js';
import { liftEmptyChildrenZoneParagraph } from '../utils/liftEmptyChildrenZoneParagraph.js';
import { liftCrossTypeListItem } from '../utils/liftCrossTypeListItem.js';
import { TaskItemNodeView } from './TaskItemNodeView.js';

declare module '@domternal/core' {
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
          if (dataChecked !== null) {
            // Case-insensitive ("TRUE"/"True") + the empty-string form.
            return dataChecked.toLowerCase() === 'true' || dataChecked === '';
          }
          // No data-checked (GFM / markdown task lists): derive from the
          // rendered checkbox input so imported checked state survives.
          return element.querySelector('input[type="checkbox"]')?.hasAttribute('checked') ?? false;
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
      // GFM / markdown task lists: `<li class="task-list-item">` carries no
      // data-type. Priority 51 keeps it ahead of the generic `li` (listItem,
      // 50); class-scoped so it never swallows ordinary bullet items. The
      // `checked` attribute is derived from the descendant `<input>` above.
      {
        tag: 'li.task-list-item',
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

        // splitListItem only resets the new item's attrs when the caret is at
        // the END of the label, so a checked to-do split MID-label would copy
        // checked: true onto the tail. Force an unchecked tail to match the
        // end-of-item case (and Notion: each new task is fresh work).
        if (
          !ctx?.isInChildrenZone
          && $from.node(-1).attrs['checked']
          && $from.parentOffset > 0
          && $from.parentOffset < $from.parent.content.size
        ) {
          const tr = state.tr;
          const types = [
            { type: this.nodeType, attrs: { ...$from.node(-1).attrs, checked: false } },
            { type: $from.parent.type },
          ];
          if (canSplit(tr.doc, $from.pos, 2, types)) {
            view.dispatch(tr.split($from.pos, 2, types).scrollIntoView());
            return true;
          }
        }

        // Label slot of a taskItem that already has nested children. PM's
        // splitListItem assigns everything after the caret (the whole nested
        // sub-list) to the new sibling, emptying the original item. Notion
        // keeps children under the original parent, so handle these here.
        const item = $from.node(-1);
        const hasChildren = item.childCount > 1;
        const labelEmpty = $from.parent.content.size === 0;
        const atEnd = $from.parentOffset === $from.parent.content.size;
        if (!ctx?.isInChildrenZone && hasChildren && atEnd && !labelEmpty) {
          // Non-empty label, caret at end: a fresh unchecked sibling drops
          // below; children stay nested under the original item.
          const newItem = this.nodeType.createAndFill({ checked: false });
          if (newItem) {
            const insertAt = $from.after($from.depth - 1);
            const tr = state.tr.insert(insertAt, newItem);
            tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 2)));
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }

        // Standard split for non-empty items. Pass `{ checked: false }` so
        // a freshly-spawned task item always starts unchecked - splitting
        // off a checked task otherwise inherits checked: true (Notion
        // semantics: each new task is fresh work). Other attrs assigned
        // by sibling extensions (UniqueID's `id`, etc.) are intentionally
        // NOT forwarded so those extensions can regenerate them.
        //
        // Skip the split for an empty label that has children: splitting would
        // migrate the children to a stray sibling. Fall through to the
        // empty-item lift/promotion below (Notion: empty Enter outdents).
        const skipSplit = !ctx?.isInChildrenZone && labelEmpty && hasChildren;
        if (!skipSplit && splitListItem(this.nodeType, { checked: false })(state, view.dispatch)) return true;

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
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.depth < 1 || $from.node(-1).type !== this.nodeType) return false;
        // Cross-type nesting (taskItem inside a bullet/ordered list item):
        // liftListItem would dissolve the task into a bare paragraph, dropping
        // the checkbox + checked state. Preserve it instead.
        if (liftCrossTypeListItem(state, view.dispatch)) return true;
        return liftListItem(this.nodeType)(state, view.dispatch);
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

        // Cross-type nesting: preserve the task (type + checked) instead of
        // dissolving it to a paragraph.
        if (liftCrossTypeListItem(state, view.dispatch)) return true;
        return liftListItem(this.nodeType)(state, view.dispatch);
      },
      'Mod-Enter': () => {
        return this.editor?.commands['toggleTask']?.() ?? false;
      },
    };
  },
});
