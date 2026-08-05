/**
 * The trailing "A" trigger needs a live notionColorOpen listener (the picker
 * panel); without one it used to render dead. Pins both halves per framework.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function selectFirstWord(page: Page, target: DemoTarget): Promise<void> {
  await page.evaluate((selector) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
      setContent: (h: string, emit: boolean) => void;
    };
    ed.setContent('<p>guard probe text</p>', false);
    const paragraph = document.querySelector(`${selector} p`);
    if (!paragraph?.firstChild) throw new Error('no paragraph');
    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const editorEl = document.querySelector(selector);
    if (editorEl instanceof HTMLElement) editorEl.focus();
  }, target.editorSelector);
  await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
}

for (const target of demoTargets) {
  test(`${target.name}: the color trigger shows while the picker listens and hides once nothing does`, async ({ page }) => {
    await goNotion(page, target);
    await selectFirstWord(page, target);

    // Panel mounted: trigger present and functional.
    const trigger = page.locator('.dm-ncp-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(page.locator('.dm-notion-color-picker')).toBeVisible();
    await page.keyboard.press('Escape');

    // Drop every listener (an app that never mounted the panel): trigger hides.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        off: (event: string) => void;
      };
      ed.off('notionColorOpen');
    });
    await selectFirstWord(page, target);
    await expect(page.locator('.dm-ncp-trigger')).toHaveCount(0);
  });
}
