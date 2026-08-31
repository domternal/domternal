import { Plugin } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import { forEachUnknownListMarker } from './listMarker.js';

/** Rebuilds only the nodes on the way to an unknown marker, which becomes null. */
function dropUnknownListMarkers(fragment: Fragment): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach(node => {
    let attrs = node.attrs;
    forEachUnknownListMarker(node.type.schema, node.type.name, attrs, attribute => { attrs = { ...attrs, [attribute]: null }; });
    const content = dropUnknownListMarkers(node.content);
    nodes.push(attrs === node.attrs && content === node.content ? node : node.type.create(attrs, content, node.marks));
  });
  return nodes.some((node, index) => node !== fragment.child(index)) ? Fragment.from(nodes) : fragment;
}

/**
 * Clipboard HTML from a ProseMirror editor carries its wrapper nodes as
 * data-pm-slice context, which prosemirror-view rebuilds without attribute
 * validation. An unknown marker there would reach the document and then its
 * saved JSON, so a pasted or dropped slice gets the default marker instead.
 */
export function pastedListMarkersPlugin(): Plugin {
  return new Plugin({
    props: {
      transformPasted: slice => {
        const content = dropUnknownListMarkers(slice.content);
        return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
      },
    },
  });
}
