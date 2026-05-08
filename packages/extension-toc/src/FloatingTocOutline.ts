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

export const FloatingTocOutline = Extension.create<FloatingTocOutlineOptions>({
  name: 'floatingTocOutline',

  addOptions() {
    return {
      minHeadings: 2,
      mobileBreakpoint: 1024,
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

          // Click delegation: the nav is the only listener anchor; the
          // children get swapped on every storage update so attaching
          // per-tick would mean re-binding on every render.
          const onClick = (event: MouseEvent): void => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
              `[data-toc-id]`,
            );
            const id = target?.dataset['tocId'];
            if (!id) return;
            scrollToHeading(editorView, id);
          };
          nav.addEventListener('click', onClick);

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
          let unsubscribe: (() => void) | null = null;
          const onStorageUpdate = (): void => {
            if (!storage) return;
            renderTicks(nav, storage.content);
            applyVisibilityState(nav, storage.content.length, options, isMobile());
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
              unsubscribe?.();
              nav.remove();
            },
          };
        },
      }),
    ];
  },
});
