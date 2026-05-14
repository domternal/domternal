// @domternal/extension-toc - public API.
// Id assignment is owned by UniqueID from `@domternal/core`; TOC reads but
// does not write ids.

export { TableOfContents, tocPluginKey } from './TableOfContents.js';
export type { HeadingEntry, TableOfContentsOptions, TocStorage } from './types.js';

export { walkHeadings } from './helpers/headingWalk.js';
export type { HeadingWalkEntry, HeadingWalkOptions } from './helpers/headingWalk.js';
export { scrollToHeading } from './helpers/scrollToHeading.js';
export type { ScrollToHeadingOptions } from './helpers/scrollToHeading.js';
export { createActiveStateTracker } from './helpers/activeStateTracker.js';
export type {
  ActiveStateTracker,
  ActiveStateTrackerOptions,
} from './helpers/activeStateTracker.js';

export {
  FloatingTocOutline,
  floatingTocOutlinePluginKey,
} from './FloatingTocOutline.js';
export type { FloatingTocOutlineOptions } from './FloatingTocOutline.js';

export { TableOfContentsBlock } from './TableOfContentsBlock.js';
export type { TableOfContentsBlockOptions } from './TableOfContentsBlock.js';
