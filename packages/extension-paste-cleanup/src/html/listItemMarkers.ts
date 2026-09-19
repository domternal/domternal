import type { Element, Root } from 'hast';
import { listStyleFromType, validListStyle } from './listStyles.js';

/** The value of the last list-style-type declaration, lowercased, and every other declaration in order. */
function splitMarker(style: unknown): { marker: string | undefined; rest: string[] } {
  let marker: string | undefined;
  const rest: string[] = [];
  if (typeof style !== 'string') return { marker, rest };
  for (const declaration of style.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator >= 0 && declaration.slice(0, separator).trim().toLowerCase() === 'list-style-type') {
      marker = declaration.slice(separator + 1).trim().toLowerCase();
    } else if (declaration.trim() !== '') rest.push(declaration.trim());
  }
  return { marker, rest };
}

function hoist(list: Element): void {
  const tag = list.tagName;
  const items = list.children.filter((child): child is Element => child.type === 'element' && child.tagName === 'li');
  const own = splitMarker(list.properties.style);
  // CSS precedence: an item's own marker, then the list's style, then its HTML type. A list
  // marker the vocabulary cannot hold leaves nothing to stand in for an item without one.
  const inherited = own.marker ?? listStyleFromType(tag, list.properties.type);
  let agreed: string | undefined;
  let declared = false;
  for (const item of items) {
    const { marker } = splitMarker(item.properties.style);
    declared ||= marker !== undefined;
    const effective = marker ?? inherited;
    if (!validListStyle(tag, effective) || (agreed !== undefined && effective !== agreed)) return;
    agreed = effective;
  }
  if (!declared || agreed === undefined) return;
  for (const item of items) {
    const { marker, rest } = splitMarker(item.properties.style);
    if (marker === undefined) continue;
    if (rest.length > 0) item.properties.style = rest.join(';');
    else delete item.properties.style;
  }
  list.properties.style = [...own.rest, `list-style-type:${agreed}`].join(';');
}

/**
 * Move a list-style-type that every direct item of a list declares, or takes from its list, to the list.
 * An item's marker takes precedence over its list's in CSS, so the rendered markers do not change. This is
 * the shape Google Docs is expected to write, checked against authored HTML, not native captures. Lists
 * whose items disagree or hold a marker their kind cannot represent are left for the item report, and
 * task lists never keep a marker.
 */
export function hoistListItemMarkers(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol') && node.properties.dataType !== 'taskList') hoist(node);
  }
}
