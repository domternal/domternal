/**
 * Find the closest parent node matching a predicate
 *
 * Returns a curried function: findParentNode(predicate)(selection)
 *
 * @example
 * const details = findParentNode(node => node.type.name === 'details')(selection);
 * if (details) {
 *   console.log(details.pos, details.node);
 * }
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { Selection } from 'prosemirror-state';

export interface FindParentNodeResult {
  pos: number;
  start: number;
  depth: number;
  node: PMNode;
}

export const findParentNode =
  (predicate: (node: PMNode) => boolean) =>
  (selection: Selection): FindParentNodeResult | undefined => {
    const { $from } = selection;

    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);

      if (predicate(node)) {
        return {
          pos: $from.before(depth),
          start: $from.start(depth),
          depth,
          node,
        };
      }
    }

    return undefined;
  };
