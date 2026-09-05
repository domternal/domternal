import { Plugin } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import type { ContentDiagnostic } from '../types/Content.js';
import { forEachNormalizedAttribute } from './normalizedAttributes.js';

/** Rebuilds only the nodes on the way to an invalid value, which gets its replacement. */
function replaceInvalidValues(fragment: Fragment, code: ContentDiagnostic['code']): Fragment {
  const nodes: PMNode[] = [];
  fragment.forEach(node => {
    let attrs = node.attrs;
    forEachNormalizedAttribute(node.type.schema, node.type.name, attrs, 'invalid', (attribute, value, normalizer) => {
      attrs = { ...attrs, [attribute]: normalizer.replacement(value) };
    }, code);
    const content = replaceInvalidValues(node.content, code);
    nodes.push(attrs === node.attrs && content === node.content ? node : node.type.create(attrs, content, node.marks));
  });
  return nodes.some((node, index) => node !== fragment.child(index)) ? Fragment.from(nodes) : fragment;
}

/**
 * Clipboard HTML from a ProseMirror editor carries its wrapper nodes as
 * data-pm-slice context, which prosemirror-view rebuilds without attribute
 * validation. An invalid value there would reach the document and then its
 * saved JSON, so a pasted or dropped slice gets the replacement instead. Only
 * values validation rejects are replaced: a valid value this configuration
 * does not support stays, so moving content inside a shared document never
 * rewrites what another client wrote. Each guard covers the attributes that
 * report `code`, so the extension that brings them registers it.
 */
export function pastedAttributesPlugin(code: ContentDiagnostic['code']): Plugin {
  return new Plugin({
    props: {
      transformPasted: slice => {
        const content = replaceInvalidValues(slice.content, code);
        return content === slice.content ? slice : new Slice(content, slice.openStart, slice.openEnd);
      },
    },
  });
}
