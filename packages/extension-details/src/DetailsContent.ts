/**
 * DetailsContent Node
 *
 * Wrapper for the collapsible content inside a <details> accordion.
 * Renders as <div data-details-content> since HTML <details> has no
 * native wrapper for non-summary content.
 *
 * Features:
 * - Hidden by default via NodeView (toggleable via event)
 * - Double-Enter at end escapes out of details
 */

import { Node, findParentNode, defaultBlockAt } from '@domternal/core';
import { Selection } from 'prosemirror-state';
import type { ViewMutationRecord } from 'prosemirror-view';

export interface DetailsContentOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const DetailsContent = Node.create<DetailsContentOptions>({
  name: 'detailsContent',
  content: 'block+',
  defining: true,
  selectable: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-details-content]' },
      { tag: 'div[data-type="detailsContent"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { ...this.options.HTMLAttributes, ...HTMLAttributes, 'data-details-content': '' },
      0,
    ];
  },

  addNodeView() {
    const options = this.options;
    return () => {
      const dom = document.createElement('div');

      dom.setAttribute('data-type', 'detailsContent');
      dom.setAttribute('hidden', 'hidden');

      for (const [key, value] of Object.entries(options.HTMLAttributes)) {
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      }

      dom.addEventListener('toggleDetailsContent', () => {
        dom.toggleAttribute('hidden');
      });

      return {
        dom,
        contentDOM: dom,
        ignoreMutation(mutation: ViewMutationRecord) {
          if (mutation.type === 'selection') {
            return false;
          }
          return !dom.contains(mutation.target) || dom === mutation.target;
        },
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'detailsContent') {
            return false;
          }
          return true;
        },
      };
    };
  },

  addKeyboardShortcuts() {
    return {
      // Double-Enter escape: when pressing Enter on the last empty block
      // inside details content, escape out and create a new block after details
      Enter: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor;
        const { selection } = state;
        const { $from, empty } = selection;
        const detailsContent = findParentNode(
          (node) => node.type === state.schema.nodes['detailsContent'],
        )(selection);

        if (!empty || !detailsContent?.node.childCount) {
          return false;
        }

        const fromIndex = $from.index(detailsContent.depth);
        const { childCount } = detailsContent.node;
        const isAtEnd = childCount === fromIndex + 1;

        if (!isAtEnd) {
          return false;
        }

        const defaultChildType = detailsContent.node.type.contentMatch.defaultType;
        const defaultChildNode = defaultChildType?.createAndFill();

        if (!defaultChildNode) {
          return false;
        }

        const $childPos = state.doc.resolve(detailsContent.pos + 1);
        const lastChildIndex = childCount - 1;
        const lastChildNode = detailsContent.node.child(lastChildIndex);
        const lastChildPos = $childPos.posAtIndex(lastChildIndex, detailsContent.depth);
        const lastChildNodeIsEmpty = lastChildNode.eq(defaultChildNode);

        if (!lastChildNodeIsEmpty) {
          return false;
        }

        // Get parent of details node
        const above = $from.node(-3);

        // Get default node type after details node
        const after = $from.indexAfter(-3);
        const type = defaultBlockAt(above.contentMatchAt(after));

        if (!type || !above.canReplaceWith(after, after, type)) {
          return false;
        }

        const node = type.createAndFill();

        if (!node) {
          return false;
        }

        const { tr } = state;
        const pos = $from.after(-2);

        tr.replaceWith(pos, pos, node);

        const $pos = tr.doc.resolve(pos);
        const newSelection = Selection.near($pos, 1);

        tr.setSelection(newSelection);

        const deleteFrom = lastChildPos;
        const deleteTo = lastChildPos + lastChildNode.nodeSize;

        tr.delete(deleteFrom, deleteTo);
        tr.scrollIntoView();
        view.dispatch(tr);

        return true;
      },
    };
  },
});
