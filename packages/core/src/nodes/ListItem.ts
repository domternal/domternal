/**
 * ListItem Node
 *
 * Individual list item that can contain paragraphs and nested blocks.
 * Used by BulletList and OrderedList.
 *
 * Keyboard shortcuts:
 * - Enter: Split list item at cursor
 * - Tab: Sink (indent) list item
 * - Shift-Tab: Lift (outdent) list item
 */

import { Node } from '../Node.js';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

export interface ListItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const ListItem = Node.create<ListItemOptions>({
  name: 'listItem',
  content: 'paragraph block*',
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
    };
  },
});
