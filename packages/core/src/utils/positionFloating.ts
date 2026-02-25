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
  type MiddlewareData,
} from '@floating-ui/dom';

export interface PositionFloatingOptions {
  /** Placement relative to reference. @default 'bottom' */
  placement?: Placement;
  /** Distance from reference in px. @default 4 */
  offsetValue?: number;
  /** Viewport padding for flip/shift in px. @default 10 */
  padding?: number;
}

/**
 * Positions a floating element relative to a reference element or virtual rect,
 * and keeps it positioned on scroll, resize, and layout shifts.
 *
 * Uses `autoUpdate` from floating-ui which listens for ancestor scroll,
 * ancestor resize, element resize, and layout shifts automatically.
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
    ).then(({ x, y, middlewareData }: { x: number; y: number; middlewareData: MiddlewareData }) => {
      floating.style.left = `${String(x)}px`;
      floating.style.top = `${String(y)}px`;

      // Hide floating element when reference is scrolled out of view
      const hidden = middlewareData.hide?.referenceHidden;
      floating.style.visibility = hidden ? 'hidden' : '';
    });
  };

  // autoUpdate sets up scroll, resize, and layout-shift listeners
  // and calls update() whenever repositioning is needed.
  return autoUpdate(reference as Element, floating, update);
}

/**
 * Positions a floating element using `strategy: 'absolute'` so it scrolls
 * together with its offsetParent — ideal for toolbar dropdowns.
 *
 * Tracks **resize and layout shifts** (via `autoUpdate`) but **not scroll**,
 * so the dropdown repositions when the window shrinks but doesn't jitter
 * on scroll.
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
    ).then(({ x, y }: { x: number; y: number }) => {
      floating.style.left = `${String(x)}px`;
      floating.style.top = `${String(y)}px`;
    });
  };

  // Track resize and layout shifts but NOT scroll (prevents jitter)
  return autoUpdate(reference as Element, floating, update, {
    ancestorScroll: false,
  });
}
