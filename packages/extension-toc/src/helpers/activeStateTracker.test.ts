/**
 * Unit tests for activeStateTracker.
 *
 * jsdom ships an IntersectionObserver constructor but never fires the
 * callback (no real layout / scroll). We replace it with a controllable
 * mock that exposes a `fire(entries)` helper so each test can drive
 * the tracker through specific scenarios deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActiveStateTracker } from './activeStateTracker.js';

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed = new Set<Element>();
  static instances: MockIntersectionObserver[] = [];

  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element): void { this.observed.add(el); }
  unobserve(el: Element): void { this.observed.delete(el); }
  disconnect(): void { this.observed.clear(); }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: number[] = [];

  /** Test helper: fire the IO callback with synthetic entries. */
  fire(entries: { target: Element; isIntersecting: boolean }[]): void {
    const full = entries.map((e) => ({
      target: e.target,
      isIntersecting: e.isIntersecting,
      // The tracker only looks at `target` and `isIntersecting`; the
      // other fields are stubbed to satisfy the type contract.
      boundingClientRect: e.target.getBoundingClientRect(),
      intersectionRatio: e.isIntersecting ? 1 : 0,
      intersectionRect: e.target.getBoundingClientRect(),
      rootBounds: null,
      time: Date.now(),
    } as IntersectionObserverEntry));
    this.callback(full, this as unknown as IntersectionObserver);
  }
}

const mountHeading = (id: string, top: number): HTMLElement => {
  const el = document.createElement('h2');
  // Use native HTML id attribute (UniqueID's default), matching the
  // tracker's default attrName.
  el.setAttribute('id', id);
  el.textContent = `Heading ${id}`;
  document.body.appendChild(el);
  // Stub getBoundingClientRect so the tracker's geometry math is
  // deterministic - jsdom returns zeroes by default.
  el.getBoundingClientRect = (): DOMRect => ({
    top, bottom: top + 24, left: 0, right: 200, height: 24, width: 200,
    x: 0, y: top, toJSON: (): unknown => undefined,
  } as unknown as DOMRect);
  return el;
};

