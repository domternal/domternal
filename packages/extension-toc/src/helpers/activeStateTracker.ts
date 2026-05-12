/**
 * activeStateTracker - scrollspy for the floating ToC outline.
 *
 * The active heading is the LAST one whose top has reached (or moved
 * above) the viewport top - the section the user is currently
 * reading. Switching to the next heading happens only when ITS top
 * crosses the viewport top, not earlier when it enters some lower
 * band. The IntersectionObserver drives recomputation; the band
 * `rootMargin` controls only how often the callback fires, not which
 * heading wins.
 *
 * Edge case: if the user is above all headings (e.g. first paint at
 * top of doc, no heading has yet crossed the viewport top), no tick
 * is highlighted (`activeId = null`).
 *
 * The tracker is decoupled from FloatingTocOutline so other consumers
 * (e.g. inline /toc block) can adopt the same logic without spawning
 * their own observer.
 */

export interface ActiveStateTrackerOptions {
  /**
   * Scroll container the headings live inside. `null` means the
   * viewport (window). Forwarded to `IntersectionObserver(root)`.
   * @default null
   */
  scrollParent?: Element | Document | null;
  /**
   * IntersectionObserver `rootMargin`. Default constrains the active
   * zone to the top 15% of the scroll area (`'0px 0px -85% 0px'`).
   * Override only if the layout has a non-trivial top inset (e.g.
   * a sticky toolbar) the user wants to ignore.
   */
  rootMargin?: string;
  /**
   * Attribute name on the observed heading elements that holds the
   * stable id. Reported through `onChange` when an element becomes
   * the active one. Defaults to `'id'` (UniqueID's default attribute
   * name); pass a custom name when the consumer customizes
   * `UniqueID.configure({ attributeName })`.
   * @default 'id'
   */
  attrName?: string;
  /** Fired whenever the active heading id changes (or becomes null). */
  onChange: (activeId: string | null) => void;
}

export interface ActiveStateTracker {
  /**
   * Re-observe the supplied DOM elements as the new heading set.
   * Replaces the prior list - elements no longer present are
   * unobserved automatically. Each element should carry an attribute
   * named by the tracker's `attrName` option (default `'id'`); the
   * tracker reads it to call onChange.
   */
  observe: (elements: readonly HTMLElement[]) => void;
  /**
   * Disconnect the observer and stop firing onChange. Idempotent.
   */
  destroy: () => void;
}

const DEFAULT_ROOT_MARGIN = '0px 0px -85% 0px';
const DEFAULT_ATTR_NAME = 'id';

/**
 * Read the configured id attribute (default `id`). Returns null when
 * missing - the tracker silently skips those elements rather than
 * throwing, which keeps the contract forgiving for consumers that
 * observe heading candidates before IDs are assigned.
 */
function makeReadId(attrName: string): (el: HTMLElement) => string | null {
  return (el) => el.getAttribute(attrName);
}

/**
 * From the supplied set of observed elements, decide which one is
 * "active" right now. The active heading is the LAST one whose top has
 * reached or crossed the viewport top - the switch fires exactly when
 * the viewport-top line TOUCHES the next heading. Pure function over
 * live DOM rects via `getBoundingClientRect`. Combined with a scroll-
 * driven recompute (rAF-throttled, see below), the switch tracks the
 * scroll position frame-by-frame instead of waiting on IO callbacks.
 */
function pickActive(
  elements: readonly HTMLElement[],
  _intersecting: ReadonlySet<HTMLElement>,
  readId: (el: HTMLElement) => string | null,
): string | null {
  let lastPassed: HTMLElement | null = null;
  let lastPassedTop = Number.NEGATIVE_INFINITY;
  let firstVisible: HTMLElement | null = null;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    // Skip elements with no visual extent (display:none ancestor,
    // detached, zero-sized).
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.top <= 0 && rect.top > lastPassedTop) {
      lastPassedTop = rect.top;
      lastPassed = el;
    }
    // Track the first laid-out heading as a fallback for the
    // "above all headings" state (scroll near the top of the doc,
    // no heading has yet crossed the viewport top). Keeping at least
    // one tick lit avoids a brief no-active flash on initial load.
    if (firstVisible === null) firstVisible = el;
  }
  const winner = lastPassed ?? firstVisible;
  return winner ? readId(winner) : null;
}

export function createActiveStateTracker(
  options: ActiveStateTrackerOptions,
): ActiveStateTracker {
  const {
    onChange,
    scrollParent = null,
    rootMargin = DEFAULT_ROOT_MARGIN,
    attrName = DEFAULT_ATTR_NAME,
  } = options;
  const readId = makeReadId(attrName);

  // Bail out gracefully on environments without IntersectionObserver
  // (very old jsdom, test setups). The plan calls for a scroll-based
  // fallback in Phase 5; for v1 we treat absence as "no tracking" -
  // floating outline degrades to no active highlighting, no errors.
  if (typeof IntersectionObserver === 'undefined') {
    return {
      observe(): void { /* no-op */ },
      destroy(): void { /* no-op */ },
    };
  }

  const intersecting = new Set<HTMLElement>();
  let observed: readonly HTMLElement[] = [];
  let lastReportedId: string | null | undefined; // undefined sentinel for "never reported"
  let destroyed = false;

  const recompute = (): void => {
    if (destroyed) return;
    const next = pickActive(observed, intersecting, readId);
    if (next !== lastReportedId) {
      lastReportedId = next;
      onChange(next);
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      if (destroyed) return;
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (entry.isIntersecting) intersecting.add(target);
        else intersecting.delete(target);
      }
      recompute();
    },
    { root: scrollParent, rootMargin },
  );

  // Scroll listener with rAF throttling. The IntersectionObserver
  // fires only when the intersection state changes (a heading crosses
  // the `rootMargin` boundary), which can leave the active id stale
  // between transitions. Recomputing on every scroll frame keeps the
  // switch tight to actual scroll position - the user sees the new
  // heading light up as it slides into the active threshold band.
  let scrollRaf: number | null = null;
  const onScroll = (): void => {
    if (scrollRaf !== null) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      recompute();
    });
  };
  const scrollTarget: EventTarget = scrollParent instanceof Document || scrollParent === null
    ? window
    : scrollParent;
  scrollTarget.addEventListener('scroll', onScroll, { passive: true });

  return {
    observe(elements: readonly HTMLElement[]): void {
      if (destroyed) return;

      // Diff: remove ones no longer present, add new ones. We keep
      // the observer alive across observe() calls so existing
      // bookkeeping in `intersecting` is still valid for elements
      // that survive the swap. Both directions use Sets to keep the
      // diff O(n) even on docs with hundreds of headings.
      const nextSet = new Set(elements);
      const priorSet = new Set(observed);
      for (const prior of observed) {
        if (!nextSet.has(prior)) {
          observer.unobserve(prior);
          intersecting.delete(prior);
        }
      }
      for (const el of elements) {
        if (!priorSet.has(el)) {
          observer.observe(el);
        }
      }
      observed = elements;

      // Recompute current active immediately - even with no IO
      // callback fired, the set of observed elements changed and the
      // previous winner may no longer be in the doc.
      const next = pickActive(observed, intersecting, readId);
      if (next !== lastReportedId) {
        lastReportedId = next;
        onChange(next);
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      scrollTarget.removeEventListener('scroll', onScroll);
      if (scrollRaf !== null) {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = null;
      }
      intersecting.clear();
      observed = [];
    },
  };
}
