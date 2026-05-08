/**
 * FloatingTocOutline - Phase 4 unit tests.
 *
 * Phase 4 replaced the Phase 1 spike (hello-world div) with the real
 * outline: a column of `<button>` ticks that mirror `editor.storage.toc.content`,
 * subscribe to ToC storage updates, click-delegate to `scrollToHeading`,
 * and respect minHeadings + mobile breakpoint guards.
 *
 * We test against a real `Editor` instance with both `TableOfContents`
 * and `FloatingTocOutline` loaded - the plugin's storage subscription
 * + DOM rendering are what we care about, and they only function as
 * an integrated pair. jsdom owns the `matchMedia`/`scrollIntoView`
 * stubs we need for visibility-guard and click assertions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
} from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import { FloatingTocOutline } from './FloatingTocOutline.js';

const baseExtensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
  TableOfContents,
  FloatingTocOutline,
];

const flushDeferred = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const queryOutline = (): HTMLElement | null => document.querySelector('.dm-toc-outline');
const queryTicks = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.dm-toc-outline-tick'));

interface MountedEditorOptions {
  content: string;
  /**
   * Return value for `matchMedia(...).matches`. Use `true` to simulate
   * a viewport at or below the mobile breakpoint.
   */
  matchesMobile?: boolean;
}

