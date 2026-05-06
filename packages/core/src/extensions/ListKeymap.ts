/**
 * ListKeymap Extension
 *
 * Provides keyboard shortcuts for list manipulation:
 * - Tab: Sink (indent) list item
 * - Shift-Tab: Lift (outdent) list item
 * - Backspace: Lift list item when at start of empty item.
 *   Also handles the "exit-join" case: when the cursor is at start of an
 *   empty paragraph whose previous sibling is a list-group node
 *   (bulletList / orderedList / taskList), delete the empty paragraph and
 *   place the caret at the end of the last textblock of the previous list.
 *   Without this, PM's `joinBackward` wraps the empty paragraph back into
 *   the list as a fresh listItem/taskItem, producing the "ping-pong"
 *   regression: Enter (creates empty item), BS (lift -> empty top-level p),
 *   BS again (joinBackward wraps p back as new item).
 */
import { TextSelection } from '@domternal/pm/state';
import { liftListItem, sinkListItem } from '@domternal/pm/schema-list';
import type { NodeType } from '@domternal/pm/model';
import type { EditorState } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { Extension } from '../Extension.js';
import type { ExtensionEditorInterface } from '../Extension.js';

const LIST_GROUP_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

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

        // "Exit-join" path: cursor at start of an EMPTY paragraph whose
        // previous sibling (in its container) is a list-group node. Without
        // this, PM's `joinBackward` would wrap the empty paragraph back
        // into the list as a new listItem/taskItem (the "ping-pong" bug).
        // We delete the empty paragraph and move the caret to the end of
        // the last textblock of the previous list - the natural intent
        // when the user backspaces from the line just below a list.
        //
        // Additionally, when the empty paragraph sits BETWEEN two
        // same-type list groups (the common shape after splitListItem +
        // liftListItem on a middle item), join them so the original list
        // is reunified rather than left as two adjacent siblings.
        if (
          $from.parent.type.name === 'paragraph' &&
          $from.parent.content.size === 0 &&
          $from.depth >= 1
        ) {
          const containerDepth = $from.depth - 1;
          const idx = $from.index(containerDepth);
          if (idx > 0) {
            const container = $from.node(containerDepth);
            const prev = container.child(idx - 1);
            if (LIST_GROUP_TYPES.has(prev.type.name)) {
              const paraStart = $from.before($from.depth);
              const paraEnd = $from.after($from.depth);
              const listEnd = paraStart;
              const listStart = listEnd - prev.nodeSize;
              let lastTextblockEnd = -1;
              state.doc.nodesBetween(listStart, listEnd, (n, p) => {
                if (n.isTextblock) lastTextblockEnd = p + 1 + n.content.size;
                return true;
              });
              if (lastTextblockEnd !== -1) {
                const tr = state.tr.delete(paraStart, paraEnd);

                // If the next sibling is a list group of the SAME type,
                // join it onto the previous list. After the delete, the
                // boundary between the two lists sits at `paraStart` in
                // the new doc, so `tr.join(paraStart)` merges them.
                const next = idx + 1 < container.childCount
                  ? container.child(idx + 1)
                  : null;
                if (next?.type === prev.type) {
                  try {
                    tr.join(paraStart);
                  } catch {
                    // join failed (schema), keep just the delete
                  }
                }

                tr.setSelection(TextSelection.create(tr.doc, lastTextblockEnd));
                view.dispatch(tr.scrollIntoView());
                return true;
              }
            }
          }
        }

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
