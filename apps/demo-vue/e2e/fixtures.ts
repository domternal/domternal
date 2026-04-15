import { test as base, type Page } from '@playwright/test';

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
      new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement && node.tagName === 'VITE-ERROR-OVERLAY') {
              node.remove();
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });
    await use(page);
  },
});

// =============================================================================
// Shared test helpers
// =============================================================================

export const EDITOR_SELECTOR = '.dm-editor .ProseMirror';
export const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

/**
 * Set editor content via __DEMO_EDITOR__ and focus the editor.
 * Waits briefly for the setContent to flush.
 */
export async function setContentAndFocus(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const editor = window.__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands['focus']?.();
    }
  }, html);
  await page.waitForTimeout(150);
}

/**
 * Programmatically focus the ProseMirror editor element.
 */
export async function focusEditor(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) el.focus();
  }, EDITOR_SELECTOR);
}

/**
 * Select a text range inside a child of the editor (default: first <p>).
 * Provide `childSelector` to target a different descendant (e.g. `h1`, `blockquote p`).
 */
export async function selectText(
  page: Page,
  startOffset: number,
  endOffset: number,
  childSelector = 'p',
): Promise<void> {
  await page.evaluate(
    ({ edSel, childSel, startOffset, endOffset }) => {
      const el = document.querySelector(`${edSel} ${childSel}`);
      if (!el || !el.firstChild) return;
      const range = document.createRange();
      range.setStart(el.firstChild, startOffset);
      range.setEnd(el.firstChild, endOffset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { edSel: EDITOR_SELECTOR, childSel: childSelector, startOffset, endOffset },
  );
  await page.waitForTimeout(150);
}
