/**
 * TrailingNode Extension
 *
 * Ensures there's always a trailing node (usually paragraph) at the end
 * of the document, making it easier to type after block elements like
 * code blocks, images, or tables.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import { isHistoryTransaction } from '@domternal/pm/history';
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
        appendTransaction(transactions, __, state) {
          // UI notifications must not edit the document. Selection-driven
          // initialization retains the existing editing behavior.
          // Undo restores its original snapshot, including an initially absent tail.
          if (!transactions.some(transaction => transaction.docChanged
            || (transaction.selectionSet && transaction.getMeta('addToHistory') !== false))
            || transactions.some(isHistoryTransaction)) return;
          if (!trailingNodeKey.getState(state)) return;
          const transaction = state.tr.insert(state.doc.content.size, type.create());
          if (state.storedMarks !== null) transaction.setStoredMarks(state.storedMarks);
          const followsUserEdit = transactions.some(change => change.docChanged && change.getMeta('addToHistory') !== false);
          if (!followsUserEdit) transaction.setMeta('addToHistory', false);
          return transaction;
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
