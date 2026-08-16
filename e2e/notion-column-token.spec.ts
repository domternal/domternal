/**
 * Notion mode's column measure and the handle offset derived from it.
 *
 * The frame stays wide and the measure sits on the column, because the
 * centring whitespace is the room a docked sidebar slides the column into.
 * Both numbers come from `--dm-notion-column-width`, so every test here
 * checks the same invariant: the handle ends 4px before the text, at any
 * width and at any override. See the Notion mode guide for the reasoning.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const handleSelector = '.dm-block-handle';

/** The frame is the column's parent `.dm-editor`, derived from the target. */
function frameSelector(target: DemoTarget): string {
  return target.editorSelector.replace(/\s+\.ProseMirror$/, ' .dm-editor');
}

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

interface Rect {
  left: number;
  right: number;
  width: number;
}

async function rectOf(page: Page, selector: string): Promise<Rect> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { left: box.x, right: box.x + box.width, width: box.width };
}

/** Gap between the handle's right edge and the text; settles the hover tick. */
async function handleGapToText(page: Page, target: DemoTarget): Promise<number> {
  const paragraph = page.locator(`${target.editorSelector} > p`).first();
  await paragraph.hover();
  await expect(page.locator(handleSelector)).toHaveAttribute('data-show', '');
  await page.waitForTimeout(20);
  const handle = await rectOf(page, handleSelector);
  const box = await paragraph.boundingBox();
  if (!box) throw new Error('no paragraph box');
  return box.x - handle.right;
}

for (const target of demoTargets) {
  test.describe(`notion column measure [${target.name}]`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
    });

    test('the measure sits on the column and the frame keeps the whitespace beside it', async ({
      page,
    }) => {
      const column = await rectOf(page, target.editorSelector);
      const frame = await rectOf(page, frameSelector(target));

      // 44rem at a 16px root. A few px of slop for sub-pixel rounding.
      expect(column.width).toBeGreaterThanOrEqual(704 - 4);
      expect(column.width).toBeLessThanOrEqual(704 + 4);

      // The gap between the two is the room a docked panel pushes into.
      expect(frame.width).toBeGreaterThan(column.width);
      expect(column.left).toBeGreaterThan(frame.left);
      expect(column.right).toBeLessThan(frame.right);

      // Centred, within a px of rounding.
      const leftRoom = column.left - frame.left;
      const rightRoom = frame.right - column.right;
      expect(Math.abs(leftRoom - rightRoom)).toBeLessThanOrEqual(2);
    });

    test('the handle ends 4px before the text', async ({ page }) => {
      expect(await handleGapToText(page, target)).toBeGreaterThanOrEqual(2);
      expect(await handleGapToText(page, target)).toBeLessThanOrEqual(6);
    });

    test('overriding the column token moves the handle with it', async ({ page }) => {
      const before = await rectOf(page, target.editorSelector);

      // The token's whole reason for existing: the offset carries half the
      // measure, so a consumer must not have to restate it.
      await page.evaluate((selector) => {
        const frame = document.querySelector<HTMLElement>(selector);
        frame?.style.setProperty('--dm-notion-column-width', '30rem');
      }, frameSelector(target));
      await page.waitForTimeout(50);

      const after = await rectOf(page, target.editorSelector);
      expect(after.width).toBeLessThan(before.width);
      expect(after.width).toBeGreaterThanOrEqual(480 - 4); // 30rem
      expect(after.width).toBeLessThanOrEqual(480 + 4);

      // The handle followed the narrower column rather than staying put.
      expect(await handleGapToText(page, target)).toBeGreaterThanOrEqual(2);
      expect(await handleGapToText(page, target)).toBeLessThanOrEqual(6);
    });

    test('the handle keeps its 4px when the frame is narrower than the measure', async ({
      page,
    }) => {
      // Past the measure the column fills the frame and the centring term
      // clamps to zero. Driven by widening the token, not by shrinking the
      // viewport: the demo card never narrows past its own content.
      await page.evaluate((selector) => {
        const frame = document.querySelector<HTMLElement>(selector);
        frame?.style.setProperty('--dm-notion-column-width', '400rem');
      }, frameSelector(target));
      await page.waitForTimeout(50);

      const column = await rectOf(page, target.editorSelector);
      const frame = await rectOf(page, frameSelector(target));
      expect(column.width).toBeLessThan(400 * 16);
      expect(Math.abs(column.left - frame.left)).toBeLessThanOrEqual(2);

      expect(await handleGapToText(page, target)).toBeGreaterThanOrEqual(2);
      expect(await handleGapToText(page, target)).toBeLessThanOrEqual(6);
    });
  });
}
