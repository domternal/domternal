/**
 * Find the closest visible ancestor node matching a predicate.
 * Walks up from $pos, checking both the predicate and DOM visibility.
 */
import type { Node as PMNode, ResolvedPos } from '@domternal/pm/model';
import { isNodeVisible } from './isNodeVisible.js';

interface EditorLike {
  readonly view: {
    domAtPos(pos: number): { node: Node; offset: number };
  };
}

export const findClosestVisibleNode = (
  $pos: ResolvedPos,
  predicate: (node: PMNode) => boolean,
  editor: EditorLike,
):
  | {
      pos: number;
      start: number;
      depth: number;
      node: PMNode;
    }
  | undefined => {
  for (let i = $pos.depth; i > 0; i--) {
    const node = $pos.node(i);
    const match = predicate(node);
    const visible = isNodeVisible($pos.start(i), editor);

    if (match && visible) {
      return {
        pos: i > 0 ? $pos.before(i) : 0,
        start: $pos.start(i),
        depth: i,
        node,
      };
    }
  }

  return undefined;
};
