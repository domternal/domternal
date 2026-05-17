import { PluginKey } from '@domternal/core';

/**
 * Create a unique PluginKey with collision-free suffix.
 *
 * Two instances of the same wrapper class mounted in the same editor (rare
 * but supported) need distinct keys to avoid ProseMirror plugin clashes.
 *
 * Why crypto.randomUUID + Math.random fallback: matches the framework
 * wrapper convention (angular, react, vue all use this pattern as of
 * commit fbef072). SSR may share Math.random seed across mount cycles,
 * giving collisions; crypto.randomUUID is collision-free by spec.
 */
export function createPluginKey(prefix: string): PluginKey {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const suffix =
    cryptoRef?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 8);
  return new PluginKey(prefix + '-' + suffix);
}
