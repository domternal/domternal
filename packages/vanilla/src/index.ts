/**
 * @domternal/vanilla
 *
 * Polished DOM components for the Domternal rich-text editor.
 * Use in Astro, Svelte, Solid, plain HTML - anywhere without a framework runtime.
 */

// Shared utilities (public, exposed for power users + framework adapters)
export { isBrowser, assertBrowser } from './shared/isBrowser.js';
export { createPluginKey } from './shared/pluginKey.js';
export { renderIconInto, resolveIcon } from './shared/iconRenderer.js';
export { subscribe } from './shared/eventTarget.js';
export type { CustomContentOption } from './shared/types.js';

// Editor
export { DomternalEditor, DEFAULT_EXTENSIONS } from './editor/DomternalEditor.js';
export type { DomternalEditorOptions } from './editor/DomternalEditor.js';

// Toolbar
export { DomternalToolbar } from './toolbar/DomternalToolbar.js';
export type { DomternalToolbarOptions } from './toolbar/DomternalToolbar.js';
export { getTooltip } from './toolbar/tooltip.js';
export { createIconCache, DROPDOWN_CARET } from './toolbar/iconCache.js';
export type { IconCache } from './toolbar/iconCache.js';
export { getComputedStyleAtCursor, getInlineStyleAtCursor } from './toolbar/computedStyle.js';

// Bubble menu
export { DomternalBubbleMenu } from './bubble-menu/DomternalBubbleMenu.js';
export type {
  DomternalBubbleMenuOptions,
  BubbleMenuItem,
  BubbleMenuTrailingState,
} from './bubble-menu/DomternalBubbleMenu.js';
export { INITIAL_TRAILING_STATE, computeTrailingState } from './bubble-menu/trailingState.js';
export {
  buildItemMaps,
  resolveNames,
  getFormatItems,
  detectContext,
  filterBySchema,
  isInsideTableCell,
} from './bubble-menu/itemResolver.js';
export type {
  ItemMaps,
  BubbleMenuSeparator,
  SelectionShape,
  ResolvedPosShape,
} from './bubble-menu/itemResolver.js';

// Floating menu (block-insert)
export { DomternalFloatingMenu } from './floating-menu/DomternalFloatingMenu.js';
export type { DomternalFloatingMenuOptions } from './floating-menu/DomternalFloatingMenu.js';
