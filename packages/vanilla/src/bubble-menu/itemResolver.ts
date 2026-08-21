/**
 * The bubble menu's item pipeline, which now lives in `@domternal/core`.
 *
 * It was written here first and copied into the React, Vue and Angular
 * wrappers, four transcriptions of one algorithm that had to be kept in step
 * by hand and were not: a single defect in it needed four identical fixes.
 * The implementation moved to core, where every renderer reads the same one.
 *
 * These names stay exported from this package because they always have been,
 * and a consumer building a menu of their own may be holding them. They are
 * the core functions under their original spelling, not wrappers, so there is
 * one behaviour and no drift to manage. New code should prefer the core
 * exports, whose names say which menu they belong to.
 */
export {
  buildBubbleItemMaps as buildItemMaps,
  resolveBubbleNames as resolveNames,
  getBubbleFormatItems as getFormatItems,
  detectBubbleContext as detectContext,
  filterBubbleItemsBySchema as filterBySchema,
  isInsideTableCell,
} from '@domternal/core';

export type {
  BubbleItemMaps as ItemMaps,
  BubbleMenuItem,
  BubbleMenuSeparator,
  SelectionShape,
  ResolvedPosShape,
} from '@domternal/core';
