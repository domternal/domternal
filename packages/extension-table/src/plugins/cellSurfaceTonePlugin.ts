/**
 * Cell surface tone.
 *
 * Marks each table cell that draws its own background with the tone of that
 * background, as `data-dm-tone` (light or dark, and mid for a mid tone, see
 * `surfaceToneAttributes` in core). The theme draws text without a color of
 * its own in black or white on it, and links, code and quotes there in the
 * palette of that background. The attribute is a node decoration, so it lives
 * in the editor view only: getHTML, generateHTML, clipboard HTML and stored
 * content never carry it.
 *
 * The set is rebuilt when the document changes, from a walk over block nodes
 * that never enters a textblock. Rebuilding rather than mapping is what an
 * attribute step needs: a changed cell background moves no position.
 */
import { surfaceToneAttributes } from '@domternal/core';
import type { Node as PMNode } from '@domternal/pm/model';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';

export const cellSurfaceToneKey = new PluginKey<DecorationSet>('cellSurfaceTone');

/** One node decoration per cell whose own background has a tone. */
export function cellSurfaceTones(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    const role = node.type.spec['tableRole'] as string | undefined;
    if (role === 'cell' || role === 'header_cell') {
      const tone = surfaceToneAttributes(node.attrs['background']);
      if (tone) decorations.push(Decoration.node(pos, pos + node.nodeSize, tone));
    }
    return true;
  });
  return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, decorations);
}

export function createCellSurfaceTonePlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: cellSurfaceToneKey,
    state: {
      init: (_config, state) => cellSurfaceTones(state.doc),
      apply: (tr, set) => (tr.docChanged ? cellSurfaceTones(tr.doc) : set),
    },
    props: {
      decorations: (state) => cellSurfaceToneKey.getState(state),
    },
  });
}
