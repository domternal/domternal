/**
 * Unit tests for scrollToHeading.
 *
 * jsdom does not implement `Element.prototype.scrollIntoView`, so we
 * stub it for assertion. `matchMedia` is also missing in older jsdom -
 * we polyfill it minimally per-test where the assertion depends on it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrollToHeading } from './scrollToHeading.js';
import type { EditorView } from '@domternal/pm/view';

interface StubView {
  dom: HTMLElement;
}

const buildView = (innerHTML: string): StubView => {
  const dom = document.createElement('div');
  dom.className = 'ProseMirror';
  dom.innerHTML = innerHTML;
  document.body.appendChild(dom);
  return { dom };
};

const callScroll = (view: StubView, id: string, options?: Parameters<typeof scrollToHeading>[2]): boolean =>
  scrollToHeading(view as EditorView, id, options);

describe('scrollToHeading', () => {
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;
  let originalReplaceState: typeof history.replaceState;
  let replaceStateSpy: ReturnType<typeof vi.fn>;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Reset URL hash so each test starts from a clean slate.
    history.replaceState(null, '', window.location.pathname);

    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;

    originalReplaceState = history.replaceState.bind(history);
    replaceStateSpy = vi.fn();
    history.replaceState = replaceStateSpy as unknown as typeof history.replaceState;

    // Save matchMedia so per-test polyfills can restore it.
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    history.replaceState = originalReplaceState;
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      // @ts-expect-error - clean up polyfilled property
      delete window.matchMedia;
    }
    document.body.innerHTML = '';
  });

  it('scrolls to the heading and updates the URL hash on a hit', () => {
    const view = buildView('<h2 data-toc-id="abc12345">Section</h2>');
    const result = callScroll(view, 'abc12345');

    expect(result).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#abc12345');
  });

  it('returns false and leaves URL hash alone when the id is unknown', () => {
    const view = buildView('<h2 data-toc-id="other">Section</h2>');
    const result = callScroll(view, 'missing');

    expect(result).toBe(false);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('returns false on an empty id without touching anything', () => {
    const view = buildView('<h2 data-toc-id="abc">Section</h2>');
    expect(callScroll(view, '')).toBe(false);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('opens any collapsed <details> ancestors before scrolling', () => {
    const view = buildView(`
      <details>
        <details>
          <h2 data-toc-id="nested">Deep</h2>
        </details>
      </details>
    `);
    const allDetails = Array.from(view.dom.querySelectorAll<HTMLDetailsElement>('details'));
    expect(allDetails).toHaveLength(2);
    for (const d of allDetails) expect(d.open).toBe(false);

    const result = callScroll(view, 'nested');
    expect(result).toBe(true);
    for (const d of allDetails) expect(d.open).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('uses instant scroll when prefers-reduced-motion is on', () => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      onchange: null,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    const view = buildView('<h2 data-toc-id="abc">Section</h2>');
    callScroll(view, 'abc');
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('honors an explicit behavior override even when reduced-motion is on', () => {
    // Even with the OS preference set to reduce, an explicit
    // `behavior: 'smooth'` from the caller wins. Lets host apps force
    // smooth scroll for non-essential UI like the floating outline.
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      onchange: null,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as typeof window.matchMedia;

    const view = buildView('<h2 data-toc-id="abc">Section</h2>');
    callScroll(view, 'abc', { behavior: 'smooth' });
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('honors options.updateHash: false (scrolls but skips history)', () => {
    const view = buildView('<h2 data-toc-id="abc">Section</h2>');
    const result = callScroll(view, 'abc', { updateHash: false });
    expect(result).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it('scopes the lookup to view.dom (does not match data-toc-id outside the editor)', () => {
    // Plant an unrelated heading with the same tocId outside the view.
    const stray = document.createElement('h1');
    stray.setAttribute('data-toc-id', 'outside-the-editor');
    stray.textContent = 'Unrelated';
    document.body.appendChild(stray);

    const view = buildView('<h2 data-toc-id="inside">Section</h2>');
    expect(callScroll(view, 'outside-the-editor')).toBe(false);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});
