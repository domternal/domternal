/**
 * An open toolbar dropdown must behave like the menu it claims to be
 * (`role="menu"`): Escape dismisses it, and nothing floating over the editor
 * may steal a press aimed at one of its items.
 *
 * Both halves were broken and both were invisible to a mouse-free test. The
 * panel and the bubble menu shared z-index 50, so where they overlapped the
 * bubble menu painted on top and ate the click; and opening a dropdown with
 * the mouse leaves focus outside the toolbar, so its own keydown handler
 * never saw Escape.
 *
 * The wrappers own dismissal and the theme owns layering, so this runs
 * against all four demos.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';
/** Any toolbar control that opens a panel; alignment exists in every demo. */
const DROPDOWN = '.dm-toolbar [aria-label="Text Alignment"]';
const PANEL = '.dm-toolbar-dropdown-panel';

async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(EDITOR);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void }
      | undefined;
    editor?.setContent('<p>The sentence under the pointer.</p>', false);
  });
}

/** A real DOM selection, which is what raises the bubble menu. */
async function selectFirstWords(page: Page): Promise<void> {
  await page.evaluate((selector) => {
    const paragraph = document.querySelector(`${selector} p`);
    if (!paragraph?.firstChild) throw new Error('no paragraph');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 12);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const editorEl = document.querySelector(selector);
    if (editorEl instanceof HTMLElement) editorEl.focus();
  }, EDITOR);
}

for (const target of demoTargets) {
  test(`${target.name}: Escape closes a dropdown opened with the mouse`, async ({ page }) => {
    await openDemo(page, target);
    // Editor first: the everyday order, and the one that used to fail.
    await page.locator(EDITOR).click();
    await page.locator(DROPDOWN).click();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test(`${target.name}: Escape closes a dropdown opened with the keyboard`, async ({ page }) => {
    // The path that always worked, kept so the new listener cannot
    // double-handle it.
    await openDemo(page, target);
    const trigger = page.locator(DROPDOWN);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // Keyboard users get focus back on the trigger they came from.
    await expect(trigger).toBeFocused();
  });

  test(`${target.name}: an open dropdown paints above the bubble menu`, async ({ page }) => {
    await openDemo(page, target);
    await selectFirstWords(page);
    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');

    await page.locator(DROPDOWN).click();
    await expect(page.locator(PANEL)).toBeVisible();

    const layering = await page.evaluate(() => {
      const panel = document.querySelector('.dm-toolbar-dropdown-panel');
      const bubble = document.querySelector('.dm-bubble-menu');
      if (!panel || !bubble) return null;
      const panelRect = panel.getBoundingClientRect();
      const bubbleRect = bubble.getBoundingClientRect();
      const overlaps =
        panelRect.left < bubbleRect.right &&
        panelRect.right > bubbleRect.left &&
        panelRect.top < bubbleRect.bottom &&
        panelRect.bottom > bubbleRect.top;
      // Where they overlap, the panel must be what a press reaches.
      const hitX = Math.max(panelRect.left, bubbleRect.left) + 2;
      const hitY = Math.max(panelRect.top, bubbleRect.top) + 2;
      const hit = overlaps ? document.elementFromPoint(hitX, hitY) : null;
      return {
        panelZ: Number(getComputedStyle(panel).zIndex),
        bubbleZ: Number(getComputedStyle(bubble).zIndex),
        overlaps,
        hitInsidePanel: hit === null ? null : panel.contains(hit),
      };
    });

    expect(layering).not.toBeNull();
    // The invariant on any viewport: a deliberately opened menu outranks one
    // that merely followed the selection.
    expect(layering?.panelZ).toBeGreaterThan(layering?.bubbleZ ?? 0);
    if (layering?.overlaps === true) {
      expect(layering.hitInsidePanel).toBe(true);
    }
  });

  test(`${target.name}: a dropdown item applies while the bubble menu is up`, async ({ page }) => {
    // Not "is it on top" but "does pressing it work", which is what the
    // reader noticed.
    await openDemo(page, target);
    await selectFirstWords(page);
    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');

    await page.locator(DROPDOWN).click();
    const panel = page.locator(PANEL);
    await expect(panel).toBeVisible();
    await panel.locator('[aria-label="Align Center"]').click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const paragraph = document.querySelector('.dm-editor .ProseMirror p');
          return paragraph instanceof HTMLElement ? paragraph.style.textAlign : '';
        }),
      )
      .toBe('center');
  });
}
