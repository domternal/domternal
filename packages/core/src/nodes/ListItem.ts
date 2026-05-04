/**
 * ListItem Node
 *
 * Individual list item that can contain paragraphs and nested blocks.
 * Used by BulletList and OrderedList.
 *
 * Enter behaviour matrix (cursor's parent must be a paragraph):
 *  - Cursor in LABEL paragraph (childIndex 0):
 *    - Empty + Enter -> liftListItem (lift entire item out, "exit empty bullet")
 *    - Non-empty + Enter -> splitListItem (new sibling listItem)
 *  - Cursor in CHILDREN-ZONE paragraph (childIndex > 0):
 *    - Empty + Enter -> insertChildrenZoneSibling (Notion-style: insert another
 *      empty paragraph as next sibling INSIDE the same list item, accumulating
 *      so the user can build elaborate children-zone content). Exit via the
 *      Backspace handler below or Shift+Tab (ListIndent.outdentBlockFromListItem).
 *    - Non-empty + Enter -> splitListItem (existing behaviour, may evolve later)
 *
 * Backspace behaviour:
 *  - At start of EMPTY children-zone paragraph -> liftEmptyChildrenZoneParagraph
 *    (exit list as a top-level paragraph). Discoverable counterpart to Enter
 *    accumulation.
 *
 * Keyboard shortcuts:
 * - Enter: see matrix above
 * - Backspace: see matrix above
 * - Tab/Shift-Tab: Handled by ListKeymap extension (included via addExtensions)
 */

import { Node } from '../Node.js';
import { splitListItem, liftListItem } from '@domternal/pm/schema-list';
import { Selection } from '@domternal/pm/state';
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
        // Only handle Enter when the cursor's immediate item ancestor is a listItem.
        if ($from.depth < 1 || $from.node(-1).type !== this.nodeType) return false;
        // Defer when the cursor sits inside a NESTED non-paragraph block
        // (heading, codeBlock, etc.) - that block's own Enter handler
        // (e.g. Heading's "Enter at end -> insert paragraph below")
        // should run instead. Without this, splitListItem would split
        // the entire list item and the nested-block-specific behaviour
        // would never get a chance.
        if ($from.parent.type.name !== 'paragraph') return false;

        // Plan 4 Phase 5: Notion-style accumulate. Cursor in an empty
        // paragraph that sits in the children-zone (not the label) ->
        // insert another empty paragraph as the next sibling INSIDE the
        // same list item. Exit via Backspace or Shift+Tab.
        const ctx = getListItemCursorContext($from);
        if (ctx && ctx.isInChildrenZone && ctx.paragraphIsEmpty) {
          if (insertChildrenZoneSibling(state, view.dispatch, ctx)) return true;
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
        // Only act on collapsed selection at offset 0 of an empty
        // textblock - the natural "this line is blank, remove it" intent.
        if (!empty || $from.parentOffset !== 0) return false;
        if ($from.parent.content.size !== 0) return false;

        // Plan 4 Phase 6: Notion-style exit. Cursor in an EMPTY
        // paragraph in the children-zone -> lift it out as a top-level
        // paragraph (= exit the list one nesting level). Counterpart to
        // the Enter accumulate path above.
        const ctx = getListItemCursorContext($from);
        if (ctx && ctx.isInChildrenZone && ctx.paragraphIsEmpty) {
          if (liftEmptyChildrenZoneParagraph(state, view.dispatch, ctx)) return true;
        }

        // Fall through: ListKeymap / BaseKeymap handle the empty-label
        // backspace cases (joinBackward / liftListItem).
        return false;
      },
    };
  },
});
