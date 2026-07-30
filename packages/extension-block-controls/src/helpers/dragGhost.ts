/**
 * Build an off-screen "ghost" of a block for HTML5 `dataTransfer.setDragImage`.
 *
 * The browser snapshots the passed element at call time with ambient transforms,
 * scroll offsets, and ancestor clipping; inherited styles that don't survive a
 * detached clone are lost. Workaround: deep-clone the node, then copy each
 * element's resolved paint properties onto its clone's inline style, so it
 * paints identically when detached. The clone sits in an absolutely positioned
 * wrapper far above the viewport (invisible during the snapshot), removed on
 * dragend/drop.
 */

export interface DragGhost {
  /** Wrapper element to pass to `setDragImage`. */
  wrapper: HTMLElement;
}

/**
 * Properties copied onto the clone.
 *
 * This used to be a single `dst.style.cssText = getComputedStyle(src).cssText`,
 * which froze nothing at all: CSSOM specifies `cssText` as the empty string on a
 * computed (read-only) declaration, and Chrome and Firefox both return `''`. The
 * clone was therefore left inheriting `<body>`, which happens to look close
 * enough on a light theme and renders the drag preview as near-invisible
 * dark-on-dark text on a dark one.
 *
 * A curated list rather than the whole declaration: enumerating it copies ~340
 * longhands per element, and freezing layout ones (`position`, `inset`,
 * `transform`, `inline-size`) distorts the clone instead of preserving it. These
 * are the properties that decide how a block PAINTS.
 */
const PAINT_PROPERTIES = [
  'color',
  '-webkit-text-fill-color',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-align',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-transform',
  'text-indent',
  'white-space',
  'direction',
  'background-color',
  'background-image',
  'background-size',
  'background-position',
  'background-repeat',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'opacity',
  'box-shadow',
  'display',
  'list-style-type',
  'list-style-position',
] as const;

/**
 * Margins are copied for descendants only. On the root clone they offset it
 * inside the wrapper the browser snapshots, so the preview appears shifted away
 * from the cursor; on the inside they are what keeps nested paragraphs and list
 * rows apart.
 */
const MARGIN_PROPERTIES = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'] as const;

/**
 * Create a styled ghost of `source` and append the wrapper to
 * `document.body`. Caller must remove the wrapper when the drag ends.
 */
export function createDragGhost(source: HTMLElement): DragGhost {
  const wrapper = makeWrapper(source);
  const clone = source.cloneNode(true) as HTMLElement;
  freezeStylesIntoClone(source, clone, true);
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

function freezeStylesIntoClone(src: Element, dst: Element, isRoot: boolean): void {
  if (src instanceof HTMLElement && dst instanceof HTMLElement) {
    const cs = getComputedStyle(src);
    const props = isRoot ? PAINT_PROPERTIES : [...PAINT_PROPERTIES, ...MARGIN_PROPERTIES];
    for (const prop of props) {
      const value = cs.getPropertyValue(prop);
      if (value !== '') dst.style.setProperty(prop, value);
    }
    // Zeroed rather than merely left uncopied: `cloneNode` brings the source's
    // own inline style attribute along, so a block that carries an inline margin
    // would still push the preview away from the cursor.
    if (isRoot) dst.style.margin = '0';
  }
  const srcKids = src.children;
  const dstKids = dst.children;
  const n = Math.min(srcKids.length, dstKids.length);
  for (let i = 0; i < n; i++) {
    const s = srcKids.item(i);
    const d = dstKids.item(i);
    if (s !== null && d !== null) freezeStylesIntoClone(s, d, false);
  }
}
