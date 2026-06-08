/**
 * Build an off-screen "ghost" of a block for HTML5 `dataTransfer.setDragImage`.
 *
 * The browser snapshots the passed element at call time with ambient transforms,
 * scroll offsets, and ancestor clipping; inherited styles that don't survive a
 * detached clone are lost. Workaround: deep-clone the node, then copy each
 * element's resolved `getComputedStyle().cssText` onto its clone's inline style,
 * so it paints identically when detached. The clone sits in an absolutely
 * positioned wrapper far above the viewport (invisible during the snapshot),
 * removed on dragend/drop.
 */

export interface DragGhost {
  /** Wrapper element to pass to `setDragImage`. */
  wrapper: HTMLElement;
}

/**
 * Create a styled ghost of `source` and append the wrapper to
 * `document.body`. Caller must remove the wrapper when the drag ends.
 */
export function createDragGhost(source: HTMLElement): DragGhost {
  const wrapper = makeWrapper(source);
  const clone = deepCloneWithStyles(source);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return { wrapper };
}

function makeWrapper(source: HTMLElement): HTMLElement {
  const w = document.createElement('div');
  w.setAttribute('aria-hidden', 'true');
  Object.assign(w.style, {
    position: 'absolute',
    top: '-10000px',
    left: '-10000px',
    pointerEvents: 'none',
    width: `${String(source.getBoundingClientRect().width)}px`,
  });
  return w;
}

function deepCloneWithStyles(source: HTMLElement): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  freezeStylesIntoClone(source, clone);
  return clone;
}

function freezeStylesIntoClone(src: Element, dst: Element): void {
  if (src instanceof HTMLElement && dst instanceof HTMLElement) {
    dst.style.cssText = getComputedStyle(src).cssText;
  }
  const srcKids = src.children;
  const dstKids = dst.children;
  const n = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < n; i++) {
    const s = srcKids.item(i);
    const d = dstKids.item(i);
    if (s !== null && d !== null) freezeStylesIntoClone(s, d);
  }
}
