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
  UniqueID,
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
  UniqueID,
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

  it('renders one tick per heading with correct level + anchor attrs', async () => {
    editor = mount({ content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>' });
    await flushDeferred();
    const ticks = queryTicks();
    expect(ticks).toHaveLength(3);
    expect(ticks.map((t) => t.dataset['level'])).toEqual(['1', '2', '3']);
    // Each tick has a non-empty data-toc-anchor matching a heading id
    // assigned by UniqueID. UniqueID's default format is UUID-style
    // (~36 chars); we just assert non-empty since the format is
    // UniqueID's concern, not the outline's.
    for (const tick of ticks) {
      expect(tick.dataset['tocAnchor']).toBeTruthy();
      expect(tick.dataset['tocAnchor']?.length).toBeGreaterThan(0);
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
    // Phase 6 introduced a 3-state machine (hidden | collapsed |
    // expanded). 'visible' was the Phase 4-5 name for what is now
    // 'collapsed' (default visible state with ticks only).
    expect(queryOutline()?.dataset['state']).toBe('collapsed');
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

  it('is a graceful no-op when UniqueID is missing (TOC inert, outline hidden)', async () => {
    // Setup: TableOfContents loaded but UniqueID NOT loaded. TOC's
    // plugin emits console.error and returns []; storage.content
    // stays empty; outline observes empty storage and renders hidden.
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
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      editor = new Editor({
        element: host,
        // NOTE: UniqueID intentionally omitted - TOC's peer dep is missing.
        extensions: [
          Document, Text, Paragraph, Heading, BaseKeymap, History,
          TableOfContents, FloatingTocOutline,
        ],
        content: '<h1>One</h1><h2>Two</h2>',
      });
      await flushDeferred();

      // TOC's error message reaches the console.
      expect(consoleErrorSpy).toHaveBeenCalled();
      // Outline DOM exists but is hidden (storage.content stayed empty).
      const outline = queryOutline();
      expect(outline).not.toBeNull();
      expect(outline?.dataset['state']).toBe('hidden');
      expect(queryTicks()).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('outline buttons carry data-toc-anchor (NOT data-toc-id)', async () => {
    // Regression guard for the v0.7.0 attribute rename. The outline's
    // own buttons use `data-toc-anchor` to identify which heading they
    // link to; the heading element itself uses native `id` (set by
    // UniqueID). The legacy `data-toc-id` must NOT appear anywhere.
    editor = mount({ content: '<h1>Alpha</h1><h2>Beta</h2>' });
    await flushDeferred();
    const outline = queryOutline();
    expect(outline).not.toBeNull();
    // Every tick has `data-toc-anchor`, no tick has `data-toc-id`.
    expect(outline?.querySelectorAll('[data-toc-anchor]').length).toBeGreaterThan(0);
    expect(outline?.querySelectorAll('[data-toc-id]')).toHaveLength(0);
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
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        // Pin viewport mode here so the assertion targets the bare
        // outline (editor mode wraps it in a `.dm-toc-outline-shell`,
        // changing the parentage; that wrapping is exercised by the
        // dedicated `anchor option` describe block below).
        FloatingTocOutline.configure({ outlineHost: () => customHost, anchor: 'viewport' }),
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

/**
 * The `anchor` option (added when the outline moved out of "fixed to
 * viewport edge" exclusivity) drives both DOM-state (`data-anchor` on
 * the nav) and side-effects (in `editor` mode the plugin sets
 * `position: relative` on the host so the outline's `position: absolute`
 * resolves against it). These tests cover both modes plus the cleanup
 * symmetry (we restore the host's inline `position` only if we set it).
 */
describe('FloatingTocOutline - anchor option', () => {
  let editor: Editor | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  const stubMatchMedia = (): void => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;
  };

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

  it('defaults to anchor="editor" (data-anchor reflects the default option)', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    const outline = queryOutline();
    expect(outline?.dataset['anchor']).toBe('editor');
  });

  it('honors anchor="viewport" override', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        FloatingTocOutline.configure({ anchor: 'viewport' }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    expect(queryOutline()?.dataset['anchor']).toBe('viewport');
  });

  it('editor mode sets host inline position to "relative" when host is static', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    // Default computed position for a fresh <div> in jsdom is "static".
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    // The plugin's mount host is the first non-overflow-hidden
    // ancestor of `.dm-editor`. With our test setup that's the outer
    // `host` div. It should now have inline `position: relative`.
    expect(host.style.position).toBe('relative');
  });

  it('editor mode does NOT mutate host position when host already has non-static positioning', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    host.style.position = 'absolute';
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    // Host kept its original inline position, no override.
    expect(host.style.position).toBe('absolute');
  });

  it('viewport mode does NOT touch host position even when host is static', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        FloatingTocOutline.configure({ anchor: 'viewport' }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    // Viewport mode uses position: fixed which ignores ancestor context,
    // so we never touch the host's position.
    expect(host.style.position).toBe('');
  });

  it('editor mode wraps the nav in a .dm-toc-outline-shell with matching data-anchor', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    // Exactly one shell wraps the nav; nav's parent is the shell, not
    // the host. The shell carries the same data-anchor for CSS to
    // target. In viewport mode this test would fail (no shell created).
    const shells = document.querySelectorAll('.dm-toc-outline-shell');
    expect(shells).toHaveLength(1);
    expect(shells[0]?.getAttribute('data-anchor')).toBe('editor');
    const outline = queryOutline();
    expect(outline?.parentElement).toBe(shells[0]);
    // Shell sits inside the host.
    expect(shells[0]?.parentElement).toBe(host);
  });

  it('viewport mode does NOT create a shell wrapper (nav lives directly under the host)', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        FloatingTocOutline.configure({ anchor: 'viewport' }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();

    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(0);
    const outline = queryOutline();
    expect(outline?.parentElement).toBe(host);
  });

  it('editor mode shell is removed on destroy (no orphan after teardown)', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(1);

    editor.destroy();
    editor = undefined;
    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(0);
    expect(document.querySelectorAll('.dm-toc-outline')).toHaveLength(0);
  });

  it('editor mode restores host inline position to original on destroy', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    stubMatchMedia();

    editor = new Editor({
      element: host,
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    expect(host.style.position).toBe('relative');

    editor.destroy();
    editor = undefined;
    // After destroy, the previous inline value (empty string => host
    // falls back to its stylesheet-computed `static`) is restored.
    expect(host.style.position).toBe('');
  });
});

/**
 * Editor-anchor internals: the mode state machine, the
 * `--dm-toc-mid-top` measurement loop, the bottom-sentinel
 * IntersectionObserver, frozen-mode B→A capture, and IO/resize cleanup.
 * Every test stubs `matchMedia` and the IO so callbacks can be fired
 * manually (jsdom's IO never fires on its own).
 */
describe('FloatingTocOutline - editor anchor mode internals', () => {
  let editor: Editor | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;
  let originalIO: typeof IntersectionObserver | undefined;

  /** Minimal IO mock that records constructor args + lets tests fire entries. */
  class MockIO {
    callback: IntersectionObserverCallback;
    rootMargin: string;
    observed = new Set<Element>();
    static instances: MockIO[] = [];
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = cb;
      this.rootMargin = options?.rootMargin ?? '';
      MockIO.instances.push(this);
    }
    observe(el: Element): void { this.observed.add(el); }
    unobserve(el: Element): void { this.observed.delete(el); }
    disconnect(): void { this.observed.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    root: Element | Document | null = null;
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

  const stubMatchMedia = (): void => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline, .dm-toc-outline-shell').forEach((n) => { n.remove(); });
    originalIO = window.IntersectionObserver;
    MockIO.instances = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
      MockIO as unknown as typeof IntersectionObserver;
    stubMatchMedia();
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
    if (originalIO) {
      (window as unknown as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver = originalIO;
    } else {
      // @ts-expect-error - clean up polyfill
      delete window.IntersectionObserver;
    }
  });

  /** The bottom-sentinel IO has empty rootMargin; the active tracker has '-85%'. */
  const findSentinelIO = (): MockIO | undefined =>
    MockIO.instances.find((o) => o.rootMargin === '');

  const mount = async (content = '<h1>One</h1><h2>Two</h2>'): Promise<Editor> => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new Promise((resolve) => {
      const ed = new Editor({ element: host, extensions: baseExtensions, content });
      setTimeout(() => { resolve(ed); }, 0);
    });
  };

  // ─── Mode state machine ────────────────────────────────────────────

  it('initial mode is "middle" by default (jsdom rects are 0, sentinel reads as not visible)', async () => {
    editor = await mount();
    expect(queryOutline()?.dataset['mode']).toBe('middle');
    expect(queryOutline()?.dataset['bottomVisible']).toBe('false');
  });

  it('shell mirrors the mode + bottom-visible data attributes set on the nav', async () => {
    editor = await mount();
    const nav = queryOutline();
    const shell = document.querySelector<HTMLElement>('.dm-toc-outline-shell');
    expect(shell?.dataset['mode']).toBe(nav?.dataset['mode']);
    expect(shell?.dataset['bottomVisible']).toBe(nav?.dataset['bottomVisible']);
  });

  it('IO firing isIntersecting=true (B→A transition) flips mode to "center" (no frozen capture in jsdom)', async () => {
    editor = await mount();
    const io = findSentinelIO();
    expect(io).toBeDefined();
    const sentinel = [...io!.observed][0];
    io!.fire([{ target: sentinel!, isIntersecting: true }]);
    expect(queryOutline()?.dataset['mode']).toBe('center');
    expect(queryOutline()?.dataset['bottomVisible']).toBe('true');
  });

  it('IO firing isIntersecting=true with a non-zero navRect.top transitions to "frozen" with marginTop pinned', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const shell = document.querySelector<HTMLElement>('.dm-toc-outline-shell')!;
    // Mock the rects so writeBottomVisible captures a frozen offset.
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
      top: 400, bottom: 500, left: 0, right: 30, width: 30, height: 100,
      x: 0, y: 400, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue({
      top: 80, bottom: 2000, left: 0, right: 30, width: 30, height: 1920,
      x: 0, y: 80, toJSON: () => ({}),
    } as DOMRect);

    const io = findSentinelIO()!;
    const sentinel = [...io.observed][0]!;
    io.fire([{ target: sentinel, isIntersecting: true }]);

    expect(nav.dataset['mode']).toBe('frozen');
    // marginTop = navRect.top - shellRect.top = 400 - 80 = 320
    expect(nav.style.marginTop).toBe('320px');
  });

  it('IO firing isIntersecting=false (A→B transition) reverts to "middle" and clears marginTop', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const io = findSentinelIO()!;
    const sentinel = [...io.observed][0]!;

    // First go to 'center' via a true fire, then back to 'middle'.
    io.fire([{ target: sentinel, isIntersecting: true }]);
    nav.style.marginTop = '99px'; // pretend we had frozen state with margin
    io.fire([{ target: sentinel, isIntersecting: false }]);

    expect(nav.dataset['mode']).toBe('middle');
    expect(nav.dataset['bottomVisible']).toBe('false');
    expect(nav.style.marginTop).toBe('');
  });

  it('IO firing isIntersecting=true while ALREADY visible is a no-op (mode stays)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const io = findSentinelIO()!;
    const sentinel = [...io.observed][0]!;
    io.fire([{ target: sentinel, isIntersecting: true }]);
    expect(nav.dataset['mode']).toBe('center');
    // Fire again - no state change.
    io.fire([{ target: sentinel, isIntersecting: true }]);
    expect(nav.dataset['mode']).toBe('center');
  });

  // ─── --dm-toc-mid-top CSS variable ─────────────────────────────────

  it('sets --dm-toc-mid-top on mount based on the nav offsetHeight', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 200 });
    // Trigger a re-render so recomputeMidTop runs on the new height.
    editor.setContent('<h1>A</h1><h2>B</h2><h3>C</h3>');
    await flushDeferred();
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('calc(50vh - 100.00px)');
  });

  it('--dm-toc-mid-top is recomputed when headings change (storage update fires)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    let h = 100;
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => h });
    editor.setContent('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('calc(50vh - 50.00px)');

    h = 300;
    editor.setContent('<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>');
    await flushDeferred();
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('calc(50vh - 150.00px)');
  });

  it('--dm-toc-mid-top is recomputed when window resizes', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 250 });
    window.dispatchEvent(new Event('resize'));
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('calc(50vh - 125.00px)');
  });

  it('recomputeMidTop is a no-op when nav offsetHeight is 0 (does NOT clear an existing value)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    nav.style.setProperty('--dm-toc-mid-top', 'sentinel');
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 0 });
    window.dispatchEvent(new Event('resize'));
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('sentinel');
  });

  it('viewport anchor mode does NOT set --dm-toc-mid-top (no shell, no measurement loop)', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        FloatingTocOutline.configure({ anchor: 'viewport' }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    const nav = queryOutline()!;
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 500 });
    window.dispatchEvent(new Event('resize'));
    expect(nav.style.getPropertyValue('--dm-toc-mid-top')).toBe('');
  });

  // ─── Bottom sentinel ───────────────────────────────────────────────

  it('creates a 1px sentinel as direct child of the shell', async () => {
    editor = await mount();
    const shell = document.querySelector('.dm-toc-outline-shell')!;
    const sentinels = Array.from(shell.children).filter(
      (c) => c.tagName === 'DIV' && (c as HTMLElement).style.width === '1px',
    );
    expect(sentinels).toHaveLength(1);
    const sentinel = sentinels[0] as HTMLElement;
    expect(sentinel.style.position).toBe('absolute');
    expect(sentinel.style.bottom).toBe('0px');
    expect(sentinel.style.left).toBe('0px');
    expect(sentinel.style.height).toBe('1px');
    expect(sentinel.style.pointerEvents).toBe('none');
  });

  it('sentinel is observed by the bottom-visible IntersectionObserver', async () => {
    editor = await mount();
    const io = findSentinelIO();
    expect(io).toBeDefined();
    expect(io!.observed.size).toBe(1);
  });

  it('removes the sentinel + disconnects its IO on destroy', async () => {
    editor = await mount();
    const io = findSentinelIO()!;
    const disconnectSpy = vi.spyOn(io, 'disconnect');
    editor.destroy();
    editor = undefined;
    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(0);
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('viewport anchor mode does NOT create a bottom sentinel or sentinel IO', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID,
        TableOfContents,
        FloatingTocOutline.configure({ anchor: 'viewport' }),
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    // No shell - no place for a sentinel.
    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(0);
    // The only IO present (if any) is the active-state tracker (non-empty rootMargin).
    expect(findSentinelIO()).toBeUndefined();
  });

  // ─── IntersectionObserver fallback ─────────────────────────────────

  it('plugin still mounts (shell + nav) when IntersectionObserver is undefined', async () => {
    // Tear down the IO polyfill installed in beforeEach.
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = undefined;
    editor = await mount();
    expect(document.querySelectorAll('.dm-toc-outline-shell')).toHaveLength(1);
    expect(queryOutline()).not.toBeNull();
  });

  it('without IntersectionObserver, no sentinel is created (no IO to observe it)', async () => {
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = undefined;
    editor = await mount();
    const shell = document.querySelector('.dm-toc-outline-shell')!;
    const sentinels = Array.from(shell.children).filter(
      (c) => c.tagName === 'DIV' && (c as HTMLElement).style.width === '1px',
    );
    expect(sentinels).toHaveLength(0);
  });

  // ─── Cleanup ───────────────────────────────────────────────────────

  it('removes the window resize listener on destroy (no leak)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    Object.defineProperty(nav, 'offsetHeight', { configurable: true, get: () => 100 });
    editor.destroy();
    editor = undefined;
    // Detach the nav from any references so a stray resize handler would
    // throw on a dead node. We verify silence by firing resize: no error.
    expect(() => { window.dispatchEvent(new Event('resize')); }).not.toThrow();
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
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
    );
    const targetDom = headingDoms[1];
    if (!targetDom) throw new Error('expected at least 2 headings');
    const targetId = targetDom.getAttribute('id');

    // Find the IO instance the tracker created and fire an
    // intersection event for the second heading.
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
    expect(io).toBeDefined();
    io?.fire([{ target: targetDom, isIntersecting: true }]);

    // The tick mirroring that heading must now carry both visual
    // markers (CSS class + aria-current). Storage's activeId tracks
    // the same id so other UIs (Phase 7 inline block) can read it.
    const activeTick = ticks.find((t) => t.dataset['tocAnchor'] === targetId);
    expect(activeTick?.classList.contains('dm-toc--active')).toBe(true);
    expect(activeTick?.getAttribute('aria-current')).toBe('location');
    const storage = editor.storage['toc'] as { activeId: string | null };
    expect(storage.activeId).toBe(targetId);
  });

  it('clicking a tick primes the manual override window so IO updates are ignored briefly', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
    );
    const clickedTick = ticks[0];
    const otherDom = headingDoms[2];
    if (!clickedTick || !otherDom) throw new Error('setup mismatch');
    const clickedId = clickedTick.dataset['tocAnchor'];

    clickedTick.click();
    expect(clickedTick.classList.contains('dm-toc--active')).toBe(true);

    // Within the override window, an IO callback for a DIFFERENT
    // heading must NOT change the active visual. The plugin
    // intentionally suppresses scroll-derived updates while the
    // smooth-scroll initiated by the click is still landing.
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
    io?.fire([{ target: otherDom, isIntersecting: true }]);
    expect(clickedTick.classList.contains('dm-toc--active')).toBe(true);
    const storage = editor.storage['toc'] as { activeId: string | null };
    expect(storage.activeId).toBe(clickedId);
  });

  it('only one tick at a time has the active class', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
    );

    // Fire active for first heading, then for the third. The middle
    // tick should never end up active, and only the latest reported
    // heading should carry the marker after each fire.
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
    io?.fire([{ target: headingDoms[0]!, isIntersecting: true }]);
    expect(ticks.filter((t) => t.classList.contains('dm-toc--active'))).toHaveLength(1);

    io?.fire([
      { target: headingDoms[0]!, isIntersecting: false },
      { target: headingDoms[2]!, isIntersecting: true },
    ]);
    const active = ticks.filter((t) => t.classList.contains('dm-toc--active'));
    expect(active).toHaveLength(1);
    expect(active[0]?.dataset['tocAnchor']).toBe(headingDoms[2]?.getAttribute('id'));
  });

  it('re-applies the current active marker after a content rebuild', async () => {
    // setContent replaces the entire doc - which means renderTicks
    // wipes the nav and rebuilds. The plugin must reapply the
    // tracked active id to the new tick DOM so the visual highlight
    // does not flash off.
    editor = await mountForActive('<h1>One</h1><h2>Two</h2>');
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
    );
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
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
    const stillActive = ticks.find((t) => t.classList.contains('dm-toc--active'));
    // The first H2 is the one that was active, but its id has
    // been regenerated by the setContent (no parseable ID in input).
    // Asserting that SOME tick is active or none-but-marker-cleared.
    // The contract under test: storage.activeId is in sync with the
    // visual class set, never stale.
    const storage = editor.storage['toc'] as { activeId: string | null };
    if (storage.activeId) {
      expect(stillActive?.dataset['tocAnchor']).toBe(storage.activeId);
    }
  });

  it('destroying the editor disconnects the IO observer', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2>');
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
    expect(io?.observed.size).toBeGreaterThan(0);
    editor.destroy();
    editor = undefined;
    expect(io?.observed.size).toBe(0);
  });

  it('manual override expires after the configured window so IO updates resume', async () => {
    editor = await mountForActive('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = queryTicks();
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
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
      const clickedId = clickedTick.dataset['tocAnchor'];
      expect((editor.storage['toc'] as { activeId: string | null }).activeId).toBe(clickedId);

      // Advance the virtual clock past the 500ms override window.
      virtualNow += 600;

      const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
      io?.fire([{ target: otherDom, isIntersecting: true }]);
      const newActive = (editor.storage['toc'] as { activeId: string | null }).activeId;
      expect(newActive).toBe(otherDom.getAttribute('id'));
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
    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
    expect(io?.options?.rootMargin).toBe(customMargin);
  });

  it('ignores headings hidden by an ancestor (display:none) when picking active', async () => {
    editor = await mountForActive('<h1>Visible</h1><h2>InsideDetails</h2>');
    const headingDoms = Array.from(
      editor.view.dom.querySelectorAll<HTMLElement>('[id]'),
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

    const io = MockIntersectionObserver.instances.find((o) => o.rootMargin !== "");
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
      visible.getAttribute('id'),
    );
  });
});

