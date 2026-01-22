/**
 * Check if a ProseMirror node is empty
 */
import type { Node as PMNode } from 'prosemirror-model';

/**
 * Options for isNodeEmpty check
 */
export interface IsNodeEmptyOptions {
  /**
   * Check child nodes recursively
   * @default true
   */
  checkChildren?: boolean;

  /**
   * Ignore hardBreak nodes when checking emptiness
   * @default true
   */
  ignoreHardBreaks?: boolean;
}

/**
 * Checks if a ProseMirror node is considered empty
 *
 * A node is considered empty if:
 * - It has no content (childCount === 0)
 * - It only contains empty child nodes (when checkChildren is true)
 * - It only contains hardBreaks (when ignoreHardBreaks is true)
 *
 * @param node - ProseMirror node to check
 * @param options - Options for emptiness check
 * @returns true if node is empty
 *
 * @example
 * ```ts
 * // Check if document is empty
 * const empty = isNodeEmpty(editor.state.doc);
 *
 * // Check without recursion
 * const empty = isNodeEmpty(node, { checkChildren: false });
 * ```
 */
export function isNodeEmpty(
  node: PMNode,
  options: IsNodeEmptyOptions = {}
): boolean {
  const { checkChildren = true, ignoreHardBreaks = true } = options;

  // Leaf nodes with no content
  if (node.isLeaf) {
    // Text node is empty if it has no text
    if (node.isText) {
      return !node.text || node.text.length === 0;
    }

    // HardBreak is considered "empty" if ignoreHardBreaks is true
    if (ignoreHardBreaks && node.type.name === 'hardBreak') {
      return true;
    }

    // Other leaf nodes (like images, horizontal rules) are not empty
    return false;
  }

  // No children = empty
  if (node.childCount === 0) {
    return true;
  }

  // If not checking children, has children = not empty
  if (!checkChildren) {
    return false;
  }

  // Check all children recursively
  let isEmpty = true;
  node.forEach((child) => {
    if (!isNodeEmpty(child, options)) {
      isEmpty = false;
    }
  });

  return isEmpty;
}

/**
 * Checks if a document node is empty
 *
 * Convenience wrapper for isNodeEmpty with document-specific defaults.
 * A document is empty if it only contains empty paragraphs or no content.
 *
 * @param doc - Document node to check
 * @returns true if document is empty
 */
export function isDocumentEmpty(doc: PMNode): boolean {
  return isNodeEmpty(doc, {
    checkChildren: true,
    ignoreHardBreaks: true,
  });
}
