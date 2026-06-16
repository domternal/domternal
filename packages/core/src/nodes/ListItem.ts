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

        // Label slot of an item that already has nested children. PM's
        // splitListItem assigns everything after the caret (the whole nested
        // sub-list) to the new sibling, emptying the original item. Notion
        // keeps children under the original parent, so handle these here:
        const item = $from.node(-1);
        const hasChildren = item.childCount > 1;
        const atEnd = $from.parentOffset === $from.parent.content.size;
        const labelEmpty = $from.parent.content.size === 0;
        if (!ctx?.isInChildrenZone && hasChildren && atEnd && !labelEmpty) {
          // Non-empty label, caret at end: a fresh empty sibling drops below,
          // children stay nested under the original item.
          const newItem = this.nodeType.createAndFill();
          if (newItem) {
            const insertAt = $from.after($from.depth - 1);
            const tr = state.tr.insert(insertAt, newItem);
            tr.setSelection(Selection.near(tr.doc.resolve(insertAt + 2)));
            view.dispatch(tr.scrollIntoView());
            return true;
          }
        }

        // Empty label with children: skip splitListItem (it would migrate the
        // children to a stray sibling) and fall through to the lift below,
        // which outdents the whole item one level (Notion: empty Enter
        // outdents). Childless empty labels still split (splitListItem no-ops
        // on them, then liftListItem runs).
        const skipSplit = !ctx?.isInChildrenZone && labelEmpty && hasChildren;
        if (!skipSplit && splitListItem(this.nodeType)(state, view.dispatch)) return true;

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
