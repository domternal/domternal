/**
 * Check if a node at a given position is visible in the DOM.
 * Uses offsetParent to detect hidden elements (e.g., collapsed details content).
 */
interface EditorLike {
  readonly view: {
    domAtPos(pos: number): { node: Node; offset: number };
  };
}

export const isNodeVisible = (position: number, editor: EditorLike): boolean => {
  let node: Node | null = editor.view.domAtPos(position).node;
  // Walk up from text nodes to the nearest HTMLElement (text nodes lack offsetParent)
  while (node && !(node instanceof HTMLElement)) {
    node = node.parentNode;
  }
  if (!node) return false;
  return node.offsetParent !== null;
};
