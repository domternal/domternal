/**
 * The block handle must not linger after the block it points at is deleted.
 *
 * A doc change that removes the hovered block clears `hoveredPos` but leaves the
 * handle shown at a stale row, where the next pointer move hits the freeze gate
 * in `onMouseMove` and locks onto the dead position: the root cause behind the
 * BlockContextMenu-Delete and matrix-sweep failures. The fix (BlockHandle.ts:
 * the `view.update` retract plus the `onMouseMove` backstop) is guarded here
 * across all four demos.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const handleSelector = '.dm-block-handle';

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

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

async function showHandleOn(page: Page, target: DemoTarget, text: string): Promise<void> {
  await page.locator(`${target.editorSelector} > p`, { hasText: text }).hover();
  await expect(page.locator(handleSelector)).toHaveAttribute('data-show', '');
  await page.waitForTimeout(20);
}

async function blockTop(page: Page, target: DemoTarget, text: string): Promise<number> {
  const box = await page.locator(`${target.editorSelector} > p`, { hasText: text }).boundingBox();
  if (!box) throw new Error(`no box for "${text}"`);
  return box.y;
}

async function handleTop(page: Page): Promise<number> {
  const box = await page.locator(handleSelector).boundingBox();
  if (!box) throw new Error('no handle box');
  return box.y;
}

for (const target of demoTargets) {
  test.describe(`${target.name} block handle stale hover`, () => {
    test('the handle retracts when its hovered block is deleted, freeing the next hover', async ({
      page,
    }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');

      // Hover the middle block: the handle appears on Bravo's row.
      await showHandleOn(page, target, 'Bravo');
      expect(Math.abs((await handleTop(page)) - (await blockTop(page, target, 'Bravo')))).toBeLessThan(24);

      // Delete Bravo (the hovered block). The handle must retract rather than
      // hang at Bravo's old row.
      await setContent(page, '<p>Alpha</p><p>Charlie</p>');
      await expect(page.locator(handleSelector)).not.toHaveAttribute('data-show', '');

      // The next hover must resolve fresh: on the buggy build the stale handle
      // froze the pointer, so hovering Charlie left the handle where Bravo was.
      await showHandleOn(page, target, 'Charlie');
      expect(Math.abs((await handleTop(page)) - (await blockTop(page, target, 'Charlie')))).toBeLessThan(24);
    });
  });
}
