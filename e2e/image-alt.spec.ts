/**
 * Image alt text across all four frameworks: an empty alt marks a decorative
 * image, which assistive technology skips, and a missing alt an image with no
 * description yet, which accessibility checkers flag. The editor stores the
 * two as '' and null and must keep them apart where a reader meets them: in
 * the live editor, in getHTML(), after a node view update, and through the
 * Edit alt text menu.
 */
import { test } from './fixtures.js';
import { expect, type Locator, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/** 1x1 PNG, so no network is involved. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A described image, a decorative one and one without alt, in that order. */
const IMAGES = `<img src="${PIXEL}" alt="Logo" width="80"><img src="${PIXEL}" alt="" width="80"><img src="${PIXEL}" width="80"><p>After the images.</p>`;

interface DemoEditor {
  setContent: (html: string, emit: boolean) => void;
  getHTML: () => string;
  state: { doc: { descendants: (f: (node: { type: { name: string }; attrs: Record<string, unknown> }, pos: number) => void) => void } };
}

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 }
  );
  await page.evaluate((html) => {
    ((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor).setContent(html, false);
  }, IMAGES);
  await expect(page.locator(`${target.editorSelector} .dm-image-resizable img`)).toHaveCount(3);
}

/** The alt attribute of every image the editor shows, or null where it has none. */
async function liveAlts(page: Page, target: DemoTarget): Promise<(string | null)[]> {
  return page.locator(`${target.editorSelector} .dm-image-resizable img`).evaluateAll(images =>
    images.map(image => image.getAttribute('alt')));
}

/** The alt attribute of every img in getHTML(), or null where it has none. */
async function htmlAlts(page: Page): Promise<(string | null)[]> {
  const html = await page.evaluate(() =>
    ((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor).getHTML());
  return (html.match(/<img\b[^>]*>/g) ?? []).map(tag => /\salt="([^"]*)"/.exec(tag)?.[1] ?? null);
}

/** The stored alt of every image node. */
async function storedAlts(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    const alts: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'image') alts.push(node.attrs['alt']); });
    return alts;
  });
}

/** Selects the image at `index` and opens its Edit alt text menu. */
async function openAltMenu(page: Page, target: DemoTarget, index: number): Promise<Locator> {
  await page.locator(`${target.editorSelector} .dm-image-resizable img`).nth(index).click();
  await page.locator('.dm-bubble-menu[data-show] [aria-label="Edit alt text"]').click();
  const input = page.locator('.dm-image-popover[data-show] .dm-image-popover-alt-input');
  await expect(input).toBeVisible();
  return input;
}

for (const target of demoTargets) {
  test.describe(`image alt text (${target.name})`, () => {
    test('a decorative image shows alt="" and an image without alt shows none', async ({ page }) => {
      await goNotion(page, target);
      expect(await storedAlts(page)).toEqual(['Logo', '', null]);
      expect(await liveAlts(page, target)).toEqual(['Logo', '', null]);
      expect(await htmlAlts(page)).toEqual(['Logo', '', null]);
    });

    test('a node view update keeps alt="" and adds no alt to an image without one', async ({ page }) => {
      await goNotion(page, target);
      // A title change on every image runs each node view's update, as a resize or a placement does.
      const sameElements = await page.evaluate((selector) => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor & {
          view: { dispatch: (tr: unknown) => void; state: { tr: { setNodeMarkup: (pos: number, type: undefined, attrs: Record<string, unknown>) => unknown } } };
        };
        const before = Array.from(document.querySelectorAll(selector));
        const tr = editor.view.state.tr;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'image') tr.setNodeMarkup(pos, undefined, { ...node.attrs, title: 'Changed' });
        });
        editor.view.dispatch(tr);
        const after = Array.from(document.querySelectorAll(selector));
        return after.length === before.length && after.every((image, i) => image === before[i]);
      }, `${target.editorSelector} .dm-image-resizable img`);
      expect(sameElements).toBe(true);
      await expect(page.locator(`${target.editorSelector} .dm-image-resizable img[title="Changed"]`)).toHaveCount(3);
      expect(await liveAlts(page, target)).toEqual(['Logo', '', null]);
      expect(await htmlAlts(page)).toEqual(['Logo', '', null]);
    });

    test('Edit alt text keeps a decorative image decorative and clears a described one to no alt', async ({ page }) => {
      await goNotion(page, target);

      // Applying the decorative image's empty field unchanged changes nothing.
      let input = await openAltMenu(page, target, 1);
      await expect(input).toHaveValue('');
      await input.press('Enter');
      await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
      expect(await storedAlts(page)).toEqual(['Logo', '', null]);
      expect(await liveAlts(page, target)).toEqual(['Logo', '', null]);

      // Clearing a description leaves the image undescribed, not decorative.
      input = await openAltMenu(page, target, 0);
      await expect(input).toHaveValue('Logo');
      await input.fill('');
      await input.press('Enter');
      await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
      expect(await storedAlts(page)).toEqual([null, '', null]);
      expect(await liveAlts(page, target)).toEqual([null, '', null]);
      expect(await htmlAlts(page)).toEqual([null, '', null]);
    });
  });
}
