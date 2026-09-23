import type { Element, Root } from 'hast';
import { firstElement } from './sliceOrigin.js';

const LISTS = new Set(['ul', 'ol']);
const VISIBLE = /[^\t\n\f\r ]/;

/**
 * Gives a list item whose content starts with a list an empty paragraph first, the label a
 * Domternal list or task item starts with. ProseMirror's parse cannot open such an item on its
 * nested list: it closed the item empty, and the nested list and every later item landed in lists
 * of their own, bullets even where the list was numbered. With the label the nested list stays in
 * its item, the shape SmartPaste gives one that starts a pasted slice. The first item of a
 * fragment with a slice marker is left as written, since the marker's open depths count its levels.
 */
export function labelListItems(tree: Root, anchored: boolean): void {
  let first: Element | undefined;
  for (let node = anchored ? firstElement(tree) : undefined; node !== undefined; node = firstElement(node)) {
    if (node.tagName === 'li') { first = node; break; }
  }
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type !== 'element' || node.tagName !== 'li' || node === first) continue;
    const lead = node.children.find(child => child.type === 'element' || (child.type === 'text' && VISIBLE.test(child.value)));
    if (lead?.type === 'element' && LISTS.has(lead.tagName)) node.children.unshift({ type: 'element', tagName: 'p', properties: {}, children: [] });
  }
}
