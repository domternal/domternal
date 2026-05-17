/**
 * SSR-safe environment check.
 *
 * `@domternal/vanilla` classes construct DOM nodes and attach listeners on
 * `document` / `window`. During SSR (Astro/Nuxt/Next.js build), the module
 * may be imported but constructors must NOT run server-side.
 *
 * Class constructors call `assertBrowser()` early to throw a clear error
 * if invoked outside a browser environment.
 *
 * @example
 * ```ts
 * import { isBrowser, assertBrowser } from '@domternal/vanilla';
 *
 * if (isBrowser) {
 *   const editor = new DomternalEditor(host, { editor });
 * }
 *
 * // Or, in a constructor that requires browser:
 * class MyWrapper {
 *   constructor(host: HTMLElement) {
 *     assertBrowser('MyWrapper');
 *     // ... safe to use document/window from here
 *   }
 * }
 * ```
 */
export const isBrowser: boolean =
  typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * Assert the current environment is a browser. Throws with an actionable
 * error message tailored to common SSR frameworks (Astro, Nuxt, Next.js).
 *
 * @param className - Name of the calling class, included in the error
 *   message so users can identify the culprit constructor in a stack trace.
 *
 * @throws Error if called server-side.
 */
export function assertBrowser(className: string): void {
  if (!isBrowser) {
    throw new Error(
      `[${className}] requires a browser environment. ` +
        `If using Astro, wrap with <client:only="vanilla"> or instantiate inside a <script> tag. ` +
        `If using Nuxt/Next.js, gate construction with a typeof window check.`,
    );
  }
}
