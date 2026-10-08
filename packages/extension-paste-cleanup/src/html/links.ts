import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { PasteDestinationFeature } from './destinationDemand.js';

/** The destination features of the link schemes a sanitized link can have. */
export const LINK_FEATURES: readonly PasteDestinationFeature[] = Object.freeze(['link-http', 'link-https', 'link-mailto', 'link-tel']);

const schemeFeatures: Readonly<Record<string, PasteDestinationFeature>> = {
  'http:': 'link-http', 'https:': 'link-https', 'mailto:': 'link-mailto', 'tel:': 'link-tel',
};

/** The destination feature a sanitized href needs, by its scheme. */
export function linkFeature(href: unknown): PasteDestinationFeature | undefined {
  if (typeof href !== 'string') return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(href)?.[1]?.toLowerCase();
  return scheme !== undefined && Object.hasOwn(schemeFeatures, scheme) ? schemeFeatures[scheme] : undefined;
}

/**
 * Replaces every link whose scheme the destination lacks with its content,
 * reporting each one. The walk is iterative, so the admitted tree depth bounds
 * the retained state rather than the call stack.
 */
export function unwrapLinks(tree: Root, refused: readonly PasteDestinationFeature[], removed: (link: Element) => void): void {
  const parents: (Root | Element)[] = [tree];
  for (let parent = parents.pop(); parent !== undefined; parent = parents.pop()) {
    const children: RootContent[] = [];
    const pending: RootContent[] = [...parent.children].reverse();
    for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
      if (child.type === 'element' && child.tagName === 'a') {
        const feature = linkFeature(child.properties.href);
        if (feature !== undefined && refused.includes(feature)) {
          removed(child);
          for (let index = child.children.length - 1; index >= 0; index--) {
            const content = child.children[index];
            if (content !== undefined) pending.push(content);
          }
          continue;
        }
      }
      children.push(child);
      if (child.type === 'element') parents.push(child);
    }
    if (parent.type === 'root') parent.children = children;
    else parent.children = children as ElementContent[];
  }
}
