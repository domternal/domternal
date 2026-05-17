import type { Editor } from '@domternal/core';

function resolveElementAtCursor(editor: Editor): HTMLElement | null {
  const { from } = editor.state.selection;
  const { node } = editor.view.domAtPos(from);
  return node instanceof HTMLElement ? node : node.parentElement;
}

/**
 * Read a CSS property at the current cursor position.
 * Prefers inline style, falls back to computed style. Used by dropdowns
 * with `computedStyleProperty` (e.g. font-size) to show the current value
 * in their trigger label.
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
 * Read ONLY inline style at the current cursor position (skips browser-default
 * computed inheritance). Used for `font-family` where computed value includes
 * the document's default fallback that would override any user-set font in the
 * toolbar's "current font" indicator.
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
