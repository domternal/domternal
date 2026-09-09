import { test as base } from '@playwright/test';

/**
 * Extended Playwright test fixture that auto-removes the Vite error overlay.
 *
 * During parallel test runs, Vite's dev server occasionally produces transient
 * compilation warnings that inject a <vite-error-overlay> custom element.
 * This overlay intercepts all pointer events and causes click actions to time out.
 *
 * The MutationObserver below removes the overlay as soon as it appears.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      // Init scripts can run before WebKit creates document.documentElement.
      // Document already exists and includes the root and all later descendants.
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement && node.tagName === 'VITE-ERROR-OVERLAY') {
              node.remove();
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await use(page);
  },
});
