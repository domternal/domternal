// @domternal/extension-toc - public API
//
// Notion-style Table of Contents. Three opt-in pieces:
// - TableOfContents: data layer (heading discovery + IDs + active state)
// - FloatingTocOutline: right-rail collapsed/expanded panel (Phase 4-6)
// - TableOfContentsBlock: inline /toc PM node (Phase 7)
//
// Phase 1 ships only the data-layer placeholder; UI pieces land in later phases.

// Data layer (Phase 2): heading discovery, IDs, storage. Required for
// any of the UI pieces below to work.
export { TableOfContents, tocPluginKey } from './TableOfContents.js';
export type { HeadingEntry, TableOfContentsOptions, TocStorage } from './types.js';

// Lower-level helpers - exported so consumers can reuse the heading
// walk / ID assignment / scroll utilities outside the bundled
// extension (e.g. server-side rendering, custom plugins).
export { walkHeadings } from './helpers/headingWalk.js';
export type { HeadingWalkEntry, HeadingWalkOptions } from './helpers/headingWalk.js';
export { assignMissingTocIds } from './helpers/tocIdAttribute.js';
export type { AssignTocIdsOptions } from './helpers/tocIdAttribute.js';
export { scrollToHeading } from './helpers/scrollToHeading.js';
export type { ScrollToHeadingOptions } from './helpers/scrollToHeading.js';
export { createActiveStateTracker } from './helpers/activeStateTracker.js';
export type {
  ActiveStateTracker,
  ActiveStateTrackerOptions,
} from './helpers/activeStateTracker.js';

// UI: floating right-rail outline. Phase 4-6 ships the full
// collapsed/expanded outline with active-state highlighting and
// hover-expanded card.
export {
  FloatingTocOutline,
  floatingTocOutlinePluginKey,
} from './FloatingTocOutline.js';
export type { FloatingTocOutlineOptions } from './FloatingTocOutline.js';

// UI: inline `/toc` block (Phase 7). PM node + slash menu item
// rendered as a regular document block. NodeView reactively reflects
// the heading list and shares the active-state contract with the
// floating outline.
export { TableOfContentsBlock } from './TableOfContentsBlock.js';
export type { TableOfContentsBlockOptions } from './TableOfContentsBlock.js';
