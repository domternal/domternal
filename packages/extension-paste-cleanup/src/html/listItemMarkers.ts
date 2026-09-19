import type { Element, Root } from 'hast';
import { listStyleFromType, validListStyle } from './listStyles.js';
import { plainDeclarations } from './styles.js';

/**
 * The value of the last list-style-type declaration, lowercased, and every other declaration in order.
 * Undefined for a style CSS may read otherwise, which keeps its markers where they are.
 */
function splitMarker(style: unknown): { marker: string | undefined; rest: string[] } | undefined {
  const declarations = plainDeclarations(style);
  if (declarations === undefined) return undefined;
  let marker: string | undefined;
  const rest: string[] = [];
  for (const [name, value] of declarations) {
    if (name === 'list-style-type') marker = value.toLowerCase();
    else rest.push(`${name}:${value}`);
  }
  return { marker, rest };
}

const listChildren = new Set(['li', 'ul', 'ol']);

function hoist(list: Element): void {
  const tag = list.tagName;
  const items = list.children.filter((child): child is Element => child.type === 'element' && child.tagName === 'li');
  const own = splitMarker(list.properties.style);
  // An item's HTML type outranks its list's marker and cleanup drops it, so an item without a marker of its own keeps its report.
  const markers = items.map(item => {
    const split = splitMarker(item.properties.style);
    return split?.marker === undefined && item.properties.type !== undefined ? undefined : split;
  });
  // Any other element passes the list's marker on to the items it holds, which would then take the moved one.
  if (own === undefined || list.children.some(child => child.type === 'element' && !listChildren.has(child.tagName))) return;
  // CSS precedence: an item's own marker, then the list's style, then its HTML type. A list
  // marker the vocabulary cannot hold leaves nothing to stand in for an item without one.
  const inherited = own.marker ?? listStyleFromType(tag, list.properties.type);
  let agreed: string | undefined;
  let declared = false;
  for (const split of markers) {
    if (split === undefined) return;
    declared ||= split.marker !== undefined;
    const effective = split.marker ?? inherited;
    if (!validListStyle(tag, effective) || (agreed !== undefined && effective !== agreed)) return;
    agreed = effective;
  }
  if (!declared || agreed === undefined) return;
  items.forEach((item, index) => {
    const split = markers[index];
    if (split?.marker === undefined) return;
    if (split.rest.length > 0) item.properties.style = split.rest.join(';');
    else delete item.properties.style;
  });
  list.properties.style = [...own.rest, `list-style-type:${agreed}`].join(';');
}

/**
 * Move a list-style-type that every direct item of a list declares, or takes from its list, to the list.
 * An item's marker takes precedence over its list's in CSS, so the rendered markers do not change. This is
 * the shape Google Docs is expected to write, checked against authored HTML, not native captures. Lists
 * whose items disagree, hold a marker their kind cannot represent, have an HTML type of their own or carry
 * a style CSS may read otherwise, and lists holding other elements, are left for the item report, and task
 * lists never keep a marker.
 */
export function hoistListItemMarkers(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type === 'element' && (node.tagName === 'ul' || node.tagName === 'ol') && node.properties.dataType !== 'taskList') hoist(node);
  }
}
