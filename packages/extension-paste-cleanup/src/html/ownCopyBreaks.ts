import type { Element, Root } from 'hast';

// ProseMirror exempts these inline parents from its terminal BR placeholder rule.
const inlineParents = /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var)$/;

/**
 * A verified own copy comes from document serialization, without editor view placeholders.
 * Protect its actual terminal breaks from the clipboard parser's browser placeholder rule.
 * Foreign HTML cannot establish that distinction and must not use this transformation.
 */
export function retainOwnCopyBreaks(tree: Root): boolean {
  const pending: (Root | Element)[] = [tree];
  let changed = false;
  while (pending.length > 0) {
    const parent = pending.pop();
    if (parent === undefined) break;
    for (const child of parent.children) if (child.type === 'element') pending.push(child);
    if (parent.type === 'element' && inlineParents.test(parent.tagName)) continue;
    const last = parent.children.at(-1);
    if (last?.type !== 'element' || last.tagName !== 'br') continue;
    parent.children[parent.children.length - 1] = { type: 'element', tagName: 'span', properties: {}, children: [last] };
    changed = true;
  }
  return changed;
}
