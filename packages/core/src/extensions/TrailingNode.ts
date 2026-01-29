/**
 * TrailingNode Extension
 *
 * Ensures there's always a trailing node (usually paragraph) at the end
 * of the document, making it easier to type after block elements like
 * code blocks, images, or tables.
 */
import { trailingNode } from 'prosemirror-trailing-node';
import type { Plugin } from 'prosemirror-state';
import { Extension } from '../Extension.js';

export interface TrailingNodeOptions {
  /**
   * The node type name to insert as trailing node.
   * @default 'paragraph'
   */
  node: string;

  /**
   * Node types after which a trailing node should NOT be added.
   * Typically includes the trailing node type itself.
   * @default ['paragraph']
   */
  notAfter: string[];
}

export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
    };
  },

  addProseMirrorPlugins(): Plugin[] {
    return [
      trailingNode({
        nodeName: this.options.node,
        ignoredNodes: this.options.notAfter,
      }),
    ];
  },
});
