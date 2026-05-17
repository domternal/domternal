/**
 * @domternal/vanilla
 *
 * Polished DOM components for the Domternal rich-text editor.
 * Use in Astro, Svelte, Solid, plain HTML - anywhere without a framework runtime.
 *
 * Phase 1 scaffold: only shared utilities are exported.
 * Components (DomternalEditor, DomternalToolbar, DomternalBubbleMenu,
 * DomternalFloatingMenu, DomternalEmojiPicker, DomternalNotionColorPicker)
 * are added in subsequent phases.
 */

// Shared utilities (public, exposed for power users + framework adapters)
export { isBrowser, assertBrowser } from './shared/isBrowser.js';
export { createPluginKey } from './shared/pluginKey.js';
export { renderIconInto, resolveIcon } from './shared/iconRenderer.js';
export { subscribe } from './shared/eventTarget.js';
export type { CustomContentOption } from './shared/types.js';
