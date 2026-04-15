import { getCurrentInstance, inject, provide, shallowRef, watchEffect } from 'vue';
import type { InjectionKey, ShallowRef } from 'vue';
import type { Editor } from '@domternal/core';
import { appContextStore, pendingAppContextStore } from './utils.js';

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

  // Store appContext for VueNodeViewRenderer.
  // We must preserve the original appContext object (not spread it) so that
  // config, mixins, and the prototype chain remain intact. The provides
  // property is overridden with the component instance's provides to ensure
  // Vue's prototype-chain-based inject resolution works in node views.
  const instance = getCurrentInstance();
  if (instance) {
    const buildCtx = () => {
      const ctx = Object.create(instance.appContext) as typeof instance.appContext;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ctx as any).provides = (instance as any).provides;
      return ctx;
    };

    // Set pending context immediately so node view constructors firing during
    // new Editor() (before editor.value is assigned) can find it.
    pendingAppContextStore.value = buildCtx();

    watchEffect(() => {
      const ed = editor.value;
      if (ed) {
        appContextStore.set(ed, buildCtx());
        // Clear pending once the per-editor entry is populated.
        pendingAppContextStore.value = null;
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
