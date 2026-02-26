/**
 * Thin wrapper around @floating-ui/dom for consistent floating element positioning.
 *
 * Used by BubbleMenu, FloatingMenu, Link Popover, and exposed for extension
 * authors building custom floating UI (emoji suggestion, slash command, etc.).
 */
import {
  computePosition,
  flip,
  shift,
  offset,
  hide,
  autoUpdate,
  type Placement,
} from '@floating-ui/dom';

export interface PositionFloatingOptions {
  /** Placement relative to reference. @default 'bottom' */
  placement?: Placement;
  /** Distance from reference in px. @default 4 */
  offsetValue?: number;
  /** Viewport padding for flip/shift in px. @default 10 */
  padding?: number;
  /** Track ancestor scroll events. Disable for static anchors (e.g. toolbar buttons). @default true */
  trackScroll?: boolean;
}

/**
 * Positions a floating element relative to a reference element or virtual rect,
 * and keeps it positioned on scroll, resize, and layout shifts.
 *
 * Uses `autoUpdate` from floating-ui with `animationFrame` polling for
 * jitter-free scroll tracking (rAF syncs with browser paint).
 *
 * Includes `hide` middleware — when the reference element is scrolled out of
 * view, the floating element is hidden via `visibility: hidden`.
 *
 * The floating element must have `position: fixed`.
 *
 * Returns a cleanup function. **Always call it** when hiding or destroying
 * the floating element to stop listeners and prevent memory leaks.
 *
 * @example
 * ```ts
 * // Start auto-positioning (follows scroll/resize)
 * const cleanup = positionFloating(buttonEl, dropdownEl, {
 *   placement: 'bottom-start',
 * });
 *
 * // Virtual reference (e.g. cursor position — must return fresh coords)
 * const virtualEl = {
 *   getBoundingClientRect: () => {
 *     const coords = view.coordsAtPos(pos);
 *     return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
 *   },
 * };
 * const cleanup = positionFloating(virtualEl, tooltipEl, { placement: 'top' });
 *
 * // Stop when done
 * cleanup();
 * ```
 */
export function positionFloating(
  reference: Element | { getBoundingClientRect: () => DOMRect },
  floating: HTMLElement,
  options?: PositionFloatingOptions,
): () => void {
  const placementOpt = options?.placement ?? 'bottom';
  const paddingOpt = options?.padding ?? 10;
  const middleware = [
    offset(options?.offsetValue ?? 4),
    flip({ padding: paddingOpt }),
    shift({ padding: paddingOpt }),
    hide(),
  ];

  const update = (): void => {
    void computePosition(
      reference as Element,
      floating,
      {
        strategy: 'fixed',
        placement: placementOpt,
        middleware,
      },
    ).then(({ x, y, middlewareData }) => {
      // Use transform instead of left/top — GPU-accelerated, no layout reflow,
      // eliminates visible jitter during scroll tracking.
      Object.assign(floating.style, {
        left: '0',
        top: '0',
        transform: `translate3d(${String(x)}px,${String(y)}px,0)`,
      });

      // Hide floating element when reference is scrolled out of view
      const hidden = middlewareData.hide?.referenceHidden;
      floating.style.visibility = hidden ? 'hidden' : '';
    });
  };

  // When scroll tracking is enabled, use requestAnimationFrame polling
  // instead of scroll event listeners. rAF runs in the same frame as the
  // browser paint, so the position update is synchronous with the scroll —
  // no 1-frame lag / jitter. Slightly more CPU than event-based, but
  // imperceptible on modern devices and only active while the element is shown.
  //
  // ancestorScroll is always off: when rAF is enabled it's redundant,
  // when rAF is disabled (trackScroll:false) no scroll tracking is wanted.
  const trackScroll = options?.trackScroll ?? true;
  return autoUpdate(reference as Element, floating, update, {
    ancestorScroll: false,
    animationFrame: trackScroll,
  });
}

/**
 * Positions a floating element using `strategy: 'absolute'` so it scrolls
 * together with its offsetParent — zero jitter by design.
 *
 * Ideal for dropdowns inside scroll containers (e.g. emoji suggestion inside
 * `.dm-editor`) and toolbar dropdowns. The absolute coordinates are stable
 * across scrolls — only `flip`/`shift` decisions change on scroll, producing
 * a discrete jump rather than continuous jitter.
 *
 * The floating element must have `position: absolute` and its offsetParent
 * must have `position: relative`.
 *
 * Returns a cleanup function — call it when hiding or destroying the
 * floating element.
 */
export function positionFloatingOnce(
  reference: Element | { getBoundingClientRect: () => DOMRect },
  floating: HTMLElement,
  options?: PositionFloatingOptions,
): () => void {
  const placementOpt = options?.placement ?? 'bottom';
  const paddingOpt = options?.padding ?? 10;
  const middleware = [
    offset(options?.offsetValue ?? 4),
    flip({ padding: paddingOpt }),
    shift({ padding: paddingOpt }),
  ];

  const update = (): void => {
    void computePosition(
      reference as Element,
      floating,
      {
        strategy: 'absolute',
        placement: placementOpt,
        middleware,
      },
    ).then(({ x, y }) => {
      Object.assign(floating.style, {
        left: '0',
        top: '0',
        transform: `translate3d(${String(Math.round(x))}px,${String(Math.round(y))}px,0)`,
      });
    });
  };

  // Track scroll + resize. With strategy:'absolute' the base coordinates
  // are stable across scrolls — only flip/shift decisions change (discrete
  // jump, not continuous jitter).
  const trackScroll = options?.trackScroll ?? true;
  return autoUpdate(reference as Element, floating, update, {
    ancestorScroll: trackScroll,
    layoutShift: false,
  });
}
