/**
 * TrailingNode Extension
 *
 * Ensures there's always a trailing node (usually paragraph) at the end
 * of the document, making it easier to type after block elements like
 * code blocks, images, or tables.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { NodeType } from '@domternal/pm/model';
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

const trailingNodeKey = new PluginKey('trailingNode');

export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
    };
  },

  addProseMirrorPlugins(): Plugin[] {
    const { node: nodeName, notAfter } = this.options;
    const ignoredNames = new Set([...notAfter, nodeName]);
    let type: NodeType;
    let triggerTypes: NodeType[];

    return [
      new Plugin({
        key: trailingNodeKey,
        appendTransaction(_, __, state) {
          if (!trailingNodeKey.getState(state)) return;
          return state.tr.insert(state.doc.content.size, type.create());
        },
        state: {
          init(_, { doc, schema }) {
            const nodeType = schema.nodes[nodeName];
            if (!nodeType) {
              throw new Error(`TrailingNode: invalid node type '${nodeName}'`);
            }
            type = nodeType;
            triggerTypes = Object.values(schema.nodes)
              .filter((n) => !ignoredNames.has(n.name));
            const lastType = doc.lastChild?.type;
            return !!lastType && triggerTypes.includes(lastType);
          },
          apply(tr, value) {
            if (!tr.docChanged) return value;
            const lastType = tr.doc.lastChild?.type;
            return !!lastType && triggerTypes.includes(lastType);
          },
        },
      }),
    ];
  },
});
