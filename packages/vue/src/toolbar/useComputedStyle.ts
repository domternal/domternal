import type { Editor } from '@domternal/core';

/**
 * Reads a CSS property at the current cursor position.
 * Prefers inline style, falls back to computed style.
 */
export function getComputedStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const { from } = editor.state.selection;
    const domAtPos = editor.view.domAtPos(from);
    let node = domAtPos.node;
    if (!(node instanceof HTMLElement)) {
      node = (node as Node).parentElement as HTMLElement;
    }
    if (!node) return null;

    const el = node as HTMLElement;
    const inline = el.style.getPropertyValue(prop);
    if (inline) return inline;

    return window.getComputedStyle(el).getPropertyValue(prop) || null;
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
    let node = domAtPos.node;
    if (!(node instanceof HTMLElement)) {
      node = (node as Node).parentElement as HTMLElement;
    }
    if (!node) return null;

    return (node as HTMLElement).style.getPropertyValue(prop) || null;
  } catch {
    return null;
  }
}
