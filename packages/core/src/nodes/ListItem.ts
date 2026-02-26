/**
 * ListItem Node
 *
 * Individual list item that can contain paragraphs and nested blocks.
 * Used by BulletList and OrderedList.
 *
 * Keyboard shortcuts:
 * - Enter: Split list item at cursor, or lift out of list if item is empty
 * - Tab: Sink (indent) list item
 * - Shift-Tab: Lift (outdent) list item
 */

import { Node } from '../Node.js';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { Selection } from 'prosemirror-state';

export interface ListItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const ListItem = Node.create<ListItemOptions>({
  name: 'listItem',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'li' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (!this.editor || !this.nodeType) return false;
        const { state, view } = this.editor;
        const { $from } = state.selection;
        // Only handle Enter when the cursor's immediate item ancestor is a listItem.
        if ($from.node(-1).type !== this.nodeType) return false;

        if (splitListItem(this.nodeType)(state, view.dispatch)) return true;

        // Empty listItem inside a list that's inside a taskItem: liftListItem would
        // place a bare paragraph in the taskItem (loses bullet marker). Instead,
        // delete the empty item and create a new taskItem in the parent taskList
        // (one level up, not jumping to a distant ancestor).
        const listDepth = $from.depth - 2;
        const taskItemType = state.schema.nodes['taskItem'];
        if ($from.parent.content.size === 0 && listDepth > 0
          && taskItemType && $from.node(listDepth - 1).type === taskItemType) {
          const tr = state.tr;
          const delDepth = $from.node(listDepth).childCount <= 1 ? listDepth : $from.depth - 1;
          tr.delete($from.before(delDepth), $from.after(delDepth));
          const taskItemDepth = listDepth - 1;
          const end = tr.mapping.map($from.after(taskItemDepth));
          const item = taskItemType.createAndFill();
          if (item) {
            tr.insert(end, item);
            tr.setSelection(Selection.near(tr.doc.resolve(end + 2)));
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }

        return liftListItem(this.nodeType)(state, view.dispatch);
      },
      Tab: () => {
        if (!this.editor || !this.nodeType) return false;
        const { $from } = this.editor.state.selection;
        if ($from.node(-1).type !== this.nodeType) return false;
        return sinkListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
      'Shift-Tab': () => {
        if (!this.editor || !this.nodeType) return false;
        const { $from } = this.editor.state.selection;
        if ($from.node(-1).type !== this.nodeType) return false;
        return liftListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
    };
  },
});
