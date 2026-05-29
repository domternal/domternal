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

  /**
   * Node GROUPS after which a trailing node should NOT be added. Lists are
   * excluded by default: a trailing paragraph after a list is unnecessary
   * (you exit a list by pressing Enter on an empty item) and pollutes the
   * output with an empty `<p>` that reappears when deleted. The trailing
   * node is still added after groups NOT listed here (e.g. a trailing table,
   * which otherwise traps the caret with no way to type below it).
   *
   * Set to `[]` to restore the legacy behaviour (trailing node after lists too).
   * @default ['list']
   */
  notAfterGroups: string[];
}

const trailingNodeKey = new PluginKey('trailingNode');

export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
      notAfterGroups: ['list'],
    };
  },

  addProseMirrorPlugins(): Plugin[] {
    const { node: nodeName, notAfter, notAfterGroups } = this.options;
    const ignoredNames = new Set([...notAfter, nodeName]);
    const ignoredGroups = new Set(notAfterGroups);
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
            triggerTypes = Object.values(schema.nodes).filter((n) => {
              if (ignoredNames.has(n.name)) return false;
              const groups = (n.spec.group ?? '').split(/\s+/).filter(Boolean);
              return !groups.some((g) => ignoredGroups.has(g));
            });
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