describe('activeStateTracker', () => {
  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    MockIntersectionObserver.instances = [];
    originalIO = window.IntersectionObserver;
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalIO) {
      (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = originalIO;
    }
    document.body.innerHTML = '';
  });

  it('reports a heading as active once its top has crossed the viewport top (top <= 0)', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', -10);
    tracker.observe([a]);
    expect(onChange).toHaveBeenLastCalledWith('a');
    tracker.destroy();
  });

  it('picks the LAST-PASSED heading (largest top <= 0) when multiple have crossed the viewport top', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', -300);
    const b = mountHeading('b', -50);
    const c = mountHeading('c', 200); // not yet passed
    tracker.observe([a, b, c]);
    // a (-300) and b (-50) have both passed; b is more recent (closer
    // to 0 from below). c has not yet reached the viewport top.
    expect(onChange).toHaveBeenLastCalledWith('b');
    tracker.destroy();
  });

  it('treats a small positive subpixel top as "passed"', () => {
    // `scrollTo(rect.top + scrollY)` can leave rect.top at ~0.25 due to
    // CSS-pixel/device-pixel rounding; strict `<= 0` would miss it.
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const passed = mountHeading('passed', -300);
    const justArrived = mountHeading('justArrived', 0.25);
    const upcoming = mountHeading('upcoming', 200);
    tracker.observe([passed, justArrived, upcoming]);
    expect(onChange).toHaveBeenLastCalledWith('justArrived');
    tracker.destroy();
  });

  it('does NOT switch active to the next heading until its top reaches the viewport top', () => {
    // Active switches exactly when the viewport top line touches the
    // next heading - top <= 0. While the next heading is still below
    // the viewport top (positive top), the current heading stays lit.
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const current = mountHeading('current', -100);
    const next = mountHeading('next', 200);
    tracker.observe([current, next]);
    expect(onChange).toHaveBeenLastCalledWith('current');

    // Still below the viewport top (top=50, positive).
    next.getBoundingClientRect = (): DOMRect => ({
      top: 50, bottom: 74, left: 0, right: 200, height: 24, width: 200,
      x: 0, y: 50, toJSON: (): unknown => undefined,
    } as unknown as DOMRect);
    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: next, isIntersecting: false }]);
    expect(onChange).toHaveBeenLastCalledWith('current');

    // Heading top exactly touches the viewport top (top = 0). Switch fires.
    next.getBoundingClientRect = (): DOMRect => ({
      top: 0, bottom: 24, left: 0, right: 200, height: 24, width: 200,
      x: 0, y: 0, toJSON: (): unknown => undefined,
    } as unknown as DOMRect);
    io?.fire([{ target: next, isIntersecting: false }]);
    expect(onChange).toHaveBeenLastCalledWith('next');
    tracker.destroy();
  });

  it('falls back to the last-passed heading when nothing intersects', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    // Two headings already scrolled past (negative tops) and one below
    // the viewport (positive top) - none intersecting. The fallback
    // should pick the heading with the LARGEST negative top (closest
    // to 0 from below) - the most recently passed one.
    const passed1 = mountHeading('passed1', -300);
    const passed2 = mountHeading('passed2', -50);
    const upcoming = mountHeading('upcoming', 800);
    tracker.observe([passed1, passed2, upcoming]);
    // observe() runs pickActive immediately and emits the fallback id.
    expect(onChange).toHaveBeenLastCalledWith('passed2');
    tracker.destroy();
  });

  it('falls back to the FIRST heading when no heading has yet crossed the viewport top', () => {
    // "Above all headings" state (e.g. top of doc on initial paint).
    // The tracker keeps at least one tick lit by defaulting to the
    // first upcoming heading so the outline never visibly empties.
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 500);
    const b = mountHeading('b', 800);
    tracker.observe([a, b]);
    expect(onChange).toHaveBeenLastCalledWith('a');
    tracker.destroy();
  });

  it('returns null when there are no laid-out headings to track', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    tracker.observe([]);
    expect(onChange).toHaveBeenLastCalledWith(null);
    tracker.destroy();
  });

  it('does not refire onChange when the active id is unchanged', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', -10);
    tracker.observe([a]);
    const initialCalls = onChange.mock.calls.length;
    expect(onChange).toHaveBeenLastCalledWith('a');

    // Fire IO again with no rect change - active stays 'a', onChange
    // must not duplicate.
    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: a, isIntersecting: false }]);
    expect(onChange.mock.calls.length).toBe(initialCalls);
    tracker.destroy();
  });

  it('observe() with a new set unobserves elements no longer in the list', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 50);
    const b = mountHeading('b', 100);
    tracker.observe([a, b]);
    const io = MockIntersectionObserver.instances[0];
    expect(io?.observed.has(a)).toBe(true);
    expect(io?.observed.has(b)).toBe(true);

    // Re-observe with only b - a must be unobserved.
    tracker.observe([b]);
    expect(io?.observed.has(a)).toBe(false);
    expect(io?.observed.has(b)).toBe(true);
    tracker.destroy();
  });

  it('destroy() disconnects the observer and stops firing onChange', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 50);
    tracker.observe([a]);
    onChange.mockClear();

    const io = MockIntersectionObserver.instances[0];
    tracker.destroy();
    expect(io?.observed.size).toBe(0);

    // Even if a stale callback fires after destroy, onChange must
    // stay silent.
    io?.fire([{ target: a, isIntersecting: true }]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns a no-op tracker when IntersectionObserver is unavailable', () => {
    // Strip the mock entirely - simulates SSR / very old runtime.
    const restore = (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;

    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 10);

    // Should not throw, should not call onChange.
    tracker.observe([a]);
    tracker.destroy();
    expect(onChange).not.toHaveBeenCalled();

    (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = restore;
  });
});
