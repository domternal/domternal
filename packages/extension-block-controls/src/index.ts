// @domternal/extension-block-controls - public API
//
// Notion-style block manipulation extensions, built on the `FloatingMenuItem`
// contract and `addFloatingMenuItems()` hook from `@domternal/core`.

// FloatingMenu - empty-line insert menu trigger
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

// BlockHandle - hover gutter with plus button and drag handle
export {
  BlockHandle,
  createBlockHandlePlugin,
  blockHandlePluginKey,
  DEFAULT_NESTED_NODES,
} from './BlockHandle.js';

export type {
  BlockHandleOptions,
  BlockHandlePluginState,
  CreateBlockHandlePluginOptions,
  DropZoneProvider,
  DropZoneQuery,
  NestedConfig,
} from './BlockHandle.js';

// Block-matcher primitives for custom matchers passed through
// `BlockHandle.configure({ nested: { matchers: [...] } })`.
export type { BlockMatcher, BlockCandidate, MatchVerdict } from './helpers/blockMatcher.js';
export { DEFAULT_BLOCK_MATCHERS } from './helpers/defaultMatchers.js';

// KeyboardReorder - Mod-Shift-ArrowUp/Down moves top-level block
export { KeyboardReorder } from './KeyboardReorder.js';

// BlockContextMenu - click drag handle to open Delete / Duplicate / Turn into
export {
  BlockContextMenu,
  createBlockContextMenuPlugin,
  blockContextMenuPluginKey,
} from './BlockContextMenu.js';

export type {
  BlockContextMenuOptions,
  CreateBlockContextMenuPluginOptions,
  TurnIntoTarget,
} from './BlockContextMenu.js';

// Editor commands the Turn into menu routes to for wrapper (non-textblock)
// targets. Type the `command` field on custom `turnIntoTargets` entries.
export type { WrapperCommand } from './helpers/turnIntoWrapper.js';

// SlashCommand - type `/` to open filtered insert menu popup
export {
  SlashCommand,
  createSlashCommandPlugin,
  slashCommandPluginKey,
  dismissSlashCommand,
  filterSlashItems,
} from './SlashCommand.js';

export type {
  SlashCommandOptions,
  SlashCommandProps,
  SlashCommandRenderer,
  SlashCommandPluginState,
  CreateSlashCommandPluginOptions,
} from './SlashCommand.js';

// Default DOM renderer for the SlashCommand popup
export { createSlashSuggestionRenderer } from './createSlashSuggestionRenderer.js';

// SmartPaste - preserves block formatting when pasting at inline positions
export { SmartPaste } from './SmartPaste.js';
export type { SmartPasteOptions } from './SmartPaste.js';
