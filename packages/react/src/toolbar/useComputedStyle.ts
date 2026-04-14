import type { Editor } from '@domternal/core';

/**
 * Read a CSS property value at the current cursor position.
 * Prefers inline style (explicit mark) over computed style (inherited).
 */
export function getComputedStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const { from } = editor.state.selection;
    const resolved = editor.view.domAtPos(from);
    const el = resolved.node instanceof HTMLElement
      ? resolved.node
      : resolved.node.parentElement;
    if (!el) return null;
    return el.style.getPropertyValue(prop)
      || window.getComputedStyle(el).getPropertyValue(prop)
      || null;
  } catch {
    return null;
  }
}

/**
 * Read only inline style at the current cursor position (no computed fallback).
 * Used for font-family to avoid reading browser default inheritance.
 */
export function getInlineStyleAtCursor(editor: Editor, prop: string): string | null {
  try {
    const { from } = editor.state.selection;
    const resolved = editor.view.domAtPos(from);
    const el = resolved.node instanceof HTMLElement
      ? resolved.node
      : resolved.node.parentElement;
    if (!el) return null;
    return el.style.getPropertyValue(prop) || null;
  } catch {
    return null;
  }
}
