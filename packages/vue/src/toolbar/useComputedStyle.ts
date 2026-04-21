import type { Editor } from '@domternal/core';

function resolveElementAtCursor(editor: Editor): HTMLElement | null {
  const { from } = editor.state.selection;
  const { node } = editor.view.domAtPos(from);
  return node instanceof HTMLElement ? node : node.parentElement;
}

/**
 * Reads a CSS property at the current cursor position.
 * Prefers inline style, falls back to computed style.
 */
export function getComputedStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const node = resolveElementAtCursor(editor);
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
    const node = resolveElementAtCursor(editor);
    if (!node) return null;

    return node.style.getPropertyValue(prop) || null;
  } catch {
    return null;
  }
}
