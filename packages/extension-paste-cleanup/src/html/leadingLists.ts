import type { Element, Root } from 'hast';

const LISTS = new Set(['ul', 'ol']);

/**
 * Gives a list whose content starts with lists, before any item, an item that holds them. A partial
 * Google Docs selection that starts in a nested item is expected to write the nested list directly in
 * its parent list (authored HTML, not a native capture). ProseMirror's parse moves a list written
 * after an item into that item, but one written first closes the parent list: the items after it then
 * land in a list of their own, a bullet list even when the parent was numbered. In an item, which
 * labelListItems then gives an empty paragraph first, the nested list stays in its parent list under
 * an empty first item.
 */
export function nestLeadingLists(tree: Root): void {
  const pending: (Root | Element)[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const child of node.children) if (child.type === 'element') pending.push(child);
    // A task list's items carry their checked state, which an added item would have to invent.
    if (node.type !== 'element' || !LISTS.has(node.tagName) || node.properties.dataType === 'taskList') continue;
    let end = 0;
    let lists = 0;
    for (const child of node.children) {
      if (child.type === 'element' && !LISTS.has(child.tagName)) break;
      if (child.type === 'element') lists++;
      end++;
    }
    if (lists === 0) continue;
    const item: Element = { type: 'element', tagName: 'li', properties: {}, children: node.children.slice(0, end) };
    node.children = [item, ...node.children.slice(end)];
  }
}
