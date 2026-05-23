/**
 * Small DOM helpers shared between the floating outline and the inline
 * `<TableOfContentsBlock>` node view. Both render heading lists with
 * the same fallback label and active-state semantics, so the logic
 * lives here as a single source of truth.
 */
import type { HeadingEntry } from '../types.js';

/**
 * Display text for a heading entry. Falls back to a level-tagged
 * placeholder when the heading is empty so the outline always has a
 * non-empty label (and an accessible aria-label).
 */
export function getHeadingLabel(entry: HeadingEntry): string {
  return entry.textContent.trim() || `Heading level ${String(entry.level)}`;
}

/**
 * Toggle the active-state visual on a list of button elements. At
 * most one item matches `activeId` (via `data-toc-anchor`) and gets
 * `activeClass` + `aria-current="location"`; the rest are cleared.
 */
export function setActiveMarker(
  items: HTMLElement[],
  activeId: string | null,
  activeClass: string,
): void {
  for (const item of items) {
    const isActive = activeId !== null && item.dataset['tocAnchor'] === activeId;
    item.classList.toggle(activeClass, isActive);
    if (isActive) item.setAttribute('aria-current', 'location');
    else item.removeAttribute('aria-current');
  }
}
