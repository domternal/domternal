// @domternal/extension-block-menu — public API
//
// Notion-style block manipulation extensions. All features use the
// `FloatingMenuItem` contract and `addFloatingMenuItems()` hook from
// `@domternal/core`.

// FloatingMenu — empty-line insert menu trigger
export {
  FloatingMenu,
  createFloatingMenuPlugin,
  floatingMenuPluginKey,
} from './FloatingMenu.js';

export type {
  FloatingMenuOptions,
  CreateFloatingMenuPluginOptions,
  FloatingMenuKeymap,
} from './FloatingMenu.js';

// BlockHandle — hover gutter with plus button and drag handle
export {
  BlockHandle,
  createBlockHandlePlugin,
  blockHandlePluginKey,
} from './BlockHandle.js';

export type {
  BlockHandleOptions,
  BlockHandlePluginState,
  CreateBlockHandlePluginOptions,
} from './BlockHandle.js';

// KeyboardReorder — Mod-Shift-ArrowUp/Down moves top-level block
export { KeyboardReorder } from './KeyboardReorder.js';
