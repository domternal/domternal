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
// walk / ID assignment outside the bundled extension (e.g. server-side
// rendering, custom plugins).
export { walkHeadings } from './helpers/headingWalk.js';
export type { HeadingWalkEntry, HeadingWalkOptions } from './helpers/headingWalk.js';
export { assignMissingTocIds } from './helpers/tocIdAttribute.js';
export type { AssignTocIdsOptions } from './helpers/tocIdAttribute.js';

// UI: floating right-rail outline. Phase 1 ships the spike (hello div);
// Phase 4 swaps it for real ticks + click navigation.
export {
  FloatingTocOutline,
  floatingTocOutlinePluginKey,
} from './FloatingTocOutline.js';
