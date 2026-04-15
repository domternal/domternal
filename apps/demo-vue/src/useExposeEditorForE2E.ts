import { watch, onBeforeUnmount } from 'vue';
import type { ShallowRef } from 'vue';
import type { Editor } from '@domternal/core';

/**
 * Demo-only: expose the editor as `window.__DEMO_EDITOR__` for Playwright
 * E2E tests. Synced reactively; cleared on unmount.
 */
export function useExposeEditorForE2E(editor: ShallowRef<Editor | null>) {
  watch(
    editor,
    (ed) => {
      window.__DEMO_EDITOR__ = ed ?? undefined;
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    window.__DEMO_EDITOR__ = undefined;
  });
}
