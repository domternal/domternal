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
  const node = editor.view.domAtPos(position).node as HTMLElement;
  return node.offsetParent !== null;
};
