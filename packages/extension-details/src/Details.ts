/**
 * Details Node
 *
 * Block-level accordion/collapsible container using HTML <details>/<summary>.
 * Contains exactly one DetailsSummary followed by one DetailsContent.
 *
 * Commands:
 * - setDetails: Wraps selected content in a details structure
 * - unsetDetails: Lifts content out of details
 * - toggleDetails: Toggles between wrapped/unwrapped
 */

import { Node } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';

declare module '@domternal/core' {
  interface RawCommands {
    setDetails: CommandSpec;
    unsetDetails: CommandSpec;
    toggleDetails: CommandSpec;
  }
}

export interface DetailsOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const Details = Node.create<DetailsOptions>({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const { $from, $to } = tr.selection;
          const detailsType = state.schema.nodes['details'];
          const summaryType = state.schema.nodes['detailsSummary'];
          const contentType = state.schema.nodes['detailsContent'];
          const paragraphType = state.schema.nodes['paragraph'];
          if (!detailsType || !summaryType || !contentType || !paragraphType) return false;

          const range = $from.blockRange($to);
          if (!range) return false;

          // Check if already inside a details node
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === detailsType) return false;
          }

          if (!dispatch) return true;

          // Collect selected blocks as direct children of range parent
          const selectedContent = [];
          for (let i = range.startIndex; i < range.endIndex; i++) {
            selectedContent.push(range.parent.child(i));
          }

          if (selectedContent.length === 0) return false;

          const summary = summaryType.create(null, state.schema.text('Details'));
          const content = contentType.create(null, selectedContent);
          const details = detailsType.create(null, [summary, content]);

          tr.replaceWith(range.start, range.end, details);
          dispatch(tr.scrollIntoView());
          return true;
        },

      unsetDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const detailsType = state.schema.nodes['details'];
          if (!detailsType) return false;

          const { $from } = tr.selection;

          // Find the details node in ancestors
          let detailsDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === detailsType) {
              detailsDepth = d;
              break;
            }
          }

          if (detailsDepth === -1) return false;
          if (!dispatch) return true;

          const detailsNode = $from.node(detailsDepth);
          const detailsStart = $from.before(detailsDepth);
          const detailsEnd = $from.after(detailsDepth);

          // Extract content blocks from detailsContent (second child)
          const contentNode = detailsNode.child(1);
          const blocks: typeof detailsNode[] = [];
          contentNode.forEach((child) => blocks.push(child));

          tr.replaceWith(detailsStart, detailsEnd, blocks);
          dispatch(tr.scrollIntoView());
          return true;
        },

      toggleDetails:
        () =>
        ({ state, commands }) => {
          const detailsType = state.schema.nodes['details'];
          if (!detailsType) return false;

          const { $from } = state.selection;

          // Check if inside details
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === detailsType) {
              return commands.unsetDetails();
            }
          }

          return commands.setDetails();
        },
    };
  },
});
