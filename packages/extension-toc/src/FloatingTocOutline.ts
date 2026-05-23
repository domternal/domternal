/**
 * Right-rail outline. Subscribes to `TableOfContents` storage so re-renders
 * fire only on heading-affecting changes. State machine: hidden / collapsed
 * (ticks only) / expanded (hover or focus-within reveals the full card).
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { Plugin, PluginKey } from '@domternal/pm/state';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import { createActiveStateTracker } from './helpers/activeStateTracker.js';
import { resolveUniqueIDAttrName } from './helpers/uniqueIDIntegration.js';
import { getHeadingLabel, setActiveMarker } from './helpers/outlineDom.js';
import type { TocStorage, HeadingEntry } from './types.js';

export const floatingTocOutlinePluginKey = new PluginKey('floatingTocOutline');

export interface FloatingTocOutlineOptions {
  /**
   * Where the outline anchors visually.
   *
   * - `'editor'` (default): outline sits at the editor container's
   *   right gutter (inside the host's padding). Sticky positioning
   *   keeps it visible while the editor is on screen; switches to
   *   ride-along behavior near the editor's bottom edge.
   * - `'viewport'`: outline is `position: fixed` to the right edge of
   *   the viewport, vertically centered. Best for full-page editors.
   *
   * Editor mode mutates the host's `position` to `relative` if it's
   * static (restores on teardown). Viewport mode does not touch the host.
   *
   * @default 'editor'
   */
  anchor: 'editor' | 'viewport';
  /**
   * Hide the outline when the document has fewer than this many
   * headings. Default `1` shows the outline as soon as any heading
   * exists (matches Notion). Raise to `2` to suppress single-tick
   * outlines on title-only documents.
   * @default 1
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
// Editor-mode wrapper spanning the host's full height; provides the
// sticky containing block for the nav inside.
const SHELL_CLASS = 'dm-toc-outline-shell';
// Tick column wrapper. Caps at ~50% of the container with
// `overflow: hidden`; the card is a SIBLING (not a child) so the
// clip never touches the hover panel.
const TICKS_CLASS = 'dm-toc-outline-ticks';
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
 * Resolve the host element where the outline DOM mounts. `.dm-editor` has
 * `overflow: hidden` and would clip a right-rail child, so we always mount
 * OUTSIDE it - `closest('.dm-editor')` skips past the editor host before
 * walking up (in wrappers, `view.dom.parentElement` would land on an inner
 * template div still inside the editor).
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
 * Build the inner DOM for the outline: a bounded ticks column (always-
 * visible compact view) plus an absolutely-positioned card containing
 * one row button per heading (revealed on hover/focus). The ticks
 * wrapper isolates `overflow: hidden` from the card so a long heading
 * list never clips the expanded panel. Wrapper + card are reused
 * across re-renders.
 */
function renderOutlineContent(nav: HTMLElement, content: HeadingEntry[]): void {
  let ticks = nav.querySelector<HTMLElement>(`.${TICKS_CLASS}`);
  if (!ticks) {
    ticks = document.createElement('div');
    ticks.className = TICKS_CLASS;
    nav.appendChild(ticks);
  } else {
    ticks.replaceChildren();
  }

  for (const entry of content) {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = TICK_CLASS;
    tick.dataset['level'] = String(entry.level);
    tick.dataset[ANCHOR_DATASET_KEY] = entry.id;
    const label = getHeadingLabel(entry);
    tick.setAttribute('aria-label', `${label} (heading ${String(entry.level)})`);
    ticks.appendChild(tick);
  }

  // Expanded-view card. Always rendered; CSS opacity flips it in/out
  // via the nav's data-state.
  let card = nav.querySelector<HTMLElement>(`.${CARD_CLASS}`);
  if (!card) {
    card = document.createElement('div');
    card.className = CARD_CLASS;
    nav.appendChild(card);
  } else {
    card.replaceChildren();
  }
  for (const entry of content) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = ROW_CLASS;
    row.dataset['level'] = String(entry.level);
    row.dataset[ANCHOR_DATASET_KEY] = entry.id;
    row.textContent = getHeadingLabel(entry);
    card.appendChild(row);
  }
}

