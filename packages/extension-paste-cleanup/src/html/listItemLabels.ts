import type { Element, Root } from 'hast';
import { firstElement } from './sliceOrigin.js';

const LISTS = new Set(['ul', 'ol']);
const VISIBLE = /[^\t\n\f\r ]/;

/**
 * Gives a list item whose content starts with a list an empty paragraph first, the label a
 * Domternal list or task item starts with. ProseMirror's parse cannot open such an item on its
 * nested list: it closed the item empty, and the nested list and every later item landed in lists
 * of their own, bullets even where the list was numbered. With the label the nested list stays in
 * its item, the shape SmartPaste gives one that starts a pasted slice. The items on the open start
 * of a fragment with a slice marker, as many levels down as its open start counts from the
 * marker's element, are left as written: a copy that starts in a nested item cut their labels, and
 * the marker's open depths count the levels without them.
 */
export function labelListItems(tree: Root, anchor?: { readonly target: Element | undefined; readonly context: string }): void {
  const open = new Set<Element>();
  const depth = Number(/^(\d+) /.exec(anchor?.context ?? '')?.[1] ?? 0);
  for (let node = anchor?.target, level = 1; node !== undefined && level <= depth; node = firstElement(node), level++) {
    if (node.tagName === 'li') open.add(node);
  }
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    if (node.type !== 'element' || node.tagName !== 'li' || open.has(node)) continue;
    const lead = node.children.find(child => child.type === 'element' || (child.type === 'text' && VISIBLE.test(child.value)));
    if (lead?.type === 'element' && LISTS.has(lead.tagName)) node.children.unshift({ type: 'element', tagName: 'p', properties: {}, children: [] });
  }
}
