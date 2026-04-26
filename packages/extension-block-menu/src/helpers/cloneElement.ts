/**
 * Build an off-screen styled clone of `source` suitable for use as an
 * HTML5 `setDragImage` thumbnail. Browsers snapshot the element passed
 * to `setDragImage` AS IS, so passing the live DOM node inherits any
 * ambient `transform`, scroll offset, or clipping from its ancestors,
 * and the snapshot loses styles that depend on pseudo-classes or
 * ancestors that don't follow into the detached clone.
 *
 * The workaround — borrowed from Tiptap's `@tiptap/extension-drag-handle`
 * — is to `cloneNode(true)` and then walk every descendant copying the
 * computed `cssText` onto the clone's inline `style`. That freezes the
 * rendered appearance into the clone so the browser can paint a crisp,
 * detached preview. The clone lives inside a wrapper positioned far
 * off-screen (`top: -10000px`); the caller is responsible for removing
 * the wrapper on `dragend`/`drop`.
 *
 * Returns the wrapper so the caller can pass `{ wrapper, offsetX }` to
 * `dataTransfer.setDragImage(wrapper, offsetX, 0)`.
 */
export function buildDragPreview(source: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.position = 'absolute';
  wrapper.style.top = '-10000px';
  wrapper.style.left = '-10000px';
  wrapper.style.pointerEvents = 'none';
  // Match the source's visible width so Chrome doesn't stretch the
  // preview. `offsetWidth` ignores transforms, which is what we want.
  const sourceRect = source.getBoundingClientRect();
  wrapper.style.width = `${String(sourceRect.width)}px`;

  const clone = source.cloneNode(true) as HTMLElement;
  copyComputedStyles(source, clone);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return wrapper;
}

/**
 * Recursively copy `cssText` from `src` into `dst`'s inline `style`.
 * Pseudo-elements and `::before`/`::after` content are not handled —
 * they rarely matter for a drag thumbnail and would balloon the clone.
 */
function copyComputedStyles(src: Element, dst: Element): void {
  if (src instanceof HTMLElement && dst instanceof HTMLElement) {
    const cs = getComputedStyle(src);
    dst.style.cssText = cs.cssText;
  }
  const srcChildren = src.children;
  const dstChildren = dst.children;
  const len = Math.min(srcChildren.length, dstChildren.length);
  for (let i = 0; i < len; i++) {
    const s = srcChildren.item(i);
    const d = dstChildren.item(i);
    if (s && d) copyComputedStyles(s, d);
  }
}
