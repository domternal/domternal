/**
 * scrollToHeading - smooth-scroll to a heading by its stable id.
 *
 * Pure DOM operation, no PM transaction. Pulls the heading element
 * out of the editor view's DOM (via the configured `attrName`, default
 * `'id'`), opens any collapsed `<details>` ancestor along the way,
 * scrolls into view, and updates the URL hash via `history.replaceState`.
 *
 * Used directly by `editor.commands.scrollToHeading`, by the floating
 * outline click handler, by the inline /toc block links, and by the
 * initial-load hash navigation.
 *
 * Native browser hash navigation (`<a href="#id">`) handles the same
 * scroll automatically when the heading uses native HTML `id`. This
 * helper still exists for: open-collapsed-`<details>` ancestors (browser
 * doesn't), programmatic API (`editor.commands.scrollToHeading(id)`),
 * and `prefers-reduced-motion` respect with override.
 *
 * Key contracts:
 *   - DOM lookup is scoped to `view.dom` (multi-editor safe; same id
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
  /**
   * Attribute name on the target heading element that holds the id we
   * are scrolling to. Defaults to `'id'`, matching UniqueID's default
   * `attributeName`. Override only when the consumer customizes
   * `UniqueID.configure({ attributeName })`.
   * @default 'id'
   */
  attrName?: string;
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
 * Smooth-scroll the view to the heading whose `attrName` attribute
 * matches `id`. Returns `true` if the heading was found (and the
 * scroll/hash side effects ran), `false` if the ID is unknown to this
 * editor.
 */
export function scrollToHeading(
  view: EditorView,
  id: string,
  options: ScrollToHeadingOptions = {},
): boolean {
  if (!id) return false;

  const attrName = options.attrName ?? 'id';

  // CSS.escape protects against IDs containing CSS special characters.
  // UUID-style ids (UniqueID's default) are safe, but a consumer-supplied
  // `generateID` override (e.g. slugify) might produce dots, colons, or
  // other selector-breaking characters - escape unconditionally.
  const escaped = typeof CSS !== 'undefined' ? CSS.escape(id) : id;
  const selector = `[${attrName}="${escaped}"]`;
  const target = view.dom.querySelector<HTMLElement>(selector);
  if (!target) return false;

  openCollapsedDetailsAncestors(target, view.dom);

  const behavior: ScrollBehavior =
    options.behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');
  target.scrollIntoView({ behavior, block: 'start' });

  if (options.updateHash !== false && typeof history !== 'undefined') {
    // Encode the id for the URL fragment. Default IDs are URL-safe
    // (UUID hex segments), but a consumer-supplied `generateID` (e.g.
    // slugify) may produce characters that need encoding (`#`, `&`,
    // spaces, non-ASCII).
    history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  }

  return true;
}
