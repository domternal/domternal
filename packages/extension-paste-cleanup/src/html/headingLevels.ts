import type { Element, Nodes, Root } from 'hast';
import type { PasteDestinationFeature } from './destinationDemand.js';

/** Every heading level a destination can be asked about; entry `level - 1` names `level`. */
export const HEADING_LEVEL_FEATURES: readonly PasteDestinationFeature[] = Object.freeze([
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
]);

/**
 * The supported level that keeps a heading's place in the outline: the nearest level of equal or
 * lower importance, otherwise the deepest supported level. A heading is never promoted while a
 * deeper level exists, and the order of outline levels is kept. Core's Heading renders and loads
 * a stored level its configuration lacks by the same rule, in its own copy, since this bundle must
 * not import Core.
 */
export function nearestHeadingLevel(level: number, supported: readonly number[]): number | undefined {
  let deeper: number | undefined;
  let deepest: number | undefined;
  for (const candidate of supported) {
    if (candidate >= level && (deeper === undefined || candidate < deeper)) deeper = candidate;
    if (deepest === undefined || candidate > deepest) deepest = candidate;
  }
  return deeper ?? deepest;
}

const headingTag = /^h([1-6])$/;

/**
 * Whether each heading element of a cleaned fragment, in document order, was renamed to a
 * supported level. The editor compares it with the headings a paste inserted, so it reports a
 * renamed heading only when that heading reached the document as one.
 */
export type HeadingOutline = readonly boolean[];

const outlines = new WeakMap<object, HeadingOutline>();

/** The heading outline recorded for a normalization result that renamed a heading. */
export function headingOutline(result: object | undefined): HeadingOutline | undefined {
  return result === undefined ? undefined : outlines.get(result);
}

/** Gives a result derived from a normalization, such as a copy with materialized images, its outline. */
export function copyHeadingOutline(from: object, to: object): void {
  const outline = outlines.get(from);
  if (outline !== undefined) outlines.set(to, outline);
}

/** Records the outline of a normalization result; only one that renamed a heading needs it. */
export function recordHeadingOutline(result: object, outline: readonly boolean[]): void {
  if (outline.includes(true)) outlines.set(result, Object.freeze([...outline]));
}

// Elements whose text a browser's parser never reads into the document.
const UNREAD = new Set(['head', 'noscript', 'object', 'script', 'style', 'template', 'title']);

/** Whether a node holds text the editor reads, as Core judges a node before a heading in a list item. */
function holdsText(node: Nodes): boolean {
  if (node.type === 'text') return /\S/.test(node.value);
  if (node.type !== 'element' || UNREAD.has(node.tagName)) return false;
  const pending: Nodes[] = [...node.children];
  for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
    if (child.type === 'text' && /\S/.test(child.value)) return true;
    if (child.type === 'element') pending.push(...child.children);
  }
  return false;
}

/**
 * Whether a heading sits where Core's Heading cannot place one, and parses it as that block's
 * text instead: inside a summary or a preformatted block, or before any text of its list item.
 * The same rule as Core's `headingCannotStand`, over the cleaned tree, since this bundle must not
 * import Core. `parents` maps each node of the walk to its parent.
 */
function headingCannotStand(heading: Element, parents: ReadonlyMap<Nodes, Element | Root>): boolean {
  let item: Element | undefined;
  for (let parent = parents.get(heading); parent?.type === 'element'; parent = parents.get(parent)) {
    if (parent.tagName === 'summary' || parent.tagName === 'pre') return true;
    if (item === undefined && ['li', 'td', 'th', 'blockquote', 'details'].includes(parent.tagName)) item = parent;
  }
  if (item?.tagName !== 'li') return false;
  for (let node: Nodes = heading; node !== item;) {
    const parent = parents.get(node);
    if (parent === undefined) return false;
    for (const sibling of parent.children.slice(0, parent.children.indexOf(node as never))) {
      if (holdsText(sibling)) return false;
    }
    node = parent;
  }
  return true;
}

/**
 * Rename every heading element whose level is not supported to its nearest supported level, in
 * document order, keeping its properties and children, and report each renamed element once.
 * A heading where one cannot stand, such as at the start of a list item, is left alone and left
 * out of the outline: the editor parses it as that block's text, whatever its level. Returns the
 * heading outline. Without a supported level the tree stays as it is and the outline is empty.
 * The walk is iterative, so it holds for any depth the tree bounds admit.
 */
export function adaptHeadingLevels(tree: Root, supported: readonly number[], adapted: (node: Element) => void): boolean[] {
  const outline: boolean[] = [];
  if (supported.length === 0) return outline;
  const parents = new Map<Nodes, Element | Root>();
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'element') {
      const level = Number(headingTag.exec(node.tagName)?.[1]);
      if (level > 0 && !headingCannotStand(node, parents)) {
        const unsupported = !supported.includes(level);
        outline.push(unsupported);
        if (unsupported) {
          node.tagName = `h${String(nearestHeadingLevel(level, supported))}`;
          adapted(node);
        }
      }
    }
    if (!('children' in node)) continue;
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index];
      if (child === undefined) continue;
      parents.set(child, node);
      pending.push(child);
    }
  }
  return outline;
}
