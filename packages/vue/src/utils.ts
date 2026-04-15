import { customRef } from 'vue';
import type { AppContext } from 'vue';
import type { Editor } from '@domternal/core';

/**
 * Creates a debounced ref that batches rapid updates into a single Vue re-render.
 *
 * The value is updated synchronously (get() always returns the latest value),
 * but the reactive trigger is deferred via double requestAnimationFrame.
 * This prevents multiple re-renders during a single frame when rapid
 * ProseMirror transactions fire (e.g. during typing).
 *
 * Improved over Tiptap's implementation: cancels previous rAFs on rapid
 * updates, ensuring only one trigger per double-frame window.
 */
export function useDebouncedRef<T>(initialValue: T) {
  let value = initialValue;
  let rafId1: number | undefined;
  let rafId2: number | undefined;

  return customRef<T>((track, trigger) => ({
    get() {
      track();
      return value;
    },
    set(newValue: T) {
      value = newValue;
      if (rafId1 !== undefined) cancelAnimationFrame(rafId1);
      if (rafId2 !== undefined) cancelAnimationFrame(rafId2);
      rafId1 = requestAnimationFrame(() => {
        rafId2 = requestAnimationFrame(() => {
          rafId1 = rafId2 = undefined;
          trigger();
        });
      });
    },
  }));
}

/**
 * Module-level store for Vue appContext per editor instance.
 *
 * Since we cannot modify the core Editor class (unlike Tiptap which
 * subclasses it), we use a WeakMap to associate each Editor with its
 * Vue appContext. This allows VueNodeViewRenderer to forward the
 * provide/inject chain from the parent component tree.
 *
 * The `provides` property MUST be a direct reference (not spread/copied)
 * to preserve Vue's prototype chain for inject resolution.
 *
 * WeakMap ensures no memory leaks when editors are garbage collected.
 */
export const appContextStore = new WeakMap<Editor, AppContext>();

/**
 * Pending appContext for editors currently being constructed.
 *
 * Node view constructors fire DURING `new Editor(...)` - before the editor
 * instance can be stored in appContextStore. To support `useCurrentEditor()`
 * and provide/inject inside node views, `provideEditor()` stashes the
 * appContext here. `useEditor()` reads it when creating the editor, then
 * clears it. VueNodeViewRenderer falls back to this when the per-editor
 * entry is not yet populated.
 */
export const pendingAppContextStore = { value: null as AppContext | null };
