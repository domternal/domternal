import { getCurrentInstance, inject, provide, shallowRef, watchEffect } from 'vue';
import type { InjectionKey, ShallowRef } from 'vue';
import type { Editor } from '@domternal/core';
import { appContextStore } from './utils.js';

/**
 * Typed injection key for the editor instance.
 * Components use this via provide/inject to share the editor
 * without prop drilling.
 */
export const EDITOR_KEY: InjectionKey<ShallowRef<Editor | null>> = Symbol('domternal-editor');

/**
 * Provides an editor instance to all descendant components via Vue's
 * provide/inject system. Also stores the appContext in the WeakMap
 * for VueNodeViewRenderer to forward the provide/inject chain.
 *
 * @example
 * ```ts
 * const { editor } = useEditor({ extensions, content });
 * provideEditor(editor);
 * ```
 */
export function provideEditor(editor: ShallowRef<Editor | null>): void {
  provide(EDITOR_KEY, editor);

  // Store appContext for VueNodeViewRenderer
  const instance = getCurrentInstance();
  if (instance) {
    watchEffect(() => {
      const ed = editor.value;
      if (ed) {
        // The provides property MUST be a direct reference (not spread)
        // to preserve Vue's prototype chain for inject resolution.
        appContextStore.set(ed, {
          ...instance.appContext,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provides: (instance as any).provides,
        });
      }
    });
  }
}

/**
 * Access the editor instance from the nearest provider.
 *
 * @returns `{ editor }` where editor is a ShallowRef that may be null
 *   if the provider has no editor yet or if used outside a provider.
 *
 * @example
 * ```ts
 * const { editor } = useCurrentEditor();
 * if (editor.value) {
 *   editor.value.commands.toggleBold();
 * }
 * ```
 */
export function useCurrentEditor(): { editor: ShallowRef<Editor | null> } {
  const editor = inject(EDITOR_KEY, shallowRef(null));
  return { editor };
}
