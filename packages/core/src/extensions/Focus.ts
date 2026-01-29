/**
 * Focus Extension
 *
 * Adds CSS classes to nodes that contain the current selection.
 * Useful for highlighting the focused paragraph or block.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Extension } from '../Extension.js';

export interface FocusOptions {
  /**
   * CSS class to add to focused nodes.
   * @default 'has-focus'
   */
  className: string;

  /**
   * Which nodes to mark as focused:
   * - 'all': All nodes containing the selection
   * - 'deepest': Only the innermost focused node
   * - 'shallowest': Only the outermost focused node
   * @default 'all'
   */
  mode: 'all' | 'deepest' | 'shallowest';
}

export const focusPluginKey = new PluginKey('focus');

export const Focus = Extension.create<FocusOptions>({
  name: 'focus',

  addOptions() {
    return {
      className: 'has-focus',
      mode: 'all',
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: focusPluginKey,
        props: {
          decorations: ({ doc, selection }) => {
            const { from, to } = selection;
            const decorations: Decoration[] = [];
            const focusedNodes: Array<{ pos: number; nodeSize: number }> = [];

            // Collect all nodes containing the selection
            doc.nodesBetween(from, to, (node, pos) => {
              if (node.isText) return;

              // Check if this node actually contains part of the selection
              const nodeEnd = pos + node.nodeSize;
              if (pos <= to && nodeEnd >= from) {
                focusedNodes.push({ pos, nodeSize: node.nodeSize });
              }
            });

            if (focusedNodes.length === 0) {
              return DecorationSet.empty;
            }

            // Apply mode filtering
            let nodesToDecorate = focusedNodes;

            if (this.options.mode === 'deepest') {
              // Only the innermost (last) node
              const last = focusedNodes[focusedNodes.length - 1];
              nodesToDecorate = last ? [last] : [];
            } else if (this.options.mode === 'shallowest') {
              // Only the outermost (first) node
              const first = focusedNodes[0];
              nodesToDecorate = first ? [first] : [];
            }

            // Create decorations
            for (const { pos, nodeSize } of nodesToDecorate) {
              decorations.push(
                Decoration.node(pos, pos + nodeSize, {
                  class: this.options.className,
                })
              );
            }

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
