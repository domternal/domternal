/**
 * SSR-safe environment check.
 *
 * `@domternal/vanilla` classes construct DOM nodes and attach listeners on
 * `document` / `window`. During SSR (Astro/Nuxt/Next.js build), the module
 * may be imported but constructors must NOT run server-side.
 *
 * Class constructors call `assertBrowser()` early - throws a clear error
 * if invoked outside a browser environment.
 */
export const isBrowser: boolean =
  typeof window !== 'undefined' && typeof document !== 'undefined';

export function assertBrowser(className: string): void {
  if (!isBrowser) {
    throw new Error(
      `[${className}] requires a browser environment. ` +
        `If using Astro, wrap with <client:only="vanilla"> or instantiate inside a <script> tag. ` +
        `If using Nuxt/Next.js, gate construction with a typeof window check.`,
    );
  }
}
