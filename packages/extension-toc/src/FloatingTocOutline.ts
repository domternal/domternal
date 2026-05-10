/**
 * FloatingTocOutline - Notion-style right-rail outline.
 *
 * Architecture:
 *   - Plugin lives in `addProseMirrorPlugins` so PM owns its lifecycle
 *     (auto destroy on editor teardown / HMR).
 *   - Subscribes to `TableOfContents` storage's `subscribers` Set so
 *     re-renders only fire on heading-affecting changes (selection
 *     moves, mark toggles, etc. do not trigger).
 *   - Mounts the outline DOM in the closest non-overflow-hidden
 *     ancestor of the editor (D11). Falls back to `document.body`.
 *   - Position: fixed (D16, revised in Phase 4 from sticky which
 *     does not honor `right` as an absolute position).
 *
 * Phase progression:
 *   - Phase 4: collapsed-state tick column, click navigation.
 *   - Phase 5: active-state highlighting via IntersectionObserver.
 *   - Phase 6: hover/focus reveals an expanded card with full-text
 *     rows and per-level indent. State machine has THREE values:
 *       hidden    - 0 headings / mobile / < minHeadings
 *       collapsed - shown, ticks only (default)
 *       expanded  - shown, card visible (hover OR focus-within)
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import { createActiveStateTracker } from './helpers/activeStateTracker.js';
import { resolveUniqueIDAttrName } from './helpers/uniqueIDIntegration.js';
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
  /**
   * Delay (ms) between mouse entering the outline and the expanded
   * card appearing. Prevents accidental expansion when the cursor
   * sweeps across the right gutter.
   * @default 120
   */
  hoverInDelay: number;
  /**
   * Delay (ms) between mouse leaving the outline and the card
   * collapsing back to ticks. Generous so the user can move from
   * tick column to row without the panel disappearing under the
   * cursor.
   * @default 350
   */
  hoverOutDelay: number;
}

const OUTLINE_CLASS = 'dm-toc-outline';
const TICK_CLASS = 'dm-toc-outline-tick';
const CARD_CLASS = 'dm-toc-outline-card';
const ROW_CLASS = 'dm-toc-outline-row';
// Applied to BOTH tick buttons and row buttons (anything carrying
// `data-toc-anchor` inside the outline), so the name is intentionally
// neutral instead of "tick--active". Theme rules in `_toc.scss`
// match this single class for ticks AND rows.
const ACTIVE_CLASS = 'dm-toc--active';
// Data attribute on tick / row buttons that holds the heading id we
// link to. Distinct from the heading element's own id attribute (set
// by `UniqueID`): this attribute lives on OUR buttons inside the
// outline DOM, the heading id lives on the heading element in the
// editor's DOM. Click delegation reads this; active-state matching
// reads this; the heading-element selector uses UniqueID's attrName.
const ANCHOR_ATTR = 'data-toc-anchor';
// Dataset key matching ANCHOR_ATTR (camelCase per DOMStringMap rules).
const ANCHOR_DATASET_KEY = 'tocAnchor';

type OutlineState = 'hidden' | 'collapsed' | 'expanded';

/**
 * Resolve the host element where the outline DOM mounts (D11).
 * `.dm-editor` has `overflow: hidden` and would clip a right-rail
 * child, so we always mount OUTSIDE it. In the Angular wrapper,
 * `view.dom` (`.ProseMirror`) lives inside an unstyled template
 * `<div>` inside `<domternal-editor.dm-editor>`. Starting the walk
 * from `view.dom.parentElement` would land on that inner div
 * (overflow: visible), still inside the editor. The
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
 * Build the inner DOM for the outline: a column of tick buttons (the
 * always-visible compact view) plus an absolutely-positioned card
 * containing one row button per heading (revealed on hover/focus).
 * Naive full-rebuild render: doc heading counts are typically <50;
 * the inner DOM cost is microseconds.
 */
