/**
 * activeStateTracker - scrollspy for the floating ToC outline.
 *
 * Picks the "active" heading (the one the user is currently reading)
 * by combining IntersectionObserver readings with a fallback for
 * when no heading is in the active zone:
 *
 *   - The active zone is the upper 15% of the scroll container
 *     (rootMargin = '0px 0px -85% 0px'). A heading is "intersecting"
 *     while its top is inside this band.
 *
 *   - If multiple headings are intersecting, the TOPMOST wins (smaller
 *     boundingClientRect.top). This matches Notion's behavior - the
 *     heading that's about to scroll out is the one the user just
 *     finished reading.
 *
 *   - If NONE are intersecting, we look for the LAST PASSED heading -
 *     the one whose top is most recently negative (closest to 0 from
 *     below). This handles the "scrolled past everything" case where
 *     the user is reading the tail of the doc.
 *
 *   - If no heading has been passed either (the user is above all
 *     headings, e.g. on first paint at top of doc), the active id is
 *     null and no tick is highlighted.
 *
 * The tracker is decoupled from FloatingTocOutline so other Phase 7
 * consumers (e.g. inline /toc block) can adopt the same logic without
 * spawning their own observer.
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
  /** Fired whenever the active heading id changes (or becomes null). */
  onChange: (activeId: string | null) => void;
}

export interface ActiveStateTracker {
  /**
   * Re-observe the supplied DOM elements as the new heading set.
   * Replaces the prior list - elements no longer present are
   * unobserved automatically. Each element should carry a
   * `data-toc-id` attribute that the tracker reads to call onChange.
   */
  observe: (elements: readonly HTMLElement[]) => void;
  /**
   * Disconnect the observer and stop firing onChange. Idempotent.
   */
  destroy: () => void;
}

const DEFAULT_ROOT_MARGIN = '0px 0px -85% 0px';

/**
 * Read the `data-toc-id` attribute. Returns null when missing - the
 * tracker silently skips those elements rather than throwing, which
 * keeps the contract forgiving for consumers that observe heading
 * candidates before IDs are assigned.
 */
function readTocId(el: HTMLElement): string | null {
  return el.getAttribute('data-toc-id');
}

/**
 * From the supplied set of observed elements, decide which one is
 * "active" right now. Pure function over the live DOM rects - we call
 * `getBoundingClientRect` for each element. For typical doc sizes
 * (<200 headings) this is microseconds; if profiling ever flags it,
 * we can cache rects between IO callbacks.
 */
function pickActive(
  elements: readonly HTMLElement[],
  intersecting: ReadonlySet<HTMLElement>,
): string | null {
  // Case 1: at least one heading inside the active zone. Pick the
  // topmost (smallest top in viewport coords), so the heading that is
  // about to leave the zone is the one the user is "at".
  if (intersecting.size > 0) {
    let winner: HTMLElement | null = null;
    let winnerTop = Number.POSITIVE_INFINITY;
    for (const el of intersecting) {
      const top = el.getBoundingClientRect().top;
      if (top < winnerTop) {
        winnerTop = top;
        winner = el;
      }
    }
    return winner ? readTocId(winner) : null;
  }

  // Case 2: nothing in the active zone. Fall back to the last passed
  // heading - the one whose top is closest to 0 from below (most
  // recently scrolled past). If no element has been passed (we're
  // above all headings), return null - no tick highlighted.
  let lastPassed: HTMLElement | null = null;
  let lastPassedTop = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    const top = el.getBoundingClientRect().top;
    if (top < 0 && top > lastPassedTop) {
      lastPassedTop = top;
      lastPassed = el;
    }
  }
  return lastPassed ? readTocId(lastPassed) : null;
}

export function createActiveStateTracker(
  options: ActiveStateTrackerOptions,
): ActiveStateTracker {
  const { onChange, scrollParent = null, rootMargin = DEFAULT_ROOT_MARGIN } = options;

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

  const observer = new IntersectionObserver(
    (entries) => {
      if (destroyed) return;
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        if (entry.isIntersecting) intersecting.add(target);
        else intersecting.delete(target);
      }
      const next = pickActive(observed, intersecting);
      if (next !== lastReportedId) {
        lastReportedId = next;
        onChange(next);
      }
    },
    { root: scrollParent, rootMargin },
  );

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
      const next = pickActive(observed, intersecting);
      if (next !== lastReportedId) {
        lastReportedId = next;
        onChange(next);
      }
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      intersecting.clear();
      observed = [];
    },
  };
}
