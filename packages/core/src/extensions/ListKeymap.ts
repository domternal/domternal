/**
 * ListKeymap Extension
 *
 * Provides keyboard shortcuts for list manipulation:
 * - Tab: Sink (indent) list item
 * - Shift-Tab: Lift (outdent) list item
 * - Backspace: Lift list item when at start of empty item
 */
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { NodeType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Extension } from '../Extension.js';
import type { ExtensionEditorInterface } from '../Extension.js';

export interface ListKeymapOptions {
  /**
   * Name of the list item node type.
   * @default 'listItem'
   */
  listItem: string;
}

/** Resolves the list item NodeType and checks if cursor is inside one.
 *  Returns null when a different item type (e.g. taskItem) sits closer
 *  to the cursor than the target listItem, preventing cross-type interference. */
function getListItemContext(
  editor: ExtensionEditorInterface,
  listItemName: string,
): { state: EditorState; view: EditorView; listItemType: NodeType } | null {
  const { state, view } = editor as { state: EditorState; view: EditorView };
  const listItemType = state.schema.nodes[listItemName];
  if (!listItemType) return null;

  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    // If we hit a different item type first (e.g. taskItem), bail out
    if (node.type.spec.defining && node.type !== listItemType && node.type.isBlock) {
      const parent = d > 0 ? $from.node(d - 1) : null;
      if (parent?.type.spec.group?.includes('list')) {
        return null;
      }
    }
    if (node.type === listItemType) {
      return { state, view, listItemType };
    }
  }

  return null;
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
        if (!this.editor) return false;
        const ctx = getListItemContext(this.editor, this.options.listItem);
        if (!ctx) return false;
        return sinkListItem(ctx.listItemType)(ctx.state, ctx.view.dispatch);
      },

      // Shift-Tab to lift (outdent) list item
      'Shift-Tab': () => {
        if (!this.editor) return false;
        const ctx = getListItemContext(this.editor, this.options.listItem);
        if (!ctx) return false;
        return liftListItem(ctx.listItemType)(ctx.state, ctx.view.dispatch);
      },

      // Backspace at start of list item to lift
      Backspace: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor as { state: EditorState; view: EditorView };
        const { $from, empty } = state.selection;

        // Only at start of textblock with empty selection
        if (!empty || $from.parentOffset !== 0) return false;

        const listItemType = state.schema.nodes[this.options.listItem];
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