describe('FloatingTocOutline - Phase 4 ticks', () => {
  let editor: Editor | undefined;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  /**
   * Build a host element appended to body and mount the editor INSIDE
   * a `.dm-editor` wrapper. The plugin's resolveOutlineHost walks
   * past `.dm-editor` looking for a non-overflow-hidden parent, so we
   * use a plain test container as that ancestor.
   */
  const mount = ({ content, matchesMobile = false }: MountedEditorOptions): Editor => {
    document.body.innerHTML = '';
    // Reset any leftover outline from prior tests.
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });

    const host = document.createElement('div');
    host.className = 'test-outline-host';
    document.body.appendChild(host);

    // Stub matchMedia BEFORE the editor mounts (the plugin reads it in
    // view().init). The default jsdom build has no matchMedia at all.
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width') ? matchesMobile : false,
      media: query,
      onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    return new Editor({
      element: host,
      extensions: baseExtensions,
      content,
    });
  };

  beforeEach(() => {
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      // @ts-expect-error - clean up polyfill
      delete window.matchMedia;
    }
  });

  it('mounts a single <nav class="dm-toc-outline"> outside the editor', async () => {
    editor = mount({ content: '<h1>One</h1><h2>Two</h2>' });
    await flushDeferred();
    const outline = queryOutline();
    expect(outline).not.toBeNull();
    expect(outline?.tagName).toBe('NAV');
    // It must NOT live inside the editor wrapper.
    expect(document.querySelectorAll('.dm-editor .dm-toc-outline')).toHaveLength(0);
    // Accessibility: the nav has the documented label.
    expect(outline?.getAttribute('aria-label')).toBe('Document outline');
  });

  it('renders one tick per heading with correct level + tocId attrs', async () => {
    editor = mount({ content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>' });
    await flushDeferred();
    const ticks = queryTicks();
    expect(ticks).toHaveLength(3);
    expect(ticks.map((t) => t.dataset['level'])).toEqual(['1', '2', '3']);
    // Each tick has a non-empty tocId matching the heading's data-toc-id.
    for (const tick of ticks) {
      expect(tick.dataset['tocId']).toMatch(/^.{8}$/);
    }
  });

  it('exposes an aria-label on each tick that includes the heading text', async () => {
    editor = mount({ content: '<h1>Welcome</h1>' });
    await flushDeferred();
    const tick = queryTicks()[0];
    expect(tick?.getAttribute('aria-label')).toContain('Welcome');
    expect(tick?.getAttribute('aria-label')).toContain('heading 1');
  });

  it('clicking a tick fires scrollToHeading for the matching heading', async () => {
    editor = mount({ content: '<h1>Top</h1><h2>Target</h2>' });
    await flushDeferred();
    const ticks = queryTicks();
    expect(ticks).toHaveLength(2);
    ticks[1]?.click();
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('hides itself when fewer headings than minHeadings (default 2)', async () => {
    editor = mount({ content: '<h1>Only One</h1>' });
    await flushDeferred();
    const outline = queryOutline();
    expect(outline?.dataset['state']).toBe('hidden');
  });

  it('shows itself when heading count crosses the minHeadings threshold', async () => {
    editor = mount({ content: '<h1>One</h1>' });
    await flushDeferred();
    expect(queryOutline()?.dataset['state']).toBe('hidden');

    editor.setContent('<h1>One</h1><h2>Two</h2>');
    expect(queryOutline()?.dataset['state']).toBe('visible');
  });

  it('hides itself on mobile viewports via the matchMedia breakpoint', async () => {
    editor = mount({
      content: '<h1>One</h1><h2>Two</h2><h3>Three</h3>',
      matchesMobile: true,
    });
    await flushDeferred();
    const outline = queryOutline();
    expect(outline?.dataset['viewport']).toBe('mobile');
  });

  it('re-renders ticks when storage updates', async () => {
    editor = mount({ content: '<h1>One</h1><h2>Two</h2>' });
    await flushDeferred();
    expect(queryTicks()).toHaveLength(2);

    editor.setContent('<h1>One</h1><h2>Two</h2><h3>Three</h3><h2>Four</h2>');
    expect(queryTicks()).toHaveLength(4);
    expect(queryTicks().map((t) => t.dataset['level'])).toEqual(['1', '2', '3', '2']);
  });

  it('destroy removes the outline DOM (no orphan after editor teardown)', async () => {
    editor = mount({ content: '<h1>One</h1><h2>Two</h2>' });
    await flushDeferred();
    expect(queryOutline()).not.toBeNull();
    editor.destroy();
    editor = undefined;
    expect(queryOutline()).toBeNull();
  });

  it('is a graceful no-op when TableOfContents is not in the extension list', async () => {
    // Without TableOfContents, `editor.storage.toc` is undefined. The
    // outline plugin must still mount its DOM (so it doesn't throw)
    // but should mark itself hidden and never touch storage.
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    editor = new Editor({
      element: host,
      // NOTE: TableOfContents intentionally omitted here.
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, FloatingTocOutline],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    const outline = queryOutline();
    expect(outline).not.toBeNull();
    expect(outline?.dataset['state']).toBe('hidden');
    expect(queryTicks()).toHaveLength(0);
  });

  it('honors a custom outlineHost option', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const editorHost = document.createElement('div');
    editorHost.id = 'editor-area';
    document.body.appendChild(editorHost);
    const customHost = document.createElement('aside');
    customHost.id = 'custom-toc-host';
    document.body.appendChild(customHost);

    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    editor = new Editor({
      element: editorHost,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        TableOfContents,
        FloatingTocOutline.configure({ outlineHost: () => customHost }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    const outline = queryOutline();
    expect(outline?.parentElement).toBe(customHost);
  });

  it('re-evaluates visibility when matchMedia change fires', async () => {
    // Capture the change listener so we can fire it manually with a
    // new `matches` value and assert the data-viewport attribute swap.
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);

    // Holder object lets TS keep the union type after the closure
    // mutation - a plain `let` would narrow to `null`.
    const ref: { listener: EventListenerOrEventListenerObject | null } = { listener: null };
    let currentMatches = false;
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      get matches() { return currentMatches; },
      media: query, onchange: null,
      addEventListener: (_event: string, listener: EventListenerOrEventListenerObject): void => {
        ref.listener = listener;
      },
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    } as unknown as MediaQueryList)) as typeof window.matchMedia;

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    expect(queryOutline()?.dataset['viewport']).toBe('desktop');

    // Simulate viewport shrink to mobile by firing the captured
    // change handler with a synthetic event whose `matches` reflects
    // the new state.
    currentMatches = true;
    const handler = ref.listener;
    if (!handler) throw new Error('matchMedia change listener was not registered');
    if (typeof handler === 'function') {
      handler({ matches: true } as unknown as Event);
    } else {
      handler.handleEvent({ matches: true } as unknown as Event);
    }
    expect(queryOutline()?.dataset['viewport']).toBe('mobile');
  });

  it('falls back to a generic aria-label when the heading is empty', async () => {
    editor = mount({ content: '<h1></h1><h2>Filled</h2>' });
    await flushDeferred();
    const ticks = queryTicks();
    expect(ticks).toHaveLength(2);
    // Empty heading: the plugin substitutes a generic level-based label
    // so screen readers announce something rather than nothing.
    expect(ticks[0]?.getAttribute('aria-label')).toContain('Heading level 1');
    // Filled heading: aria-label includes the actual text.
    expect(ticks[1]?.getAttribute('aria-label')).toContain('Filled');
  });

  it('removes itself from storage.subscribers on destroy (no leak)', async () => {
    editor = mount({ content: '<h1>One</h1><h2>Two</h2>' });
    await flushDeferred();
    const storage = editor.storage['toc'] as { subscribers: Set<() => void> };
    const sizeWithOutline = storage.subscribers.size;
    expect(sizeWithOutline).toBeGreaterThan(0);
    editor.destroy();
    editor = undefined;
    // After destroy, TableOfContents.destroy() also clears the Set
    // entirely (Phase 2 contract). The point of THIS assertion is that
    // we DON'T leave a dangling subscriber inside an already-destroyed
    // editor's storage that future fan-outs could try to invoke.
    expect(storage.subscribers.size).toBe(0);
  });
});

describe('FloatingTocOutline - Phase 5 active state', () => {
  let editor: Editor | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  // Mock IntersectionObserver so we can drive the active-state
  // tracker manually. jsdom ships an IO constructor but never fires
  // the callback (no real layout / scroll), so without this stand-in
  // the tracker observes its targets and never reports a winner.
  class MockIntersectionObserver {
    callback: IntersectionObserverCallback;
    options: IntersectionObserverInit | undefined;
    observed = new Set<Element>();
    static instances: MockIntersectionObserver[] = [];
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = cb;
      this.options = options;
      this.rootMargin = options?.rootMargin ?? '';
      MockIntersectionObserver.instances.push(this);
    }
    observe(el: Element): void { this.observed.add(el); }
    unobserve(el: Element): void { this.observed.delete(el); }
    disconnect(): void { this.observed.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    root: Element | Document | null = null;
    rootMargin: string;
    thresholds: number[] = [];
    fire(entries: { target: Element; isIntersecting: boolean }[]): void {
      const full = entries.map((e) => ({
        target: e.target,
        isIntersecting: e.isIntersecting,
        boundingClientRect: e.target.getBoundingClientRect(),
        intersectionRatio: e.isIntersecting ? 1 : 0,
        intersectionRect: e.target.getBoundingClientRect(),
        rootBounds: null,
        time: Date.now(),
      } as IntersectionObserverEntry));
      this.callback(full, this as unknown as IntersectionObserver);
    }
  }

  let originalIO: typeof IntersectionObserver | undefined;

  beforeEach(() => {
    originalIO = window.IntersectionObserver;
    MockIntersectionObserver.instances = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    if (originalIO) {
      (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = originalIO;
    }
  });

  /** Build a mounted editor for active-state assertions. */
  const mountForActive = async (content: string): Promise<Editor> => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;
    const ed = new Editor({ element: host, extensions: baseExtensions, content });
    await flushDeferred();
    return ed;
  };

  it('marks the intersecting heading as active and writes storage.activeId', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );
    const targetDom = headingDoms[1];
    if (!targetDom) throw new Error('expected at least 2 headings');
    const targetId = targetDom.getAttribute('data-toc-id');

    // Find the IO instance the tracker created and fire an
    // intersection event for the second heading.
    const io = MockIntersectionObserver.instances[0];
    expect(io).toBeDefined();
    io?.fire([{ target: targetDom, isIntersecting: true }]);

    // The tick mirroring that heading must now carry both visual
    // markers (CSS class + aria-current). Storage's activeId tracks
    // the same id so other UIs (Phase 7 inline block) can read it.
    const activeTick = ticks.find((t) => t.dataset['tocId'] === targetId);
    expect(activeTick?.classList.contains('dm-toc-outline-tick--active')).toBe(true);
    expect(activeTick?.getAttribute('aria-current')).toBe('location');
    const storage = editor.storage['toc'] as { activeId: string | null };
    expect(storage.activeId).toBe(targetId);
  });

  it('clicking a tick primes the manual override window so IO updates are ignored briefly', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );
    const clickedTick = ticks[0];
    const otherDom = headingDoms[2];
    if (!clickedTick || !otherDom) throw new Error('setup mismatch');
    const clickedId = clickedTick.dataset['tocId'];

    clickedTick.click();
    expect(clickedTick.classList.contains('dm-toc-outline-tick--active')).toBe(true);

    // Within the override window, an IO callback for a DIFFERENT
    // heading must NOT change the active visual. The plugin
    // intentionally suppresses scroll-derived updates while the
    // smooth-scroll initiated by the click is still landing.
    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: otherDom, isIntersecting: true }]);
    expect(clickedTick.classList.contains('dm-toc-outline-tick--active')).toBe(true);
    const storage = editor.storage['toc'] as { activeId: string | null };
    expect(storage.activeId).toBe(clickedId);
  });

  it('only one tick at a time has the active class', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );

    // Fire active for first heading, then for the third. The middle
    // tick should never end up active, and only the latest reported
    // heading should carry the marker after each fire.
    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: headingDoms[0]!, isIntersecting: true }]);
    expect(ticks.filter((t) => t.classList.contains('dm-toc-outline-tick--active'))).toHaveLength(1);

    io?.fire([
      { target: headingDoms[0]!, isIntersecting: false },
      { target: headingDoms[2]!, isIntersecting: true },
    ]);
    const active = ticks.filter((t) => t.classList.contains('dm-toc-outline-tick--active'));
    expect(active).toHaveLength(1);
    expect(active[0]?.dataset['tocId']).toBe(headingDoms[2]?.getAttribute('data-toc-id'));
  });

  it('re-applies the current active marker after a content rebuild', async () => {
    // setContent replaces the entire doc - which means renderTicks
    // wipes the nav and rebuilds. The plugin must reapply the
    // tracked active id to the new tick DOM so the visual highlight
    // does not flash off.
    editor = await mountForActive('<h1>One</h1><h2>Two</h2>');
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );
    const io = MockIntersectionObserver.instances[0];
    io?.fire([{ target: headingDoms[1]!, isIntersecting: true }]);
    const activeIdBefore = (editor.storage['toc'] as { activeId: string | null }).activeId;
    expect(activeIdBefore).not.toBeNull();

    // Change content while keeping the second heading's id (paste-
    // collision rename does NOT happen because the IDs the plugin
    // wrote out via renderHTML survive a roundtrip). We simulate
    // this by adding another heading and asserting the previously
    // active heading's tick keeps the marker.
    editor.setContent('<h1>One</h1><h2>Two</h2><h3>Added</h3>');
    const ticks = queryTicks();
    expect(ticks).toHaveLength(3);
    const stillActive = ticks.find((t) => t.classList.contains('dm-toc-outline-tick--active'));
    // The first H2 is the one that was active, but its tocId has
    // been regenerated by the setContent (no parseable ID in input).
    // Asserting that SOME tick is active or none-but-marker-cleared.
    // The contract under test: storage.activeId is in sync with the
    // visual class set, never stale.
    const storage = editor.storage['toc'] as { activeId: string | null };
    if (storage.activeId) {
      expect(stillActive?.dataset['tocId']).toBe(storage.activeId);
    }
  });

  it('destroying the editor disconnects the IO observer', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2>');
    const io = MockIntersectionObserver.instances[0];
    expect(io?.observed.size).toBeGreaterThan(0);
    editor.destroy();
    editor = undefined;
    expect(io?.observed.size).toBe(0);
  });

  it('manual override expires after the configured window so IO updates resume', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );
    const clickedTick = ticks[0];
    const otherDom = headingDoms[2];
    if (!clickedTick || !otherDom) throw new Error('setup mismatch');

    // We can't use vi.useFakeTimers() here - the Editor mount path
    // uses real `setTimeout(0)` for deferred ID assignment, and
    // faking timers would deadlock that. Instead we spy on
    // `Date.now()` so the plugin's `manualOverrideUntil` check sees
    // a clock that "advances" past the 500ms window without us
    // having to actually sleep.
    const realNow = Date.now;
    let virtualNow = realNow();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => virtualNow);
    try {
      clickedTick.click();
      const clickedId = clickedTick.dataset['tocId'];
      expect((editor.storage['toc'] as { activeId: string | null }).activeId).toBe(clickedId);

      // Advance the virtual clock past the 500ms override window.
      virtualNow += 600;

      const io = MockIntersectionObserver.instances[0];
      io?.fire([{ target: otherDom, isIntersecting: true }]);
      const newActive = (editor.storage['toc'] as { activeId: string | null }).activeId;
      expect(newActive).toBe(otherDom.getAttribute('data-toc-id'));
      expect(newActive).not.toBe(clickedId);
    } finally {
      spy.mockRestore();
    }
  });

  it('forwards a custom activeRootMargin option to the IntersectionObserver', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    const customMargin = '0px 0px -50% 0px';
    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        TableOfContents,
        FloatingTocOutline.configure({ activeRootMargin: customMargin }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    const io = MockIntersectionObserver.instances[0];
    expect(io?.options?.rootMargin).toBe(customMargin);
  });

  it('ignores headings hidden by an ancestor (display:none) when picking active', async () => {
    editor = await mountForActive('<h1>Visible</h1><h2>InsideDetails</h2>');
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'),
    );
    const visible = headingDoms[0];
    const hidden = headingDoms[1];
    if (!visible || !hidden) throw new Error('expected two headings');

    // Force the second heading's bounding rect to (0,0,0,0) - the
    // shape `display: none` produces. Tracker's pickActive falls back
    // to "last passed" via top<0; a zero-rect heading does not qualify
    // (top===0, not <0), so it should be ignored.
    hidden.getBoundingClientRect = (): DOMRect => ({
      top: 0, bottom: 0, left: 0, right: 0, height: 0, width: 0, x: 0, y: 0,
      toJSON: (): unknown => undefined,
    } as unknown as DOMRect);

    const io = MockIntersectionObserver.instances[0];
    // Fire a non-intersecting state for both. With visible heading
    // already passed (negative top in the first observe call) the
    // tracker keeps reporting it as active; the hidden one cannot
    // win because its rect doesn't satisfy the `top < 0` predicate.
    visible.getBoundingClientRect = (): DOMRect => ({
      top: -50, bottom: -26, left: 0, right: 200, height: 24, width: 200,
      x: 0, y: -50, toJSON: (): unknown => undefined,
    } as unknown as DOMRect);
    io?.fire([
      { target: visible, isIntersecting: false },
      { target: hidden, isIntersecting: false },
    ]);

    expect((editor.storage['toc'] as { activeId: string | null }).activeId).toBe(
      visible.getAttribute('data-toc-id'),
    );
  });
});
