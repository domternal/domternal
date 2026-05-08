/**
 * scrollToHeading - smooth-scroll to a heading by its tocId.
 *
 * Pure DOM operation, no PM transaction. Pulls the heading element
 * out of the editor view's DOM, opens any collapsed `<details>`
 * ancestor along the way, scrolls into view, and updates the URL hash
 * via `history.replaceState`. Used directly by `editor.commands.scrollToHeading`,
 * by Phase 4's floating outline click handler, by Phase 7's inline
 * /toc block links, and by the initial-load hash navigation.
 *
 * Key contracts:
 *   - DOM lookup is scoped to `view.dom` (multi-editor safe; same tocId
 *     in two editors does not cross-fire).
 *   - On a missing ID, returns false and DOES NOT touch the URL hash -
 *     a stray fragment in the URL stays as the user wrote it.
 *   - Respects `prefers-reduced-motion` by default; explicit override
 *     via `options.behavior`.
 *   - Updates URL hash via `replaceState` (not `pushState`) so the
 *     browser back-stack does not fill up with one entry per click.
 */
import type { EditorView } from '@domternal/pm/view';

export interface ScrollToHeadingOptions {
  /**
   * Override scroll behavior. By default, respects
   * `prefers-reduced-motion: reduce` (instant) and falls back to smooth.
   */
  behavior?: ScrollBehavior;
  /**
   * If false, skips the URL hash update. Use this when navigating from
   * a context that owns the URL itself (e.g. an SPA router).
   * @default true
   */
  updateHash?: boolean;
}

/**
 * Resolve the user's reduced-motion preference. Returns `false` in
 * environments without `matchMedia` (SSR, very old jsdom).
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Walk up from `node` toward `boundary` (exclusive), force-opening
 * every collapsed `<details>` ancestor along the path. The returned
 * boolean is informational - callers that already know they want to
 * scroll afterwards do not need to inspect it.
 */
function openCollapsedDetailsAncestors(node: HTMLElement, boundary: HTMLElement): boolean {
  let opened = false;
  let walker: HTMLElement | null = node.parentElement;
  while (walker && walker !== boundary) {
    if (walker instanceof HTMLDetailsElement && !walker.open) {
      walker.open = true;
      opened = true;
    }
    walker = walker.parentElement;
  }
  return opened;
}

/**
 * Smooth-scroll the view to the heading whose `data-toc-id` matches `id`.
 * Returns `true` if the heading was found (and the scroll/hash side
 * effects ran), `false` if the ID is unknown to this editor.
 */
export function scrollToHeading(
  view: EditorView,
  id: string,
  options: ScrollToHeadingOptions = {},
): boolean {
  if (!id) return false;

  // CSS.escape protects against IDs containing CSS special characters.
  // Our default generator never produces them (8-char base36), but a
  // consumer's `generateId` override might (e.g. slugify producing dots
  // or colons), so escape unconditionally.
  const selector = `[data-toc-id="${typeof CSS !== 'undefined' ? CSS.escape(id) : id}"]`;
  const target = view.dom.querySelector<HTMLElement>(selector);
  if (!target) return false;

  openCollapsedDetailsAncestors(target, view.dom);

  const behavior: ScrollBehavior =
    options.behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');
  target.scrollIntoView({ behavior, block: 'start' });

  if (options.updateHash !== false && typeof history !== 'undefined') {
    history.replaceState(null, '', `#${id}`);
  }

  return true;
}
