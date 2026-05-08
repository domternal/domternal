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
