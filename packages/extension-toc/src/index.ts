// @domternal/extension-toc - public API
//
// Notion-style Table of Contents. Three opt-in pieces:
// - TableOfContents: data layer (heading discovery + IDs + active state)
// - FloatingTocOutline: right-rail collapsed/expanded panel (Phase 4-6)
// - TableOfContentsBlock: inline /toc PM node (Phase 7)
//
// Phase 1 ships only the data-layer placeholder; UI pieces land in later phases.

export { TableOfContents } from './TableOfContents.js';
export {
  FloatingTocOutline,
  floatingTocOutlinePluginKey,
} from './FloatingTocOutline.js';
export type { HeadingEntry, TocStorage } from './types.js';
