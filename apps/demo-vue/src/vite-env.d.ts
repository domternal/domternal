/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

/**
 * Demo-only global handle to the current editor for E2E tests.
 * Assigned by each demo component on mount; cleared on unmount.
 */
interface Window {
  __DEMO_EDITOR__?: import('@domternal/core').Editor;
  /**
   * Notion demo exposes the `getListItemCursorContext` util so the
   * `notion-list-cursor-context.spec.ts` e2e suite can verify the
   * pure utility resolves correctly against the built dist (not just
   * the unit-test source path).
   */
  __DOMTERNAL_LIST_CTX__?: typeof import('@domternal/core').getListItemCursorContext;
}
