import { PluginKey } from '@domternal/core';

/**
 * Create a unique `PluginKey` with collision-free suffix.
 *
 * Two instances of the same wrapper class mounted in the same editor (rare
 * but supported) need distinct keys to avoid ProseMirror plugin clashes.
 *
 * Why crypto.randomUUID + Math.random fallback: matches the framework
 * wrapper convention (angular, react, vue all use this pattern as of
 * commit fbef072). SSR may share Math.random seed across mount cycles,
 * giving collisions; crypto.randomUUID is collision-free by spec.
 *
 * @param prefix - Human-readable prefix for debugging. Convention: kebab or
 *   camel case identifying the wrapper. e.g. `'vanillaBubbleMenu'`.
 * @returns A `PluginKey` with format `<prefix>-<8-char-suffix>`.
 *
 * @example
 * ```ts
 * import { createPluginKey } from '@domternal/vanilla';
 *
 * class MyBubbleMenu {
 *   #pluginKey = createPluginKey('myBubbleMenu');
 *
 *   constructor(editor: Editor) {
 *     const plugin = createBubbleMenuPlugin({
 *       pluginKey: this.#pluginKey,
 *       editor,
 *       element: this.host,
 *     });
 *     editor.registerPlugin(plugin);
 *   }
 *
 *   destroy() {
 *     this.editor.unregisterPlugin(this.#pluginKey);
 *   }
 * }
 * ```
 */
export function createPluginKey(prefix: string): PluginKey {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const suffix =
    cryptoRef?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8);
  return new PluginKey(prefix + '-' + suffix);
}
