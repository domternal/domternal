/**
 * Link Exit Plugin
 *
 * Allows users to "exit" a link mark by pressing ArrowRight at the
 * end of the link. After exiting, newly typed text will not have
 * the link mark applied.
 *
 * This matches Tiptap's `exitable: true` behavior on the Link mark.
 */
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

/**
 * Options for the link exit plugin
 */
export interface LinkExitPluginOptions {
  /**
   * The link mark type
   */
  type: MarkType;
}

/**
 * Plugin key for link exit plugin
 */
export const linkExitPluginKey = new PluginKey('linkExit');

/**
 * Creates a plugin that allows exiting a link mark with ArrowRight.
 *
 * When the cursor is at the end boundary of a link mark (the next
 * character has no link mark, or there is no next character), pressing
 * ArrowRight will set storedMarks to exclude the link mark. This means
 * any text typed after will not be linked.
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function linkExitPlugin(options: LinkExitPluginOptions): Plugin {
  const { type } = options;

  return new Plugin({
    key: linkExitPluginKey,

    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'ArrowRight') return false;

        const { state } = view;
        const { selection } = state;

        // Only handle cursor (collapsed) selections
        if (!(selection instanceof TextSelection) || !selection.empty) {
          return false;
        }

        const $cursor = selection.$cursor;
        if (!$cursor) return false;

        // Check the node before cursor for the link mark.
        // We use nodeBefore.marks instead of $cursor.marks() because
        // nodeBefore always reflects the actual marks on the text node,
        // regardless of the mark's inclusive setting.
        const nodeBefore = $cursor.nodeBefore;
        if (!nodeBefore) return false;

        const marksOnNode = nodeBefore.marks;
        const hasLink = marksOnNode.some((m) => m.type === type);
        if (!hasLink) return false;

        // Check if we're at the end of the mark range:
        // The next character either doesn't exist or doesn't have the link mark
        const after = $cursor.nodeAfter;
        const afterHasLink = after?.marks.some((m) => m.type === type) ?? false;

        if (!afterHasLink) {
          // We're at the boundary — strip link from storedMarks
          const marksWithoutLink = marksOnNode.filter((m) => m.type !== type);
          const tr = state.tr.setStoredMarks(marksWithoutLink);
          view.dispatch(tr);
          // Don't prevent default — let ArrowRight move cursor normally
          return false;
        }

        return false;
      },
    },
  });
}
