/**
 * Public types for `@domternal/extension-toc`.
 *
 * Phase 1 placeholder. Phase 2 fills these in with HeadingEntry / TocStorage
 * / TableOfContentsOptions per `_planning/notion_toc_1.md` section 4.1.
 */

export interface HeadingEntry {
  /** Stable identifier written as `data-toc-id` on the heading element. */
  id: string;
  /** Heading level (1-6). */
  level: number;
  /** Plain text contents of the heading. */
  textContent: string;
  /** ProseMirror document position. */
  pos: number;
  /** Resolved DOM node, or null before first scroll/observer pass. */
  domNode: HTMLElement | null;
  /** True for the heading the user is currently "at" per scroll position. */
  isActive: boolean;
  /** True for headings that have already scrolled past the top of the viewport. */
  isScrolledOver: boolean;
}

export interface TocStorage {
  content: HeadingEntry[];
  activeId: string | null;
}
