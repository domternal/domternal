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
  el.setAttribute('data-toc-id', id);
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

  it('reports the only intersecting heading as active', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 50);
    tracker.observe([a]);
    onChange.mockClear(); // ignore the initial empty-state callback

    const io = MockIntersectionObserver.instances[0];
    expect(io).toBeDefined();
    io?.fire([{ target: a, isIntersecting: true }]);
    expect(onChange).toHaveBeenCalledWith('a');
    tracker.destroy();
  });

  it('picks the topmost heading when multiple are intersecting', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 30);
    const b = mountHeading('b', 100);
    const c = mountHeading('c', 10);
    tracker.observe([a, b, c]);
    onChange.mockClear();

    const io = MockIntersectionObserver.instances[0];
    io?.fire([
      { target: a, isIntersecting: true },
      { target: b, isIntersecting: true },
      { target: c, isIntersecting: true },
    ]);
    // c has the smallest top (10) - smallest top wins.
    expect(onChange).toHaveBeenLastCalledWith('c');
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

  it('reports null when above all headings (none passed, none intersecting)', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 500); // below viewport
    const b = mountHeading('b', 800);
    tracker.observe([a, b]);
    // observe() runs pickActive immediately - no intersections, no
    // headings above viewport, so fallback returns null.
    expect(onChange).toHaveBeenLastCalledWith(null);
    tracker.destroy();
  });

  it('does not refire onChange when the active id is unchanged', () => {
    const onChange = vi.fn();
    const tracker = createActiveStateTracker({ onChange });
    const a = mountHeading('a', 50);
    tracker.observe([a]);
    const initialCalls = onChange.mock.calls.length;

    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: a, isIntersecting: true }]);
    const afterFirstFire = onChange.mock.calls.length;
    expect(afterFirstFire).toBeGreaterThan(initialCalls);

    // Fire again with the same intersecting state - must not duplicate.
    io?.fire([{ target: a, isIntersecting: true }]);
    expect(onChange.mock.calls.length).toBe(afterFirstFire);
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
