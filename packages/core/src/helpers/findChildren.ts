/**
 * Find all children of a node matching a predicate
 *
 * @example
 * const summaries = findChildren(detailsNode, node => node.type.name === 'detailsSummary');
 */
import type { Node as PMNode } from 'prosemirror-model';

export interface FindChildResult {
  node: PMNode;
  pos: number;
}

export const findChildren = (
  node: PMNode,
  predicate: (node: PMNode) => boolean,
): FindChildResult[] => {
  const result: FindChildResult[] = [];

  node.forEach((child, offset) => {
    if (predicate(child)) {
      result.push({ node: child, pos: offset });
    }
  });

  return result;
};
