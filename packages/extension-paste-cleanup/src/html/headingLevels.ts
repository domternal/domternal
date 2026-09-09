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

/**
 * Rename every heading element whose level is not supported to its nearest supported level, in
 * document order, keeping its properties and children, and report each renamed element once.
 * Returns the heading outline. Without a supported level the tree stays as it is and the outline
 * is empty. The walk is iterative, so it holds for any depth the tree bounds admit.
 */
export function adaptHeadingLevels(tree: Root, supported: readonly number[], adapted: (node: Element) => void): boolean[] {
  const outline: boolean[] = [];
  if (supported.length === 0) return outline;
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'element') {
      const level = Number(headingTag.exec(node.tagName)?.[1]);
      if (level > 0) {
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
      if (child !== undefined) pending.push(child);
    }
  }
  return outline;
}
