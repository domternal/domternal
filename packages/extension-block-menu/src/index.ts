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
