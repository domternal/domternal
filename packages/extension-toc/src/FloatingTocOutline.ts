/**
 * FloatingTocOutline - Notion-style right-rail outline (Phase 4).
 *
 * Renders a column of small "tick" buttons in the right gutter, one
 * per heading in `editor.storage.toc.content`. Tick width encodes
 * heading level (h1 wide, h2 medium, h3 narrow). Click navigates via
 * `scrollToHeading`. Hides on small viewports and on docs with too
 * few headings to bother. Hover expansion (the full-text card),
 * active-state highlighting, and inline `/toc` block come in later
 * phases (5/6/7).
 *
 * Architecture:
 *   - Plugin lives in `addProseMirrorPlugins` so PM owns its lifecycle
 *     (auto destroy on editor teardown / HMR).
 *   - Subscribes to `TableOfContents` storage's `subscribers` Set
 *     instead of using `view().update()` - that filters re-renders to
 *     ToC-relevant changes only (selection moves, mark toggles, etc.
 *     do not trigger a re-render).
 *   - Mounts the outline DOM in the closest non-overflow-hidden
 *     ancestor of the editor (D11). Falls back to `document.body`.
 *   - Position: fixed (D16, revised in Phase 4 from sticky which
 *     does not honor `right` as an absolute position). Multi-editor
 *     handling deferred to v2.
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import { createActiveStateTracker } from './helpers/activeStateTracker.js';
import type { TocStorage, HeadingEntry } from './types.js';

export const floatingTocOutlinePluginKey = new PluginKey('floatingTocOutline');

export interface FloatingTocOutlineOptions {
  /**
   * Hide the outline when the document has fewer than this many
   * headings - on a doc with one heading, the outline is just clutter.
   * @default 2
   */
  minHeadings: number;
  /**
   * Viewport width (px) at or below which the outline is hidden. Set
   * to 0 to never auto-hide on viewport size. The outline column is
   * cosmetic on touch devices and steals reading space.
   * @default 1024
   */
  mobileBreakpoint: number;
  /**
   * Override the resolver that decides where the outline DOM mounts.
   * Default walks up from the editor's view DOM looking for the first
   * ancestor whose computed `overflow` is not `hidden`; falls back to
   * `document.body`.
   */
  outlineHost?: (view: EditorView) => HTMLElement;
  /**
   * `IntersectionObserver` rootMargin used by the active-state
   * tracker. The default constrains the active zone to the upper 15%
   * of the scroll area (`'0px 0px -85% 0px'`). Override only if a
   * sticky toolbar (or similar) shifts the visual top.
   */
  activeRootMargin: string;
  /**
   * Scroll container for the active-state tracker. `null` = the
   * viewport (window). Override to a specific element when the
   * editor lives inside a custom scrolling region.
   * @default null
   */
  activeScrollParent: Element | Document | null;
  /**
   * Milliseconds during which the active-state tracker ignores
   * scroll-derived updates after a click on a tick. Without this,
   * the IO callback would override the clicked heading with whatever
   * is currently in the active zone before the smooth-scroll lands.
   * @default 500
   */
  clickOverrideMs: number;
}

const OUTLINE_CLASS = 'dm-toc-outline';
const TICK_CLASS = 'dm-toc-outline-tick';

/**
 * Resolve the host element where the outline DOM mounts (D11).
 * `.dm-editor` has `overflow: hidden` and would clip a right-rail
 * child, so we always mount OUTSIDE it. Implementation note: in the
 * Angular wrapper, `view.dom` (`.ProseMirror`) lives inside an
 * unstyled template `<div>` inside `<domternal-editor.dm-editor>`.
 * Starting the walk from `view.dom.parentElement` would land on that
 * inner div (overflow: visible), still inside the editor. The
 * `closest('.dm-editor')` jump skips past the editor host first.
 */
function resolveDefaultOutlineHost(view: EditorView): HTMLElement {
  const editorHost = view.dom.closest<HTMLElement>('.dm-editor');
  let node: HTMLElement | null = (editorHost ?? view.dom).parentElement;
  while (node && node !== document.body) {
    const overflow = window.getComputedStyle(node).overflow;
    if (overflow !== 'hidden') return node;
    node = node.parentElement;
  }
  return document.body;
}

/**
 * Naive full-rebuild render. Doc heading counts are typically <50; the
 * inner DOM cost is microseconds. We swap to a diffing strategy if
 * profiling shows a real cost on much larger docs.
 */
function renderTicks(nav: HTMLElement, content: HeadingEntry[]): void {
  // Clear existing children (no detach handlers - delegated click
  // listener lives on the nav and survives child swaps).
  while (nav.firstChild) nav.removeChild(nav.firstChild);

  for (const entry of content) {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = TICK_CLASS;
    tick.dataset['level'] = String(entry.level);
    tick.dataset['tocId'] = entry.id;
    // Accessible label for screen readers - the visual tick has no
    // text content, so we expose the heading text and level here.
    const label = entry.textContent.trim() || `Heading level ${String(entry.level)}`;
    tick.setAttribute('aria-label', `${label} (heading ${String(entry.level)})`);
    nav.appendChild(tick);
  }
}

/**
 * Apply the visibility guards: minHeadings (too few entries) and
 * mobile breakpoint (too narrow viewport). We use `data-state` and
 * `data-viewport` attributes so the actual show/hide is in CSS - lets
 * consumers override via custom selectors without monkey-patching us.
 */
