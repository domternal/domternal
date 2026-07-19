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
  size,
  hide,
  autoUpdate,
  type Middleware,
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
  /**
   * Clipping boundary for flip/shift overflow detection. Defaults to the
   * floating-ui clipping ancestors (overflow containers plus viewport).
   * Since the theme stopped clipping `.dm-editor` itself, floats that must
   * stay inside the editor box (e.g. the table cell toolbar, which would
   * otherwise cover app chrome above the editor) pass the wrapper here.
   */
  boundary?: Element;
  /**
   * Shrink-to-fit for vertical placements. When set, the vertical space
   * available to the floating element (in px) is written to the
   * `--dm-available-height` CSS custom property on the element, and the
   * stylesheet opts in with e.g.
   * `max-height: min(22rem, var(--dm-available-height, 100vh))`.
   * The element then stays on the preferred side and scrolls internally
   * while at least `minHeight` px fit there; only below that threshold does
   * it flip to the opposite side, where the same cap applies. Give the
   * element `box-sizing: border-box` so the written value maps 1:1 to
   * `max-height`.
   */
  constrainHeight?: {
    /** Smallest useful height in px before flipping to the opposite side. */
    minHeight: number;
  };
}

const OPPOSITE_SIDE: Record<string, string> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function oppositePlacement(placement: Placement): Placement {
  const [side = '', alignment] = placement.split('-');
  const opposite = OPPOSITE_SIDE[side] ?? side;
  return (alignment ? `${opposite}-${alignment}` : opposite) as Placement;
}

/** Builds the middleware chain shared by both positioning strategies. */
function buildMiddleware(
  options: PositionFloatingOptions | undefined,
  placementOpt: Placement,
): Middleware[] {
  const paddingOpt = options?.padding ?? 10;
  const overflowOpts = options?.boundary
    ? { padding: paddingOpt, boundary: options.boundary }
    : { padding: paddingOpt };
  const constrain = options?.constrainHeight;
  const middleware: Middleware[] = [offset(options?.offsetValue ?? 4)];
  if (constrain) {
    // `size` runs BEFORE `flip`: it shrinks the element to the space available
    // on the current side, and since a dimension change re-runs the whole
    // middleware chain, `flip` then measures the shrunken element. The element
    // therefore stays on the preferred side (scrolling internally) while at
    // least `minHeight` fits, and flips only below that threshold, where the
    // re-run caps it to the opposite side's space. With `flip` first it would
    // flip as soon as the full CSS max-height no longer fits, even when there
    // is plenty of room for a scrollable menu.
    middleware.push(
      size({
        ...overflowOpts,
        apply({ availableHeight, elements }) {
          elements.floating.style.setProperty(
            '--dm-available-height',
            `${String(Math.max(constrain.minHeight, Math.floor(availableHeight)))}px`,
          );
        },
      }),
    );
    // Restrict flip to the vertical axis: the default placement scan also
    // treats a purely horizontal overflow as a reason to flip, which `shift`
    // below already resolves by sliding the element.
    middleware.push(
      flip({
        ...overflowOpts,
        crossAxis: false,
        fallbackPlacements: [oppositePlacement(placementOpt)],
      }),
    );
  } else {
    middleware.push(flip(overflowOpts));
  }
  middleware.push(shift(overflowOpts));
  return middleware;
}

/**
 * Positions a floating element relative to a reference element or virtual rect,
 * and keeps it positioned on scroll, resize, and layout shifts.
 *
 * Uses `autoUpdate` from floating-ui with `animationFrame` polling for
 * jitter-free scroll tracking (rAF syncs with browser paint).
 *
 * Includes `hide` middleware - when the reference element is scrolled out of
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
 * // Virtual reference (e.g. cursor position - must return fresh coords)
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
  const middleware = [...buildMiddleware(options, placementOpt), hide()];

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
      // Use transform instead of left/top - GPU-accelerated, no layout reflow,
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
  // browser paint, so the position update is synchronous with the scroll,
  // with no 1-frame lag or jitter. Slightly more CPU than event-based, but
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
 * together with its offsetParent - zero jitter by design.
 *
 * Ideal for dropdowns inside scroll containers (e.g. emoji suggestion inside
 * `.dm-editor`) and toolbar dropdowns. The absolute coordinates are stable
 * across scrolls - only `flip`/`shift` decisions change on scroll, producing
 * a discrete jump rather than continuous jitter.
 *
 * The floating element must have `position: absolute` and its offsetParent
 * must have `position: relative`.
 *
 * Returns a cleanup function - call it when hiding or destroying the
 * floating element.
 */
export function positionFloatingOnce(
  reference: Element | { getBoundingClientRect: () => DOMRect },
  floating: HTMLElement,
  options?: PositionFloatingOptions,
): () => void {
  const placementOpt = options?.placement ?? 'bottom';
  const middleware = buildMiddleware(options, placementOpt);

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
  // are stable across scrolls - only flip/shift decisions change (discrete
  // jump, not continuous jitter).
  const trackScroll = options?.trackScroll ?? true;
  return autoUpdate(reference as Element, floating, update, {
    ancestorScroll: trackScroll,
    layoutShift: false,
  });
}
