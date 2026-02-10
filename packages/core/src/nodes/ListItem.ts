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
import { keymap } from 'prosemirror-keymap';
import type { Command as PMCommand } from 'prosemirror-state';

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
    return {
      // Enter is handled in addProseMirrorPlugins to avoid TaskItem override via Object.assign
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

  addProseMirrorPlugins() {
    return [
      keymap({
        Enter: ((state, dispatch) => {
          const nodeType = state.schema.nodes['listItem'];
          if (!nodeType) return false;
          return splitListItem(nodeType)(state, dispatch);
        }) as PMCommand,
      }),
    ];
  },
});
