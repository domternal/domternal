/**
 * Get the default block type at a given content match position
 *
 * Finds the first textblock type that can be created without required attributes.
 * Useful for creating new empty blocks (e.g., paragraph after details).
 *
 * @example
 * const type = defaultBlockAt(parent.contentMatchAt(index));
 * if (type) {
 *   const node = type.createAndFill();
 * }
 */
import type { ContentMatch, NodeType } from 'prosemirror-model';

export const defaultBlockAt = (match: ContentMatch): NodeType | null => {
  for (let i = 0; i < match.edgeCount; i++) {
    const { type } = match.edge(i);

    if (type.isTextblock && !type.hasRequiredAttrs()) {
      return type;
    }
  }

  return null;
};
