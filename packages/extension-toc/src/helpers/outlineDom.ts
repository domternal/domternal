/**
 * Small DOM helpers shared between the floating outline and the inline
 * `<TableOfContentsBlock>` node view. Both render heading lists with
 * the same fallback label and active-state semantics, so the logic
 * lives here as a single source of truth.
 */
import type { HeadingEntry } from '../types.js';
import { localizeMessage } from '@domternal/core';
import type { I18nService } from '@domternal/core';
import { tocMessages } from '../messages.js';

/** Preserve the text target of a pointer press while refreshing its wording. */
export function setLabelText(element: HTMLElement, value: string): void {
  const text = element.firstChild;
  if (text?.nodeType === 3 && text === element.lastChild) {
    if (text.nodeValue !== value) text.nodeValue = value;
  } else {
    element.textContent = value;
  }
}

/**
 * Display text for a heading entry. Falls back to a level-tagged
 * placeholder when the heading is empty so the outline always has a
 * non-empty label (and an accessible aria-label).
 */
export function getHeadingLabel(entry: HeadingEntry, i18n?: I18nService): string {
  return getHeadingCopy(entry, i18n).text;
}

/** User-authored headings retain their content language; only the empty fallback is UI copy. */
export function getHeadingCopy(entry: HeadingEntry, i18n?: I18nService): { text: string; language: string } {
  const text = entry.textContent.trim();
  if (text) return { text, language: entry.domNode?.closest('[lang]')?.getAttribute('lang') ?? '' };
  return localizeMessage(i18n, tocMessages.headingFallback, { level: entry.level });
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