/**
 * Apply the active marker to ticks AND rows in the outline DOM. Thin
 * wrapper over the shared `setActiveMarker` helper: queries every
 * element with `data-toc-anchor` and forwards the toggle work.
 */
function applyActiveMarker(nav: HTMLElement, activeId: string | null): void {
  const items = Array.from(nav.querySelectorAll<HTMLElement>(`[${ANCHOR_ATTR}]`));
  setActiveMarker(items, activeId, ACTIVE_CLASS);
}

/**
 * Resolve the DOM node for each entry in `storage.content`. Looking up
 * by entry id (instead of a bare `[id]` selector) restricts the
 * tracker to actual heading elements - UniqueID assigns ids to many
 * other node types (paragraphs, list items, etc.) and a bare query
 * would feed the IntersectionObserver paragraph ids that never match
 * any tick, leaving `storage.activeId` pointing at non-headings.
 */
function collectHeadingDoms(
  view: EditorView,
  attrName: string,
  content: readonly { id: string }[],
): HTMLElement[] {
  const root = view.dom;
  const out: HTMLElement[] = [];
  const escape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape
    : (s: string): string => s;
  for (const entry of content) {
    if (!entry.id) continue;
    const el = root.querySelector<HTMLElement>(`[${attrName}="${escape(entry.id)}"]`);
    if (el) out.push(el);
  }
  return out;
}

