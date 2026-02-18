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
        // splitListItem returns false for empty top-level items,
        // fall back to liftListItem to exit the list
        return splitListItem(this.nodeType)(state, view.dispatch)
          || liftListItem(this.nodeType)(state, view.dispatch);
      },
      Tab: () => {
        if (!this.editor || !this.nodeType) return false;
        return sinkListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
      'Shift-Tab': () => {
        if (!this.editor || !this.nodeType) return false;
        return liftListItem(this.nodeType)(this.editor.state, this.editor.view.dispatch);
      },
    };
  },
});