function renderOutlineContent(nav: HTMLElement, content: HeadingEntry[]): void {
  nav.replaceChildren();

  for (const entry of content) {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = TICK_CLASS;
    tick.dataset['level'] = String(entry.level);
    tick.dataset[ANCHOR_DATASET_KEY] = entry.id;
    const label = entry.textContent.trim() || `Heading level ${String(entry.level)}`;
    tick.setAttribute('aria-label', `${label} (heading ${String(entry.level)})`);
    nav.appendChild(tick);
  }

  // Expanded-view card. Always rendered; CSS opacity flips it in/out
  // based on the parent nav's data-state attribute.
  const card = document.createElement('div');
  card.className = CARD_CLASS;
  for (const entry of content) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = ROW_CLASS;
    row.dataset['level'] = String(entry.level);
    row.dataset[ANCHOR_DATASET_KEY] = entry.id;
    row.textContent = entry.textContent.trim() || `Heading level ${String(entry.level)}`;
    card.appendChild(row);
  }
  nav.appendChild(card);
}

/**
 * Toggle the active-state visual on every element with a `data-toc-anchor`
 * attribute (both ticks AND rows in the outline DOM). At most one item
 * gets the active class + `aria-current="location"`, all others have
 * those cleared.
 */
function applyActiveMarker(nav: HTMLElement, activeId: string | null): void {
  const items = nav.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`);
  for (const item of Array.from(items)) {
    const isActive = activeId !== null && item.dataset[ANCHOR_DATASET_KEY] === activeId;
    item.classList.toggle(ACTIVE_CLASS, isActive);
    if (isActive) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  }
}

/**
 * Resolve every heading DOM node in the editor view whose stable id
 * attribute (UniqueID's `attrName`) is set. Returns elements in
 * document order so the tracker's IntersectionObserver and pickActive
 * logic see headings in the same order they appear visually.
 */
function collectHeadingDoms(view: EditorView, attrName: string): HTMLElement[] {
  return Array.from(view.dom.querySelectorAll<HTMLElement>(`[${attrName}]`));
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
      hoverInDelay: 120,
      hoverOutDelay: 350,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;

    return [
      new Plugin({
        key: floatingTocOutlinePluginKey,
        view(editorView) {
          if (typeof window === 'undefined') {
            return { destroy(): void { /* no-op */ } };
          }

          // UniqueID is the source of truth for heading ids in the DOM.
          // Resolve its attribute name now so our IO selector targets
          // the right thing. Falls back to 'id' if UniqueID is not
          // loaded (TOC will have already errored loudly; the outline
          // would render hidden because storage stays empty).
          const attrName = editor ? resolveUniqueIDAttrName(editor) ?? 'id' : 'id';

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

          const storage = editor?.storage['toc'] as TocStorage | undefined;

          // ── State machine ────────────────────────────────────────
          // The outline has three derived states: hidden, collapsed,
          // expanded. Hidden wins absolutely (mobile / minHeadings).
          // Otherwise expanded if EITHER hover OR focus is active.
          let isHoverActive = false;
          let isFocusWithin = false;
          const computeState = (): OutlineState => {
            if (!storage) return 'hidden';
            const count = storage.content.length;
            if (count < options.minHeadings || isMobile()) return 'hidden';
            if (isHoverActive || isFocusWithin) return 'expanded';
            return 'collapsed';
          };
          const applyState = (): void => {
            nav.dataset['state'] = computeState();
            nav.dataset['viewport'] = isMobile() ? 'mobile' : 'desktop';
          };

          // ── Active-state tracker (Phase 5) ───────────────────────
          let manualOverrideUntil = 0;
          const writeActive = (id: string | null): void => {
            applyActiveMarker(nav, id);
            if (storage && storage.activeId !== id) {
              storage.activeId = id;
              // Fan out to OTHER subscribers (Phase 7 inline block,
              // potential consumer panels) so they re-render with
              // the new active marker. Skip our own subscriber to
              // avoid a redundant re-render of the outline DOM.
              [...storage.subscribers].forEach((fn) => {
                if (fn === onStorageUpdate) return;
                try {
                  fn();
                } catch (err) {
                  // eslint-disable-next-line no-console
                  console.error('[extension-toc] subscriber threw during active fan-out:', err);
                }
              });
            }
          };
          const tracker = createActiveStateTracker({
            scrollParent: options.activeScrollParent,
            rootMargin: options.activeRootMargin,
            attrName,
            onChange: (id) => {
              if (Date.now() < manualOverrideUntil) return;
              writeActive(id);
            },
          });

          // ── Click delegation ─────────────────────────────────────
          const onClick = (event: MouseEvent): void => {
            const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
              `[${ANCHOR_ATTR}]`,
            );
            const id = target?.dataset[ANCHOR_DATASET_KEY];
            if (!id) return;
            manualOverrideUntil = Date.now() + options.clickOverrideMs;
            writeActive(id);
            scrollToHeading(editorView, id, { attrName });
          };
          nav.addEventListener('click', onClick);

          // ── Hover timers (Phase 6) ───────────────────────────────
          // Asymmetric: short in-delay (don't expand on stray cursor
          // sweeps), longer out-delay (don't disappear under cursor).
          // Each transition cancels the opposite pending timer so
          // bounce gestures (enter→leave fast, or leave→enter during
          // out-delay) end up with the user-intended state.
          let showTimer: ReturnType<typeof setTimeout> | null = null;
          let hideTimer: ReturnType<typeof setTimeout> | null = null;
          const cancelTimers = (): void => {
            if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
            if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
          };
          const onMouseEnter = (): void => {
            if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
            if (showTimer !== null || isHoverActive) return;
            showTimer = setTimeout(() => {
              showTimer = null;
              isHoverActive = true;
              applyState();
            }, options.hoverInDelay);
          };
          const onMouseLeave = (): void => {
            if (showTimer !== null) { clearTimeout(showTimer); showTimer = null; }
            if (!isHoverActive || hideTimer !== null) return;
            hideTimer = setTimeout(() => {
              hideTimer = null;
              isHoverActive = false;
              applyState();
            }, options.hoverOutDelay);
          };
          nav.addEventListener('mouseenter', onMouseEnter);
          nav.addEventListener('mouseleave', onMouseLeave);

          // ── Focus a11y (Phase 6) ─────────────────────────────────
          // Keyboard users get instant expansion when focus moves
          // into the outline (no hover delay). Focusout uses a
          // microtask check on relatedTarget to avoid a flash when
          // focus moves between rows inside the same outline.
          const onFocusIn = (): void => {
            if (isFocusWithin) return;
            isFocusWithin = true;
            applyState();
          };
          const onFocusOut = (event: FocusEvent): void => {
            const next = event.relatedTarget as Node | null;
            if (next && nav.contains(next)) return;
            isFocusWithin = false;
            applyState();
          };
          nav.addEventListener('focusin', onFocusIn);
          nav.addEventListener('focusout', onFocusOut);

          // ── Storage subscription ─────────────────────────────────
          let unsubscribe: (() => void) | null = null;
          const onStorageUpdate = (): void => {
            if (!storage) return;
            renderOutlineContent(nav, storage.content);
            applyState();
            tracker.observe(collectHeadingDoms(editorView, attrName));
            applyActiveMarker(nav, storage.activeId);
          };

          if (storage) {
            storage.subscribers.add(onStorageUpdate);
            unsubscribe = () => { storage.subscribers.delete(onStorageUpdate); };
            onStorageUpdate();
          } else {
            // No TableOfContents loaded - render nothing, hide outline.
            nav.dataset['state'] = 'hidden';
          }

          // Re-evaluate visibility on viewport changes.
          const onMqChange = (): void => { applyState(); };
          mq?.addEventListener('change', onMqChange);

          return {
            destroy(): void {
              cancelTimers();
              nav.removeEventListener('click', onClick);
              nav.removeEventListener('mouseenter', onMouseEnter);
              nav.removeEventListener('mouseleave', onMouseLeave);
              nav.removeEventListener('focusin', onFocusIn);
              nav.removeEventListener('focusout', onFocusOut);
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
