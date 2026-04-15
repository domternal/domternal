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
}