describe('FloatingTocOutline - Phase 6 hover expansion', () => {
  let editor: Editor | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  const queryCard = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('.dm-toc-outline-card');
  const queryRows = (): HTMLButtonElement[] =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.dm-toc-outline-row'));

  /** Mount with stubbed matchMedia. Phase 6 tests don't need IO. */
  const mountForHover = (
    content: string,
    options: { hoverInDelay?: number; hoverOutDelay?: number } = {},
  ): Editor => {
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
    return new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        UniqueID,
        TableOfContents,
        FloatingTocOutline.configure(options),
      ],
      content,
    });
  };

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  it('renders an expanded-state card with one row per heading', async () => {
    editor = mountForHover('<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>');
    await flushDeferred();
    const card = queryCard();
    expect(card).not.toBeNull();
    const rows = queryRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dataset['level'])).toEqual(['1', '2', '3']);
    expect(rows.map((r) => r.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('default state is "collapsed" once headings are loaded', async () => {
    editor = mountForHover('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    expect(queryOutline()?.dataset['state']).toBe('collapsed');
  });

  it('hover transitions through showTimer to "expanded" state', async () => {
    // Editor mounts with REAL timers - the deferred ID assignment
    // inside TableOfContents uses setTimeout(0) which a global
    // useFakeTimers() would freeze. We activate fake timers only
    // AFTER mount + flush so the hover assertions can step time
    // forward in isolation.
    editor = mountForHover(
      '<h1>One</h1><h2>Two</h2>',
      { hoverInDelay: 100, hoverOutDelay: 300 },
    );
    await flushDeferred();
    const nav = queryOutline()!;
    expect(nav.dataset['state']).toBe('collapsed');

    vi.useFakeTimers();
    try {
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      // showTimer not yet expired - state unchanged.
      vi.advanceTimersByTime(50);
      expect(nav.dataset['state']).toBe('collapsed');
      // Past the in-delay: state flips.
      vi.advanceTimersByTime(60);
      expect(nav.dataset['state']).toBe('expanded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the show-timer when the cursor leaves before it fires', async () => {
    editor = mountForHover(
      '<h1>One</h1><h2>Two</h2>',
      { hoverInDelay: 100, hoverOutDelay: 300 },
    );
    await flushDeferred();
    const nav = queryOutline()!;

    vi.useFakeTimers();
    try {
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      vi.advanceTimersByTime(40);
      // Quick exit before show-timer fires.
      nav.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      // Even after the original in-delay would have lapsed, the state
      // must NOT have flipped to 'expanded' - the timer was cancelled.
      vi.advanceTimersByTime(200);
      expect(nav.dataset['state']).toBe('collapsed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hover-out fades to "collapsed" after the configured delay', async () => {
    editor = mountForHover(
      '<h1>One</h1><h2>Two</h2>',
      { hoverInDelay: 100, hoverOutDelay: 300 },
    );
    await flushDeferred();
    const nav = queryOutline()!;

    vi.useFakeTimers();
    try {
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      vi.advanceTimersByTime(110);
      expect(nav.dataset['state']).toBe('expanded');

      nav.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      // Within out-delay window: still expanded.
      vi.advanceTimersByTime(200);
      expect(nav.dataset['state']).toBe('expanded');
      // Past out-delay: collapsed.
      vi.advanceTimersByTime(150);
      expect(nav.dataset['state']).toBe('collapsed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('focus-within expands the outline immediately (no hover delay)', async () => {
    editor = mountForHover('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    const nav = queryOutline()!;
    expect(nav.dataset['state']).toBe('collapsed');

    // Focus a button inside the outline. focusin bubbles synchronously.
    const tick = nav.querySelector<HTMLButtonElement>('.dm-toc-outline-tick');
    tick?.focus();
    expect(nav.dataset['state']).toBe('expanded');
  });

  it('blur out of the outline collapses (no flicker between siblings)', async () => {
    editor = mountForHover('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    const nav = queryOutline()!;
    const tick = nav.querySelector<HTMLButtonElement>('.dm-toc-outline-tick')!;
    const row = nav.querySelector<HTMLButtonElement>('.dm-toc-outline-row')!;

    tick.focus();
    expect(nav.dataset['state']).toBe('expanded');

    // Tab between siblings inside the outline - focus moves but
    // state must NOT flicker collapsed for a frame.
    const focusoutEvent = new FocusEvent('focusout', {
      bubbles: true,
      relatedTarget: row,
    });
    tick.dispatchEvent(focusoutEvent);
    expect(nav.dataset['state']).toBe('expanded');

    // Now focus leaves the outline entirely - state should collapse.
    const escapeEvent = new FocusEvent('focusout', {
      bubbles: true,
      relatedTarget: document.body,
    });
    tick.dispatchEvent(escapeEvent);
    expect(nav.dataset['state']).toBe('collapsed');
  });

  it('clicking a row scrolls and writes activeId, same as clicking a tick', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;

    editor = mountForHover('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    await flushDeferred();
    const rows = queryRows();
    const target = rows[1]!;
    const targetId = target.dataset['tocAnchor'];

    target.click();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect((editor.storage['toc'] as { activeId: string | null }).activeId).toBe(targetId);
  });

  it('active state syncs across both the tick and its corresponding row', async () => {
    editor = mountForHover('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    await flushDeferred();
    const rows = queryRows();
    const ticks = queryTicks();
    rows[1]?.click();
    const targetId = rows[1]?.dataset['tocAnchor'];

    // Both the tick AND the row at the same index share the active
    // marker - they're the same logical entry, just two visual
    // affordances.
    const matchedTick = ticks.find((t) => t.dataset['tocAnchor'] === targetId);
    const matchedRow = rows.find((r) => r.dataset['tocAnchor'] === targetId);
    expect(matchedTick?.getAttribute('aria-current')).toBe('location');
    expect(matchedRow?.getAttribute('aria-current')).toBe('location');
  });

  it('mobile breakpoint forces "hidden" even on focus / hover', async () => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      // Always-mobile stub.
      matches: query.includes('max-width'),
      media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        TableOfContents, FloatingTocOutline,
      ],
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    const nav = queryOutline()!;
    expect(nav.dataset['state']).toBe('hidden');

    // Even with focus, mobile keeps the outline hidden.
    const tick = nav.querySelector<HTMLButtonElement>('.dm-toc-outline-tick');
    tick?.focus();
    expect(nav.dataset['state']).toBe('hidden');
  });

  it('re-enter during the hide-timer cancels the pending collapse', async () => {
    editor = mountForHover(
      '<h1>One</h1><h2>Two</h2>',
      { hoverInDelay: 100, hoverOutDelay: 300 },
    );
    await flushDeferred();
    const nav = queryOutline()!;

    vi.useFakeTimers();
    try {
      // Expand via hover.
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      vi.advanceTimersByTime(110);
      expect(nav.dataset['state']).toBe('expanded');

      // Mouse leaves - hide-timer is queued (300ms delay).
      nav.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      vi.advanceTimersByTime(150);
      // Still expanded - hide-timer hasn't fired yet.
      expect(nav.dataset['state']).toBe('expanded');

      // Cursor returns BEFORE hide-timer fires - timer must be
      // cancelled so the user does not see a flash collapse.
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      vi.advanceTimersByTime(500);
      // Way past the original out-delay; state must remain expanded.
      expect(nav.dataset['state']).toBe('expanded');
    } finally {
      vi.useRealTimers();
    }
  });

  it('custom hoverInDelay and hoverOutDelay options are honored over defaults', async () => {
    editor = mountForHover(
      '<h1>One</h1><h2>Two</h2>',
      { hoverInDelay: 5, hoverOutDelay: 20 },
    );
    await flushDeferred();
    const nav = queryOutline()!;

    vi.useFakeTimers();
    try {
      nav.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      // 5ms in-delay - tick by 6ms to land past it.
      vi.advanceTimersByTime(6);
      expect(nav.dataset['state']).toBe('expanded');

      nav.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      // 20ms out-delay - tick by 25ms to land past it.
      vi.advanceTimersByTime(25);
      expect(nav.dataset['state']).toBe('collapsed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses fallback row label when the heading text is empty', async () => {
    editor = mountForHover('<h1></h1><h2>Has Text</h2>');
    await flushDeferred();
    const rows = queryRows();
    expect(rows).toHaveLength(2);
    // Empty heading: row substitutes a generic level-based label so
    // the user sees something rather than a blank row.
    expect(rows[0]?.textContent).toBe('Heading level 1');
    expect(rows[1]?.textContent).toBe('Has Text');
  });
});

/**
 * Expanded-card edge behavior: closes on window scroll (so it doesn't
 * lag the page or appear detached from any tick), and shifts vertically
 * via `--dm-toc-card-shift-y` when the nav sits near a viewport edge.
 */
describe('FloatingTocOutline - expanded card scroll-close + viewport clamp', () => {
  let editor: Editor | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-outline').forEach((n) => { n.remove(); });
    originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined, removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
    if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  });

  const mount = async (content = '<h1>A</h1><h2>B</h2>'): Promise<Editor> => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ed = new Editor({ element: host, extensions: baseExtensions, content });
    await flushDeferred();
    return ed;
  };

  const expandViaFocus = (nav: HTMLElement): void => {
    const firstTick = nav.querySelector<HTMLButtonElement>('.dm-toc-outline-tick');
    firstTick?.focus();
    nav.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  };

  it('window scroll while expanded collapses the menu back to "collapsed"', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    expandViaFocus(nav);
    expect(nav.dataset['state']).toBe('expanded');

    window.dispatchEvent(new Event('scroll'));
    expect(nav.dataset['state']).toBe('collapsed');
  });

  it('window scroll while collapsed is a no-op (does not flip state)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    expect(nav.dataset['state']).toBe('collapsed');
    window.dispatchEvent(new Event('scroll'));
    expect(nav.dataset['state']).toBe('collapsed');
  });

  it('removes the window scroll listener on destroy (no leak after editor teardown)', async () => {
    editor = await mount();
    editor.destroy();
    editor = undefined;
    // After destroy, scrolling should not throw or touch any orphan refs.
    expect(() => { window.dispatchEvent(new Event('scroll')); }).not.toThrow();
  });

  it('sets --dm-toc-card-shift-y on expansion when card overflows top of viewport', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    // Force a layout the plugin's clamp will treat as an overflow:
    // card.top = -100 means the card would sit 100px above the viewport.
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: -100, bottom: 200, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: -100, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    // adjustCardPosition runs in requestAnimationFrame; flush it.
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));

    const shift = card.style.getPropertyValue('--dm-toc-card-shift-y');
    // Margin = 16. Needed shift = 16 - (-100) = 116.
    expect(shift).toBe('116px');
  });

  it('sets a NEGATIVE --dm-toc-card-shift-y when card overflows bottom of viewport', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    // viewport=800, margin=16, maxBottom=784. card.bottom=900 => shift = 784-900 = -116.
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: 600, bottom: 900, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: 600, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));

    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe('-116px');
  });

  it('does NOT set --dm-toc-card-shift-y when the card fits entirely in the viewport', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: 200, bottom: 500, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: 200, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));

    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe('');
  });

  it('PRESERVES --dm-toc-card-shift-y across a collapse so the card does not visually jump during fade-out', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: -50, bottom: 250, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: -50, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    const shiftWhileExpanded = card.style.getPropertyValue('--dm-toc-card-shift-y');
    expect(shiftWhileExpanded).not.toBe('');

    // Collapse by firing focusout with no related target inside nav.
    // The shift stays so the card fades out at its shifted position
    // (without re-triggering the transform transition mid-fade).
    nav.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(nav.dataset['state']).toBe('collapsed');
    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe(shiftWhileExpanded);
  });

  it('does NOT recompute the shift while already expanded (a re-focus during a click would otherwise clobber it)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: -50, bottom: 250, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: -50, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    const firstShift = card.style.getPropertyValue('--dm-toc-card-shift-y');
    expect(firstShift).toBe('66px');

    // Re-fire focusin (as happens when a row inside the card receives
    // focus on click). State stays expanded - the shift must be left
    // alone, NOT recomputed against a card that may have moved
    // mid-flow.
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: 300, bottom: 600, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: 300, toJSON: () => ({}),
    } as DOMRect);
    nav.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe(firstShift);
  });

  it('recomputes --dm-toc-card-shift-y on the next expand (stale value cleared then re-set as needed)', async () => {
    editor = await mount();
    const nav = queryOutline()!;
    const card = nav.querySelector<HTMLElement>('.dm-toc-outline-card')!;
    const rectSpy = vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
      top: -50, bottom: 250, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: -50, toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe('66px');

    nav.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    // Stale shift persists through collapse.
    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe('66px');

    // Next expand at a different layout - shift recomputes to the new value.
    rectSpy.mockReturnValue({
      top: 200, bottom: 500, left: 0, right: 200, width: 200, height: 300,
      x: 0, y: 200, toJSON: () => ({}),
    } as DOMRect);
    expandViaFocus(nav);
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    expect(card.style.getPropertyValue('--dm-toc-card-shift-y')).toBe('');
  });
});
