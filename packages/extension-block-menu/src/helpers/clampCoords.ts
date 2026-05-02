/**
 * Clamp a (clientX, clientY) pair into the editor's content rectangle
 * so position resolution still works when the cursor is in the side
 * gutter (where the block handle visually lives) or above/below the
 * first/last block.
 *
 * The clamp targets `view.dom.firstElementChild`'s left/right edges
 * (the actual content rect) rather than `view.dom`'s padded box, so
 * a wide editor with `padding-left: 4rem` still anchors X clamps to
 * where text actually lives.
 *
 * Y is only clamped when the cursor is OUTSIDE the editor's vertical
 * span (above the first block or below the last block). When the cursor
 * is INSIDE the editor's span, Y passes through unchanged - clipping the
 * edges (e.g. 5px off the bottom) would otherwise hide thin nested blocks
 * like a 2px-tall horizontal rule that sits at the very bottom of the
 * last top-level container. The `inset` only applies when the cursor is
 * out-of-bounds, snapping it just-inside the content edge.
 *
 * Returns `null` for an empty document - caller should bail out and
 * keep the handle hidden.
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

  // Out-of-bounds clamp ONLY: cursor inside the editor's vertical span
  // keeps its exact Y so nested elements at the very edge are reachable.
  let clampedY = clientY;
  if (clientY < topRect.top) clampedY = topRect.top + inset;
  else if (clientY > bottomRect.bottom) clampedY = bottomRect.bottom - inset;

  // Use the first block's horizontal extent as the "content row" to clamp
  // X into. Multi-column layouts where blocks have wildly different widths
  // are not supported here; for our schema (linear blocks of uniform width)
  // this is sufficient.
  const minX = topRect.left + inset;
  const maxX = topRect.right - inset;
  const clampedX = Math.max(minX, Math.min(clientX, maxX));

  return { x: clampedX, y: clampedY };
}
