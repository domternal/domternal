import { DOMParser } from '@domternal/pm/model';
import type { Node as PMNode, Schema } from '@domternal/pm/model';

export interface OfficeListCapabilities {
  orderedLists: boolean;
  bulletLists: boolean;
  nestedLists: boolean;
}

type ListKind = 'orderedList' | 'bulletList';
const kinds: ListKind[] = ['orderedList', 'bulletList'];
interface ListProbe { kind: ListKind; marker?: 'decimal' | 'disc' | 'circle' | 'square' }

function paragraphMatches(node: PMNode | null, text: string): boolean {
  return node?.type.name === 'paragraph' && node.textContent === text
    && node.childCount === 1 && node.firstChild?.isText === true;
}

function listMatches(node: PMNode | null, probe: ListProbe, text: string): boolean {
  return node?.type.name === probe.kind && (probe.kind !== 'orderedList' || node.attrs['start'] === 7)
    && (probe.marker === undefined || node.attrs['listStyleType'] === probe.marker)
    && node.childCount === 1 && node.firstChild?.type.name === 'listItem'
    && paragraphMatches(node.firstChild.firstChild, text);
}

/** Probe actual parse rules and content expressions before removing visible Office markers. */
export function officeListCapabilities(schema: Schema, document: Document, options: { preserveMarkers?: boolean } = {}): OfficeListCapabilities {
  const parser = DOMParser.fromSchema(schema);
  // The default remains a structural capability probe for ordinary semantic lists.
  // Removing visible Office labels additionally requires every emitted marker class.
  const probes: ListProbe[] = options.preserveMarkers === true ? [
    { kind: 'orderedList', marker: 'decimal' },
    { kind: 'bulletList', marker: 'disc' }, { kind: 'bulletList', marker: 'circle' }, { kind: 'bulletList', marker: 'square' },
  ] : kinds.map(kind => ({ kind }));
  const markerStyle = (probe: ListProbe): string => probe.marker === undefined ? '' : ` style="list-style-type:${probe.marker}"`;
  const accepts = (probe: ListProbe, nested?: ListProbe): boolean => {
    try {
      const tag = probe.kind === 'orderedList' ? 'ol' : 'ul';
      const nestedTag = nested?.kind === 'orderedList' ? 'ol' : 'ul';
      const child = nested === undefined ? ''
        : `<${nestedTag} start="7"${markerStyle(nested)}><li><p>Inner</p></li></${nestedTag}>`;
      const container = document.createElement('div');
      // This constant probe contains no source content or resource references.
      container.innerHTML = `<${tag} start="7"${markerStyle(probe)}><li><p>Outer</p>${child}</li></${tag}>`;
      const slice = parser.parseSlice(container);
      if (slice.content.childCount !== 1) return false;
      const list = slice.content.firstChild;
      if (!listMatches(list, probe, 'Outer')) return false;
      list?.check();
      const item = list?.firstChild;
      if (nested === undefined) return item?.childCount === 1;
      const inner = item?.lastChild ?? null;
      return item?.childCount === 2 && listMatches(inner, nested, 'Inner')
        && inner?.firstChild?.childCount === 1;
    } catch {
      // A custom parse rule that cannot represent the probe must keep literal markers.
      return false;
    }
  };
  const orderedLists = probes.filter(probe => probe.kind === 'orderedList').every(probe => accepts(probe));
  const bulletLists = probes.filter(probe => probe.kind === 'bulletList').every(probe => accepts(probe));
  const available = probes.filter(probe => probe.kind === 'orderedList' ? orderedLists : bulletLists);
  return {
    orderedLists,
    bulletLists,
    nestedLists: available.length > 0 && available.every(outer => available.every(inner => accepts(outer, inner))),
  };
}
