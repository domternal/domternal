/**
 * Scroll tracking shared by the TOC observer and standalone consumers.
 * The most recently passed heading is active; before any heading passes,
 * the first laid-out heading is active. Geometry uses the scroll root's
 * inner top, while IntersectionObserver only schedules measurements.
 */

export interface ActiveStateSnapshot {
  activeId: string | null;
  /** IDs whose heading tops have reached the configured activation line. */
  scrolledOverIds: readonly string[];
}

export interface ActiveStateTrackerOptions {
  /** Scroll container; null or Document uses the window viewport. */
  scrollParent?: Element | Document | null;
  /** IntersectionObserver margin; it does not change the activation line. */
  rootMargin?: string;
  /** Distance in pixels below the scroll root's inner top. @default 0 */
  offset?: number;
  /** Attribute containing the heading's stable ID. @default 'id' */
  attrName?: string;
  /** Fired only when the active heading changes. */
  onChange: (activeId: string | null) => void;
  /** Fired after each measurement, including changes with the same active ID. */
  onUpdate?: (snapshot: ActiveStateSnapshot) => void;
}

export interface ActiveStateTracker {
  /** Replace the observed heading set and measure it immediately. */
  observe: (elements: readonly HTMLElement[]) => void;
  /** Disconnect observers and listeners. Safe to call more than once. */
  destroy: () => void;
}

const DEFAULT_ROOT_MARGIN = '0px 0px -85% 0px';
// Scroll rounding can leave a heading fractionally below its target.
const SUBPIXEL_TOLERANCE = 1;

function measureHeadings(
  elements: readonly HTMLElement[],
  attrName: string,
  threshold: number,
): ActiveStateSnapshot {
  let lastPassedId: string | null = null;
  let lastPassedTop = Number.NEGATIVE_INFINITY;
  let firstVisibleId: string | null = null;
  const scrolledOverIds: string[] = [];
  for (const element of elements) {
    const id = element.getAttribute(attrName);
    if (!id || !element.isConnected) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    firstVisibleId ??= id;
    if (rect.top <= threshold + SUBPIXEL_TOLERANCE) {
      scrolledOverIds.push(id);
      if (rect.top > lastPassedTop) {
        lastPassedTop = rect.top;
        lastPassedId = id;
      }
    }
  }
  return { activeId: lastPassedId ?? firstVisibleId, scrolledOverIds };
}

export function createActiveStateTracker(
  options: ActiveStateTrackerOptions,
): ActiveStateTracker {
  const {
    onChange,
    onUpdate,
    scrollParent = null,
    rootMargin = DEFAULT_ROOT_MARGIN,
    offset = 0,
    attrName = 'id',
  } = options;

  // Preserve the standalone helper's no-op behavior without browser APIs.
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return {
      observe(): void { /* no-op */ },
      destroy(): void { /* no-op */ },
    };
  }

  const rootElement = scrollParent?.nodeType === 1 ? scrollParent as Element : null;
  let observed: readonly HTMLElement[] = [];
  let lastReportedId: string | null | undefined;
  let destroyed = false;
  let scheduledFrame: number | null = null;

  const recompute = (): void => {
    if (destroyed) return;
    const rootTop = rootElement
      ? rootElement.getBoundingClientRect().top + rootElement.clientTop
      : 0;
    const snapshot = measureHeadings(observed, attrName, rootTop + offset);
    if (snapshot.activeId !== lastReportedId) {
      lastReportedId = snapshot.activeId;
      onChange(snapshot.activeId);
    }
    if (!destroyed) onUpdate?.(snapshot);
  };
  const scheduleMeasurement = (): void => {
    if (destroyed || scheduledFrame !== null) return;
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = null;
      recompute();
    });
  };

  const observer = new IntersectionObserver(recompute, { root: scrollParent, rootMargin });
  const resizeObserver = typeof ResizeObserver === 'undefined'
    ? null
    : new ResizeObserver(scheduleMeasurement);
  if (rootElement) resizeObserver?.observe(rootElement);
  const scrollTarget: EventTarget = rootElement ?? window;
  scrollTarget.addEventListener('scroll', scheduleMeasurement, { passive: true });
  window.addEventListener('resize', scheduleMeasurement);

  return {
    observe(elements: readonly HTMLElement[]): void {
      if (destroyed) return;
      const nextSet = new Set(elements);
      const priorSet = new Set(observed);
      for (const prior of observed) {
        if (!nextSet.has(prior)) {
          observer.unobserve(prior);
          resizeObserver?.unobserve(prior);
        }
      }
      for (const element of elements) {
        if (!priorSet.has(element)) {
          observer.observe(element);
          resizeObserver?.observe(element);
        }
      }
      observed = elements;
      recompute();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      resizeObserver?.disconnect();
      scrollTarget.removeEventListener('scroll', scheduleMeasurement);
      window.removeEventListener('resize', scheduleMeasurement);
      if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
      observed = [];
    },
  };
}