function applyVisibilityState(
  nav: HTMLElement,
  count: number,
  options: FloatingTocOutlineOptions,
  isMobile: boolean,
): void {
  nav.dataset['state'] = count < options.minHeadings ? 'hidden' : 'visible';
  nav.dataset['viewport'] = isMobile ? 'mobile' : 'desktop';
}

/**
 * Toggle the active-state visual on every tick: at most one tick gets
 * the `--active` class + `aria-current="location"`, all others have
 * those cleared. Idempotent and cheap (just attribute writes).
 */
function applyActiveTick(nav: HTMLElement, activeId: string | null): void {
  for (const child of Array.from(nav.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const isActive = activeId !== null && child.dataset['tocId'] === activeId;
    child.classList.toggle('dm-toc-outline-tick--active', isActive);
    if (isActive) child.setAttribute('aria-current', 'location');
    else child.removeAttribute('aria-current');
  }
}

/**
 * Resolve every heading DOM node in the editor view that has a
 * `data-toc-id` attribute. Returns elements in document order so the
 * tracker's IntersectionObserver and pickActive logic see headings
 * in the same order they appear visually.
 */
function collectHeadingDoms(view: EditorView): HTMLElement[] {
  return Array.from(view.dom.querySelectorAll<HTMLElement>('[data-toc-id]'));
}

export const FloatingTocOutline = Extension.create<FloatingTocOutlineOptions>({
  name: 'floatingTocOutline',

  addOptions() {
    return {
      minHeadings: 2,
      mobileBreakpoint: 1024,
      activeRootMargin: '0px 0px -85% 0px',
      activeScrollParent: null,
      clickOverrideMs: 500,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;

    return [
      new Plugin({
        key: floatingTocOutlinePluginKey,
        view(editorView) {
          // Mount the DOM node into the resolved host. Skip if no
          // window (SSR safeguard, defensive).
          if (typeof window === 'undefined') {
            return { destroy(): void { /* no-op */ } };
          }

          const hostResolver = options.outlineHost ?? resolveDefaultOutlineHost;
          const host = hostResolver(editorView);
          const nav = document.createElement('nav');
          nav.className = OUTLINE_CLASS;
          nav.setAttribute('aria-label', 'Document outline');
          host.appendChild(nav);

          // Mobile breakpoint via matchMedia. Falls back to "always
          // desktop" if the option is set to 0 (consumer opt-out).
          const mq = options.mobileBreakpoint > 0
            ? window.matchMedia(`(max-width: ${String(options.mobileBreakpoint)}px)`)
            : null;
          const isMobile = (): boolean => mq?.matches ?? false;

          // Pull current TocStorage and subscribe to its updates.
          // `editor.storage.toc` is created by the TableOfContents
          // extension (Phase 2). If TableOfContents is not loaded,
          // this extension is a no-op (renders nothing, no subscriber).
          const storage = editor?.storage['toc'] as TocStorage | undefined;

          // Phase 5: active-state tracker. Lives even when storage is
          // missing - destroy() is a safe no-op then. Manual override
          // is timestamp-based: clicks bump `manualOverrideUntil` so
          // IO-derived updates are ignored until the smooth-scroll lands.
          let manualOverrideUntil = 0;
          const writeActive = (id: string | null): void => {
            applyActiveTick(nav, id);
            if (storage && storage.activeId !== id) {
              storage.activeId = id;
            }
          };
          const tracker = createActiveStateTracker({
            scrollParent: options.activeScrollParent,
            rootMargin: options.activeRootMargin,
            onChange: (id) => {
              if (Date.now() < manualOverrideUntil) return;
              writeActive(id);
            },
          });

          // Click delegation: the nav is the only listener anchor; the
          // children get swapped on every storage update so attaching
          // per-tick would mean re-binding on every render. Click also
          // primes the manual override so the IO callback does not
          // fight back during smooth-scroll.
          const onClick = (event: MouseEvent): void => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
              `[data-toc-id]`,
            );
            const id = target?.dataset['tocId'];
            if (!id) return;
            manualOverrideUntil = Date.now() + options.clickOverrideMs;
            writeActive(id);
            scrollToHeading(editorView, id);
          };
          nav.addEventListener('click', onClick);

          let unsubscribe: (() => void) | null = null;
          const onStorageUpdate = (): void => {
            if (!storage) return;
            renderTicks(nav, storage.content);
            applyVisibilityState(nav, storage.content.length, options, isMobile());
            tracker.observe(collectHeadingDoms(editorView));
            // After a re-render the tick DOM is fresh; reapply the
            // current active marker so the highlighted tick survives
            // a content rebuild.
            applyActiveTick(nav, storage.activeId);
          };

          if (storage) {
            storage.subscribers.add(onStorageUpdate);
            unsubscribe = () => { storage.subscribers.delete(onStorageUpdate); };
            // Initial paint: the storage may already have content if
            // TableOfContents' deferred init has run. If not, the
            // first onStorageUpdate fires when it does.
            onStorageUpdate();
          } else {
            // No TableOfContents loaded - render nothing, hide outline.
            nav.dataset['state'] = 'hidden';
          }

          // Re-evaluate visibility on viewport changes.
          const onMqChange = (): void => {
            if (!storage) return;
            applyVisibilityState(nav, storage.content.length, options, isMobile());
          };
          mq?.addEventListener('change', onMqChange);

          return {
            destroy(): void {
              nav.removeEventListener('click', onClick);
              mq?.removeEventListener('change', onMqChange);
              tracker.destroy();
              unsubscribe?.();
              nav.remove();
            },
          };
        },
      }),
    ];
  },
});
