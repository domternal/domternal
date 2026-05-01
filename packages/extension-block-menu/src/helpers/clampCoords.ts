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

  const minY = topRect.top + inset;
  const maxY = bottomRect.bottom - inset;
  const clampedY = Math.max(minY, Math.min(clientY, maxY));

  // Use the first block's horizontal extent as the "content row" to clamp
  // X into. Multi-column layouts where blocks have wildly different widths
  // are not supported here; for our schema (linear blocks of uniform width)
  // this is sufficient.
  const minX = topRect.left + inset;
  const maxX = topRect.right - inset;
  const clampedX = Math.max(minX, Math.min(clientX, maxX));

  return { x: clampedX, y: clampedY };
}
