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

import type { Node as NodeClass } from '../Node.js';
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
    const self = this as unknown as NodeClass<ListItemOptions>;
    return ['li', { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addKeyboardShortcuts() {
    const self = this as unknown as NodeClass<ListItemOptions>;
    return {
      Enter: () => {
        const editor = self.editor as { state: EditorState; view: EditorView } | null;
        if (!editor) return false;

        const nodeType = self.nodeType;
        if (!nodeType) return false;

        return splitListItem(nodeType)(editor.state, editor.view.dispatch);
      },
      Tab: () => {
        const editor = self.editor as { state: EditorState; view: EditorView } | null;
        if (!editor) return false;

        const nodeType = self.nodeType;
        if (!nodeType) return false;

        return sinkListItem(nodeType)(editor.state, editor.view.dispatch);
      },
      'Shift-Tab': () => {
        const editor = self.editor as { state: EditorState; view: EditorView } | null;
        if (!editor) return false;

        const nodeType = self.nodeType;
        if (!nodeType) return false;

        return liftListItem(nodeType)(editor.state, editor.view.dispatch);
      },
    };
  },
});
