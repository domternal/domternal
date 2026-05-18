/**
 * Enter / Backspace state machine for listItem (cursor's parent must be a paragraph):
 *
 *  LABEL paragraph (childIndex 0):
 *    Enter, empty     -> liftListItem (exit empty bullet)
 *    Enter, non-empty -> splitListItem (new sibling listItem)
 *    Backspace, empty -> falls through to ListKeymap (liftListItem)
 *
 *  CHILDREN-ZONE paragraph (childIndex > 0):
 *    Enter, empty     -> insertChildrenZoneSibling (accumulate inside the item)
 *    Enter, non-empty -> splitBlock (both halves stay inside the same item)
 *    Backspace, empty -> liftEmptyChildrenZoneParagraph (exit as top-level)
 *
 * Tab / Shift-Tab handled by the ListKeymap extension.
 */
import { Node } from '../Node.js';
import { splitListItem, liftListItem } from '@domternal/pm/schema-list';
import { Selection } from '@domternal/pm/state';
import { splitBlock } from '@domternal/pm/commands';
import { ListKeymap } from '../extensions/ListKeymap.js';
import { getListItemCursorContext } from '../utils/listItemCursorContext.js';
import { insertChildrenZoneSibling } from '../utils/insertChildrenZoneSibling.js';
import { liftEmptyChildrenZoneParagraph } from '../utils/liftEmptyChildrenZoneParagraph.js';

export interface ListItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const ListItem = Node.create<ListItemOptions>({
  name: 'listItem',
  // Notion-strict: paragraph must be the first child (the "label" line aligned
  // with the bullet); additional blocks render below as nested children.
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

  addExtensions() {
    return [ListKeymap];
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

        // Children-zone Enter accumulates inside the item (Notion semantics),
        // never splits the wrapper into a sibling listItem.
        const ctx = getListItemCursorContext($from);
        if (ctx?.isInChildrenZone) {
          if (ctx.paragraphIsEmpty) {
            if (insertChildrenZoneSibling(state, view.dispatch, ctx)) return true;
          } else {
            if (splitBlock(state, view.dispatch)) return true;
          }
        }

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

      Backspace: () => {
        if (!this.editor || !this.nodeType) return false;
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.content.size !== 0) return false;

        // Empty children-zone paragraph: lift it out as a top-level sibling.
        // Empty-label backspace falls through to ListKeymap (liftListItem).
        const ctx = getListItemCursorContext($from);
        if (ctx && ctx.isInChildrenZone && ctx.paragraphIsEmpty) {
          if (liftEmptyChildrenZoneParagraph(state, view.dispatch, ctx)) return true;
        }

        return false;
      },
    };
  },
});
