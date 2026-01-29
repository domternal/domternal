/**
 * ListKeymap Extension
 *
 * Provides keyboard shortcuts for list manipulation:
 * - Tab: Sink (indent) list item
 * - Shift-Tab: Lift (outdent) list item
 * - Backspace: Lift list item when at start of empty item
 */
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Extension } from '../Extension.js';

export interface ListKeymapOptions {
  /**
   * Name of the list item node type.
   * @default 'listItem'
   */
  listItem: string;
}

export const ListKeymap = Extension.create<ListKeymapOptions>({
  name: 'listKeymap',

  addOptions() {
    return {
      listItem: 'listItem',
    };
  },

  addKeyboardShortcuts() {
    return {
      // Tab to sink (indent) list item
      Tab: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor as { state: EditorState; view: EditorView };
        const listItemType = state.schema.nodes[this.options.listItem] ;

        if (!listItemType) return false;

        // Check if we're actually inside a list item
        const { $from } = state.selection;
        let inListItem = false;

        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === listItemType) {
            inListItem = true;
            break;
          }
        }

        if (!inListItem) return false;

        return sinkListItem(listItemType)(state, view.dispatch);
      },

      // Shift-Tab to lift (outdent) list item
      'Shift-Tab': () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor as { state: EditorState; view: EditorView };
        const listItemType = state.schema.nodes[this.options.listItem] ;

        if (!listItemType) return false;

        // Check if we're actually inside a list item
        const { $from } = state.selection;
        let inListItem = false;

        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === listItemType) {
            inListItem = true;
            break;
          }
        }

        if (!inListItem) return false;

        return liftListItem(listItemType)(state, view.dispatch);
      },

      // Backspace at start of list item to lift
      Backspace: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor as { state: EditorState; view: EditorView };
        const { $from, empty } = state.selection;

        // Only at start of textblock with empty selection
        if (!empty || $from.parentOffset !== 0) return false;

        const listItemType = state.schema.nodes[this.options.listItem] ;
        if (!listItemType) return false;

        // Check if we're at the start of a list item
        let listItemDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type === listItemType) {
            listItemDepth = d;
            break;
          }
        }

        if (listItemDepth === -1) return false;

        // Only lift if we're at the very start of the list item content
        // (i.e., cursor is at start of first child of list item)
        const listItemNode = $from.node(listItemDepth);
        const firstChild = listItemNode.firstChild;

        if (firstChild?.isTextblock) {
          // Check if the textblock is empty or cursor is at its start
          const posInListItem = $from.pos - $from.start(listItemDepth);
          if (posInListItem <= 1) {
            return liftListItem(listItemType)(state, view.dispatch);
          }
        }

        return false;
      },
    };
  },
});
