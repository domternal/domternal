import type { Element, Nodes, Root } from 'hast';
import type { PasteDestinationFeature } from './destinationDemand.js';

/** Every heading level a destination can be asked about; entry `level - 1` names `level`. */
export const HEADING_LEVEL_FEATURES: readonly PasteDestinationFeature[] = Object.freeze([
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
]);

/** The places where a destination may parse a heading as the enclosing block's text, see HeadingPlacement. */
export const HEADING_TEXT_FEATURES: readonly PasteDestinationFeature[] = Object.freeze([
  'heading-text-at-list-item-start', 'heading-text-in-summary', 'heading-text-in-preformatted',
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

/**
 * Whether a node before a heading gives its list item the paragraph it must start with, as Core
 * judges it: text the editor reads, or a paragraph element, even an empty one.
 */
function givesLabel(node: Nodes): boolean {
  if (node.type === 'text') return /\S/.test(node.value);
  if (node.type !== 'element' || UNREAD.has(node.tagName)) return false;
  if (node.tagName === 'p') return true;
  const pending: Nodes[] = [...node.children];
  for (let child = pending.pop(); child !== undefined; child = pending.pop()) {
    if (child.type === 'text' && /\S/.test(child.value)) return true;
    if (child.type === 'element' && !UNREAD.has(child.tagName)) {
      if (child.tagName === 'p') return true;
      pending.push(...child.children);
    }
  }
  return false;
}

/**
 * Where the destination keeps a heading that Core's Heading would otherwise parse as the
 * enclosing block's text: at the start of a list item, in a summary, in a preformatted block. It
 * does where its schema lacks that block or the block can start with a heading. Without a
 * destination, as for the standalone HTML entry, it keeps none, as Core decides without a schema.
 */
export interface HeadingPlacement {
  readonly listItemStart: boolean;
  readonly summary: boolean;
  readonly preformatted: boolean;
}

const KEEPS_NONE: HeadingPlacement = Object.freeze({ listItemStart: false, summary: false, preformatted: false });

/**
 * Whether a heading sits where Core's Heading cannot place one, and parses it as that block's
 * text instead: inside a summary or a preformatted block, or at the start of its list item with
 * no text and no paragraph element before it. The same rule as Core's `headingCannotStand`, over
 * the cleaned tree, since this bundle must not import Core. `parents` maps each node of the walk
 * to its parent.
 */
function headingCannotStand(heading: Element, parents: ReadonlyMap<Nodes, Element | Root>, placement: () => HeadingPlacement): boolean {
  let inline: Element | undefined;
  let item: Element | undefined;
  for (let parent = parents.get(heading); parent?.type === 'element'; parent = parents.get(parent)) {
    if (inline === undefined && (parent.tagName === 'summary' || parent.tagName === 'pre')) inline = parent;
    if (item === undefined && ['li', 'td', 'th', 'blockquote', 'details'].includes(parent.tagName)) item = parent;
  }
  if (inline !== undefined && !(inline.tagName === 'summary' ? placement().summary : placement().preformatted)) return true;
  if (item?.tagName !== 'li' || placement().listItemStart) return false;
  for (let node: Nodes = heading; node !== item;) {
    const parent = parents.get(node);
    if (parent === undefined) return false;
    for (const sibling of parent.children.slice(0, parent.children.indexOf(node as never))) {
      if (givesLabel(sibling)) return false;
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
export function adaptHeadingLevels(
  tree: Root, supported: readonly number[], adapted: (node: Element) => void, placement: () => HeadingPlacement = () => KEEPS_NONE,
): boolean[] {
  const outline: boolean[] = [];
  if (supported.length === 0) return outline;
  // The destination is asked once, and only for a heading inside a list item, summary or preformatted block.
  let asked: HeadingPlacement | undefined;
  const where = (): HeadingPlacement => (asked ??= placement());
  const parents = new Map<Nodes, Element | Root>();
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'element') {
      const level = Number(headingTag.exec(node.tagName)?.[1]);
      if (level > 0 && !headingCannotStand(node, parents, where)) {
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
