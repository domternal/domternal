/**
 * Clamp a (clientX, clientY) pair into the editor's content rect so position
 * resolution still works when the cursor is in the side gutter (where the handle
 * lives) or above/below the first/last block.
 *
 * X clamps to `view.dom.firstElementChild`'s edges (the actual content rect),
 * not `view.dom`'s padded box, so a wide editor with `padding-left: 4rem` still
 * anchors to where text lives.
 *
 * Y is clamped only when the cursor is OUTSIDE the editor's vertical span; inside
 * it passes through unchanged, else clipping the edges would hide thin nested
 * blocks like a 2px-tall hr at the very bottom. The `inset` snaps an
 * out-of-bounds cursor just inside the content edge.
 *
 * Returns `null` for an empty document (caller bails and hides the handle).
 */
import type { EditorView } from '@domternal/pm/view';

const DEFAULT_INSET_PX = 5;

export function clampToContent(
  view: EditorView,
  clientX: number,
  clientY: number,
  inset: number = DEFAULT_INSET_PX,
): { x: number; y: number } | null {
  const first = view.dom.firstElementChild;
  const last = view.dom.lastElementChild;
  if (!first || !last) return null;

  const topRect = first.getBoundingClientRect();
  const bottomRect = last.getBoundingClientRect();

  // Out-of-bounds clamp ONLY: a cursor inside the vertical span keeps its exact
  // Y so nested elements at the very edge stay reachable.
  let clampedY = clientY;
  if (clientY < topRect.top) clampedY = topRect.top + inset;
  else if (clientY > bottomRect.bottom) clampedY = bottomRect.bottom - inset;

  // Clamp X into the first block's horizontal extent. Multi-column layouts with
  // varied widths aren't supported; fine for our linear, uniform-width schema.
  const minX = topRect.left + inset;
  const maxX = topRect.right - inset;
  const clampedX = Math.max(minX, Math.min(clientX, maxX));

  return { x: clampedX, y: clampedY };
}
