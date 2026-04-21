import type { Editor } from '@domternal/core';

/**
 * Reads a CSS property at the current cursor position.
 * Prefers inline style, falls back to computed style.
 */
export function getComputedStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const { from } = editor.state.selection;
    const domAtPos = editor.view.domAtPos(from);
    const startNode: Node | null = domAtPos.node;
    const node: HTMLElement | null = startNode instanceof HTMLElement
      ? startNode
      : startNode.parentElement;
    if (!node) return null;

    const inline = node.style.getPropertyValue(prop);
    if (inline) return inline;

    return window.getComputedStyle(node).getPropertyValue(prop) || null;
  } catch {
    return null;
  }
}

/**
 * Reads only the inline style at the current cursor position.
 * Used for font-family to avoid browser default inheritance.
 */
export function getInlineStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const { from } = editor.state.selection;
    const domAtPos = editor.view.domAtPos(from);
    const startNode: Node | null = domAtPos.node;
    const node: HTMLElement | null = startNode instanceof HTMLElement
      ? startNode
      : startNode.parentElement;
    if (!node) return null;

    return node.style.getPropertyValue(prop) || null;
  } catch {
    return null;
  }
}
