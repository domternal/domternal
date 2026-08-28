import { DOMParser } from '@domternal/pm/model';
import type { Node as PMNode, Schema } from '@domternal/pm/model';

export interface OfficeListCapabilities {
  orderedLists: boolean;
  bulletLists: boolean;
  nestedLists: boolean;
}

type ListKind = 'orderedList' | 'bulletList';
const kinds: ListKind[] = ['orderedList', 'bulletList'];

function paragraphMatches(node: PMNode | null, text: string): boolean {
  return node?.type.name === 'paragraph' && node.textContent === text
    && node.childCount === 1 && node.firstChild?.isText === true;
}

function listMatches(node: PMNode | null, kind: ListKind, text: string): boolean {
  return node?.type.name === kind && (kind !== 'orderedList' || node.attrs['start'] === 7)
    && node.childCount === 1 && node.firstChild?.type.name === 'listItem'
    && paragraphMatches(node.firstChild.firstChild, text);
}

/** Probe actual parse rules and content expressions before removing visible Office markers. */
export function officeListCapabilities(schema: Schema, document: Document): OfficeListCapabilities {
  const parser = DOMParser.fromSchema(schema);
  const accepts = (kind: ListKind, nested?: ListKind): boolean => {
    try {
      const tag = kind === 'orderedList' ? 'ol' : 'ul';
      const nestedTag = nested === 'orderedList' ? 'ol' : 'ul';
      const child = nested === undefined ? ''
        : `<${nestedTag} start="7"><li><p>Inner</p></li></${nestedTag}>`;
      const container = document.createElement('div');
      // This constant probe contains no source content or resource references.
      container.innerHTML = `<${tag} start="7"><li><p>Outer</p>${child}</li></${tag}>`;
      const slice = parser.parseSlice(container);
      if (slice.content.childCount !== 1) return false;
      const list = slice.content.firstChild;
      if (!listMatches(list, kind, 'Outer')) return false;
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
  const orderedLists = accepts('orderedList');
  const bulletLists = accepts('bulletList');
  const available = kinds.filter(kind => kind === 'orderedList' ? orderedLists : bulletLists);
  return {
    orderedLists,
    bulletLists,
    nestedLists: available.length > 0 && available.every(outer => available.every(inner => accepts(outer, inner))),
  };
}
