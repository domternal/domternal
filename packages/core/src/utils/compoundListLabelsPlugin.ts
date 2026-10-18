import type { Node as PMNode } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import { COMPOUND_MARKER_ATTRIBUTE, visitCompoundListLabels } from './compoundListLabels.js';

function decorations(doc: PMNode): DecorationSet {
  const values: Decoration[] = [];
  visitCompoundListLabels(doc, (node, position, text) => {
    values.push(Decoration.node(position, position + node.nodeSize, { [COMPOUND_MARKER_ATTRIBUTE]: text }));
  });
  return DecorationSet.create(doc, values);
}

/** Counters are presentation, so a change never creates a second history or collaboration transaction. */
export function compoundListLabelsPlugin(): Plugin<DecorationSet> {
  const plugin = new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => decorations(state.doc),
      apply: (transaction, previous) => transaction.docChanged ? decorations(transaction.doc) : previous,
    },
    props: { decorations: (state): DecorationSet | undefined => plugin.getState(state) },
  });
  return plugin;
}
