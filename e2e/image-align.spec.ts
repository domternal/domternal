/**
 * Image placement in the Notion demos, across all four frameworks.
 *
 * The demos create their editors with `preset: 'notion'`; the Image
 * extension follows the preset and swaps the four float controls for three
 * alignment controls. Alignment only MOVES the picture inside the measure;
 * the text stays below it, which is what Notion does and what both export
 * backends can reproduce exactly, since alignment is a paragraph property
 * in Word and in the PDF while wrapping is a layout the two formats support
 * to different depths.
 *
 * The two placements are separate attributes on purpose, so the document
 * records which of them the author actually saw. This spec pins the Notion
 * half: the preset paints the theme class itself, the align controls are
 * the ones on offer, they position the picture, and nothing comes up
 * beside it.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/** 1x1 red PNG; `width` decides the box, `height: auto` keeps it square. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const IMAGE_WIDTH = 200;

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 }
  );
}

/** One picture followed by a paragraph, which is the layout the spec measures. */
async function setImageDocument(page: Page): Promise<void> {
  await page.evaluate(
    ({ src, width }) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        `<img src="${src}" width="${String(width)}"><p>Text that follows the picture.</p>`,
        false
      );
    },
    { src: PIXEL, width: IMAGE_WIDTH }
  );
  await page.waitForTimeout(50);
}

async function selectImage(page: Page, target: DemoTarget): Promise<void> {
  await page.locator(`${target.editorSelector} .dm-image-resizable img`).click();
  await page.waitForSelector('.dm-bubble-menu[data-show]', { timeout: 3000 });
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
}

for (const target of demoTargets) {
  test.describe(`image alignment (${target.name})`, () => {
    test('the Notion preset offers alignment, not float', async ({ page }) => {
      await goNotion(page, target);

      // The demo no longer writes dm-notion-mode anywhere; the editor's
      // preset: 'notion' must paint it on the .dm-editor host itself.
      const painted = await page.evaluate((sel) => {
        return Boolean(
          document
            .querySelector(sel)
            ?.closest('.dm-editor')
            ?.classList.contains('dm-notion-mode')
        );
      }, target.editorSelector);
      expect(painted).toBe(true);

      await setImageDocument(page);
      await selectImage(page, target);

      const menu = page.locator('.dm-bubble-menu[data-show]');
      await expect(menu.locator('[aria-label="Align left"]')).toBeVisible();
      await expect(menu.locator('[aria-label="Align center"]')).toBeVisible();
      await expect(menu.locator('[aria-label="Align right"]')).toBeVisible();
      // The float controls are the classic preset's; offering both would ask
      // the author to choose between two things that look the same until the
      // text beside the picture is long enough to tell them apart.
      await expect(menu.locator('[aria-label="Float left"]')).toHaveCount(0);
      await expect(menu.locator('[aria-label="Float right"]')).toHaveCount(0);
      await expect(menu.locator('[aria-label="Inline"]')).toHaveCount(0);
    });

    test('alignment moves the picture and leaves the text below it', async ({ page }) => {
      await goNotion(page, target);
      await setImageDocument(page);
      await selectImage(page, target);

      const wrapper = `${target.editorSelector} .dm-image-resizable`;
      const paragraph = `${target.editorSelector} p`;
      const measure = await boxOf(page, paragraph);

      await page.click('.dm-bubble-menu[data-show] [aria-label="Align right"]');
      await expect(page.locator(wrapper)).toHaveAttribute('data-align', 'right');
      let picture = await boxOf(page, wrapper);
      let text = await boxOf(page, paragraph);
      expect(Math.abs(picture.right - measure.right)).toBeLessThan(2);
      expect(picture.left).toBeGreaterThan(measure.left + 10);
      // The whole point of alignment: nothing comes up beside the picture.
      expect(text.top).toBeGreaterThanOrEqual(picture.bottom - 1);

      await page.click('.dm-bubble-menu[data-show] [aria-label="Align center"]');
      await expect(page.locator(wrapper)).toHaveAttribute('data-align', 'center');
      picture = await boxOf(page, wrapper);
      expect(Math.abs(picture.left - measure.left - (measure.right - picture.right))).toBeLessThan(2);

      await page.click('.dm-bubble-menu[data-show] [aria-label="Align left"]');
      await expect(page.locator(wrapper)).toHaveAttribute('data-align', 'left');
      picture = await boxOf(page, wrapper);
      text = await boxOf(page, paragraph);
      expect(Math.abs(picture.left - measure.left)).toBeLessThan(2);
      expect(text.top).toBeGreaterThanOrEqual(picture.bottom - 1);
    });

    test('an aligned picture never carries a float as well', async ({ page }) => {
      await goNotion(page, target);
      await setImageDocument(page);
      await selectImage(page, target);
      await page.click('.dm-bubble-menu[data-show] [aria-label="Align right"]');

      const wrapper = page.locator(`${target.editorSelector} .dm-image-resizable`);
      await expect(wrapper).toHaveAttribute('data-align', 'right');
      await expect(wrapper).not.toHaveAttribute('data-float', /.*/);
      // And the attribute survives a round trip through the document's HTML,
      // which is what an export reads.
      const html = await page.evaluate(() => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { getHTML: () => string }
          | undefined;
        return ed?.getHTML() ?? '';
      });
      expect(html).toContain('data-align="right"');
      expect(html).not.toContain('float:');
    });
  });
}