export const FloatingTocOutline = Extension.create<FloatingTocOutlineOptions>({
  name: 'floatingTocOutline',

  addOptions() {
    return {
      anchor: 'editor',
      minHeadings: 1,
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
          const attrName = editor ? resolveUniqueIDAttrName(editor) : 'id';

          // Container mode anchors the shell to the scroll parent itself
          // so the sticky's scroll context and positioned containing
          // block match. Default walk would land on the editor's
          // unsized parent and size the shell to scrollHeight.
          const isScrollContainer = options.activeScrollParent instanceof Element;
          const hostResolver = options.outlineHost
            ?? (isScrollContainer
              ? (): HTMLElement => options.activeScrollParent as HTMLElement
              : resolveDefaultOutlineHost);
          const host = hostResolver(editorView);
          const nav = document.createElement('nav');
          nav.className = OUTLINE_CLASS;
          nav.setAttribute('aria-label', 'Document outline');
          nav.dataset['anchor'] = options.anchor;

          // Editor mode wraps the nav in a shell spanning the host's
          // full height. Viewport mode mounts the nav directly.
          let shell: HTMLElement | null = null;
          if (options.anchor === 'editor') {
            shell = document.createElement('div');
            shell.className = SHELL_CLASS;
            shell.dataset['anchor'] = options.anchor;
            shell.appendChild(nav);
            host.appendChild(shell);
          } else {
            host.appendChild(nav);
          }

          // Theme CSS keys off `data-scroll-mode` to switch between page-
          // scroll sticky and container-scroll sticky models.
          const scrollMode = isScrollContainer ? 'container' : 'page';
          nav.dataset['scrollMode'] = scrollMode;
          if (shell) shell.dataset['scrollMode'] = scrollMode;

          // Container mode: CSS `position: sticky` does the work. JS
          // publishes the variables the theme reads (`--dm-toc-ticks-max-h`,
          // `--dm-toc-mid-half-height`) and stretches the shell to
          // host.scrollHeight so sticky containment spans the full
          // scroll range. Clearing minHeight first avoids reading a
          // self-inflated scrollHeight.
          let containerResizeObserver: ResizeObserver | null = null;
          const recomputeContainerLayout = (): void => {
            if (!isScrollContainer) return;
            const sp = options.activeScrollParent as Element;
            nav.style.setProperty(
              '--dm-toc-ticks-max-h',
              `${(sp.clientHeight * 0.5).toFixed(2)}px`,
            );
            const h = nav.offsetHeight;
            if (h > 0) {
              nav.style.setProperty('--dm-toc-mid-half-height', `${(h / 2).toFixed(2)}px`);
            }
            if (shell) {
              shell.style.minHeight = '';
              shell.style.minHeight = `${String(sp.scrollHeight)}px`;
            }
          };
          if (isScrollContainer && typeof ResizeObserver !== 'undefined') {
            containerResizeObserver = new ResizeObserver(recomputeContainerLayout);
            containerResizeObserver.observe(nav);
            containerResizeObserver.observe(editorView.dom);
          }
          if (isScrollContainer) recomputeContainerLayout();

          let bottomObserver: IntersectionObserver | null = null;
          let bottomSentinel: HTMLElement | null = null;
          let recomputeMidTop: () => void = () => { /* no-op outside editor mode */ };
          if (
            options.anchor === 'editor'
            && !isScrollContainer
            && shell
            && typeof IntersectionObserver !== 'undefined'
          ) {
            const shellEl = shell;
            bottomSentinel = document.createElement('div');
            Object.assign(bottomSentinel.style, {
              position: 'absolute',
              bottom: '0',
              left: '0',
              width: '1px',
              height: '1px',
              pointerEvents: 'none',
            });
            shellEl.appendChild(bottomSentinel);

            // Three modes drive the nav's vertical position:
            //   middle - host bottom NOT in viewport: nav sticks at
            //            `calc(50vh - height/2)` (visually centered).
            //   center - host bottom in viewport from the start:
            //            shell flex-centers the nav at host middle.
            //   frozen - host bottom transitioned from NOT visible to
            //            visible (center -> middle scroll direction):
            //            inline `margin-top` pins the nav's natural at
            //            its captured doc position (avoids the visual
            //            jump that flex-center would cause mid-scroll).
            const setMode = (mode: 'middle' | 'center' | 'frozen'): void => {
              nav.dataset['mode'] = mode;
              shellEl.dataset['mode'] = mode;
              if (mode !== 'frozen') nav.style.marginTop = '';
            };

            // `top: calc(50vh - height/2)` (vs `50vh + translateY(-50%)`)
            // keeps the nav's BOX centered around 50vh, not just its
            // visual. The visual then matches the box exactly and is
            // fully constrained by the containing block - the outline
            // can never escape past the editor's bounds.
            recomputeMidTop = (): void => {
              const h = nav.offsetHeight;
              if (h <= 0) return;
              nav.style.setProperty('--dm-toc-mid-top', `calc(50vh - ${(h / 2).toFixed(2)}px)`);
            };
            recomputeMidTop();

            const writeBottomVisible = (visible: boolean): void => {
              const wasVisible = nav.dataset['bottomVisible'] === 'true';

              // Capture the pre-transition rect BEFORE flipping
              // attributes - updating `data-bottom-visible` reflows
              // the sticky offset, so a later `getBoundingClientRect`
              // would read the post-jump position.
              let frozenOffset: number | null = null;
              if (visible && !wasVisible) {
                const navRect = nav.getBoundingClientRect();
                if (navRect.height > 0 && navRect.top > 0) {
                  frozenOffset = navRect.top - shellEl.getBoundingClientRect().top;
                }
              }

              const value = visible ? 'true' : 'false';
              nav.dataset['bottomVisible'] = value;
              shellEl.dataset['bottomVisible'] = value;

              if (!visible) { setMode('middle'); return; }
              if (wasVisible) return;
              if (frozenOffset !== null) {
                nav.style.marginTop = `${String(frozenOffset)}px`;
                setMode('frozen');
              } else {
                setMode('center');
              }
            };

            // Seed initial state synchronously so the first paint
            // already reflects the right mode (no IO-callback flicker).
            const initialRect = bottomSentinel.getBoundingClientRect();
            const initialVisible =
              initialRect.bottom <= window.innerHeight && initialRect.bottom > 0;
            nav.dataset['bottomVisible'] = initialVisible ? 'true' : 'false';
            shellEl.dataset['bottomVisible'] = initialVisible ? 'true' : 'false';
            setMode(initialVisible ? 'center' : 'middle');

            bottomObserver = new IntersectionObserver(
              (entries) => {
                for (const entry of entries) writeBottomVisible(entry.isIntersecting);
              },
              { threshold: 0 },
            );
            // Observe synchronously. The initial IO callback fires
            // immediately after observe() and may run before first paint,
            // where `nav.offsetHeight` is 0 and the frozen-offset branch
            // in writeBottomVisible cannot compute a stable offset. The
            // `navRect.height > 0 && navRect.top > 0` guard inside
            // writeBottomVisible handles that case by falling back to
            // 'center' mode (no frozen pin) - the visual result is the
            // same in practice, and synchronous observe() keeps the
            // unit-test surface predictable.
            bottomObserver.observe(bottomSentinel);
          }

          // Editor-mode shell is `position: absolute` and needs a
          // non-static positioned ancestor. Force `relative` on the
          // host if it has no explicit positioning, restore on destroy.
          let hostPositionRestore: (() => void) | null = null;
          if (options.anchor === 'editor') {
            // jsdom returns '' instead of 'static' for unstyled elements,
            // so test against the positioned values instead.
            const computed = window.getComputedStyle(host).position;
            const isPositioned =
              computed === 'relative' ||
              computed === 'absolute' ||
              computed === 'fixed' ||
              computed === 'sticky';
            if (!isPositioned) {
              const prev = host.style.position;
              host.style.position = 'relative';
              hostPositionRestore = (): void => { host.style.position = prev; };
            }
          }

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
          let prevState: OutlineState | null = null;
          const applyState = (): void => {
            const state = computeState();
            nav.dataset['state'] = state;
            nav.dataset['viewport'] = isMobile() ? 'mobile' : 'desktop';
            // Recompute the card's viewport clamp ONLY on the transition
            // INTO expanded - not on every applyState call while already
            // expanded. Calling it again mid-click (a row receiving
            // focus re-fires focusin → applyState with state still
            // 'expanded') would re-measure a card already mid-fade-out
            // and clobber the existing shift, leaving the card visually
            // snapped back to its unshifted position.
            //
            // We also DO NOT clear the shift on collapse - doing so
            // triggers the transform transition (180ms) and the card
            // visibly slides back to its unshifted position during the
            // fade-out. The next expand calls `adjustCardPosition`,
            // which self-clears any stale value before recomputing.
            if (state === 'expanded' && prevState !== 'expanded') {
              requestAnimationFrame(adjustCardPosition);
              // Open the card at the first row; user scrolls for the rest.
              const card = nav.querySelector<HTMLElement>(`.${CARD_CLASS}`);
              if (card) card.scrollTop = 0;
            }
            prevState = state;
          };

          // Clamp the expanded card inside the viewport. When the nav
          // is near the top or bottom edge, the default
          // `top:50%; translateY(-50%)` would put the card off-screen;
          // we add a `--dm-toc-card-shift-y` to nudge it back in.
          //
          // Subtle: do NOT remove the existing shift before measuring -
          // `getBoundingClientRect` returns the visually-stale rect
          // during a transform transition (the browser hasn't repainted
          // the unshifted layout yet), which would falsely report "no
          // overflow" and leave the card unshifted on every other
          // expand. Instead, derive the natural (unshifted) position
          // by subtracting the current shift from the measured rect,
          // then write the new shift only when it actually changes.
          const CARD_VIEWPORT_MARGIN = 16;
          const adjustCardPosition = (): void => {
            const card = nav.querySelector<HTMLElement>(`.${CARD_CLASS}`);
            if (!card) return;
            const currentShift = parseFloat(
              card.style.getPropertyValue('--dm-toc-card-shift-y'),
            ) || 0;
            const rect = card.getBoundingClientRect();
            const naturalTop = rect.top - currentShift;
            const naturalBottom = rect.bottom - currentShift;
            const maxBottom = window.innerHeight - CARD_VIEWPORT_MARGIN;
            let shift = 0;
            if (naturalTop < CARD_VIEWPORT_MARGIN) {
              shift = CARD_VIEWPORT_MARGIN - naturalTop;
            } else if (naturalBottom > maxBottom) {
              shift = maxBottom - naturalBottom;
            }
            if (shift === currentShift) return;
            if (shift === 0) {
              card.style.removeProperty('--dm-toc-card-shift-y');
            } else {
              card.style.setProperty('--dm-toc-card-shift-y', `${String(shift)}px`);
            }
          };

          // Window scroll while expanded collapses the menu. The card
          // would otherwise lag the page or appear detached from any
          // anchored tick once the user starts reading.
          const onWindowScroll = (): void => {
            if (!isHoverActive && !isFocusWithin) return;
            cancelTimers();
            isHoverActive = false;
            isFocusWithin = false;
            applyState();
          };
          window.addEventListener('scroll', onWindowScroll, { passive: true });

          // ── Active-state tracker ─────────────────────────────────
          let manualOverrideUntil = 0;
          const writeActive = (id: string | null): void => {
            applyActiveMarker(nav, id);
            if (storage && storage.activeId !== id) {
              storage.activeId = id;
              // Fan out to other subscribers, skipping our own to avoid
              // a redundant re-render of the outline DOM.
              [...storage.subscribers].forEach((fn) => {
                if (fn === onStorageUpdate) return;
                try {
                  fn();
                } catch (err) {
                  // A misbehaving subscriber must not break the others. We log
                  // and continue so app authors see the failure during development.
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
            scrollToHeading(editorView, id, {
              attrName,
              scrollParent: options.activeScrollParent instanceof Element
                ? options.activeScrollParent
                : null,
            });
          };
          nav.addEventListener('click', onClick);

          // ── Hover timers ─────────────────────────────────────────
          // Asymmetric: short in-delay (don't expand on stray cursor
          // sweeps), longer out-delay (don't disappear under cursor).
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

          // ── Focus a11y ───────────────────────────────────────────
          // Keyboard users expand instantly on focus-in (no delay).
          // Focusout checks relatedTarget to avoid a flash when focus
          // moves between rows inside the same outline.
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
            tracker.observe(collectHeadingDoms(editorView, attrName, storage.content));
            applyActiveMarker(nav, storage.activeId);
            // Headings changed - nav height changed - re-center.
            recomputeMidTop();
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

          // 50vh changes with viewport height - re-center on resize.
          const onResize = (): void => { recomputeMidTop(); };
          window.addEventListener('resize', onResize);

          return {
            destroy(): void {
              cancelTimers();
              nav.removeEventListener('click', onClick);
              nav.removeEventListener('mouseenter', onMouseEnter);
              nav.removeEventListener('mouseleave', onMouseLeave);
              nav.removeEventListener('focusin', onFocusIn);
              nav.removeEventListener('focusout', onFocusOut);
              mq?.removeEventListener('change', onMqChange);
              window.removeEventListener('resize', onResize);
              window.removeEventListener('scroll', onWindowScroll);
              containerResizeObserver?.disconnect();
              tracker.destroy();
              unsubscribe?.();
              bottomObserver?.disconnect();
              bottomSentinel?.remove();
              (shell ?? nav).remove();
              hostPositionRestore?.();
            },
          };
        },
      }),
    ];
  },
});
