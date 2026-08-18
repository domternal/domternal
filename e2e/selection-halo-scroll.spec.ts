/**
 * The selected-node halo must not create scrollable overflow.
 *
 * `_block-handle.scss` bled the halo 4px past the block with a negative
 * `inset`, which joined it to the nearest scroll container's overflow. Since
 * `dragstart` is what selects a block, any block filling a scroller grew a
 * scrollbar for the whole drag, and a release that changed nothing left the
 * selection, and the scrollbar, behind. A `pre` is `overflow-x: auto` and CSS
 * computes `overflow-y` to `auto` with it, so both axes show on one block.
 *
 * Mirrored for columns in domternal-pro's `columns-selection-halo-scroll`.
 */
import { test } from './fixtures.js';
import { expect, type Page, type JSHandle } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const CODE_FITS = '<pre><code>const a = 1;</code></pre>';

interface ScrollMetrics {
  overX: number;
  overY: number;
  selected: boolean;
  haloPainted: boolean;
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

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void }
      | undefined;
    ed?.setContent(h, false);
  }, html);
  await page.waitForTimeout(150);
}

/** `haloPainted` keeps these honest: deleting the halo would also pass. */
async function metrics(page: Page, editorSelector: string): Promise<ScrollMetrics> {
  return page.evaluate((sel) => {
    const pre = document.querySelector(`${sel} pre`);
    if (!pre) throw new Error('no code block in the editor');
    return {
      overX: pre.scrollWidth - pre.clientWidth,
      overY: pre.scrollHeight - pre.clientHeight,
      selected: pre.classList.contains('ProseMirror-selectednode'),
      haloPainted: getComputedStyle(pre, '::before').content !== 'none',
    };
  }, editorSelector);
}

async function startDrag(page: Page, editorSelector: string): Promise<JSHandle<DataTransfer>> {
  await page.locator(`${editorSelector} pre`).first().hover();
  await expect(page.locator('.dm-block-handle')).toHaveAttribute('data-show', '');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page.locator('.dm-block-handle-drag').dispatchEvent('dragstart', { dataTransfer: dt });
  // BlockHandle commits the NodeSelection in a deferred dispatch (setTimeout 0).
  await page.waitForTimeout(60);
  return dt;
}

for (const target of demoTargets) {
  test.describe(`${target.name} selected-node halo and scroll`, () => {
    test('a selected code block that fits gains no scrollbar on either axis', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, `<p>Lead.</p>${CODE_FITS}<p>Tail.</p>`);

      const idle = await metrics(page, target.editorSelector);
      expect(idle.selected).toBe(false);
      expect(idle.overX).toBe(0);
      expect(idle.overY).toBe(0);

      const dt = await startDrag(page, target.editorSelector);
      const dragging = await metrics(page, target.editorSelector);
      expect(dragging.selected).toBe(true);
      expect(dragging.haloPainted).toBe(true);
      expect(dragging.overX).toBe(0);
      expect(dragging.overY).toBe(0);

      await page.locator('.dm-block-handle-drag').dispatchEvent('dragend', { dataTransfer: dt });
      await dt.dispose();
    });

    test('a release that changes nothing leaves no scrollbar behind', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, `<p>Lead.</p>${CODE_FITS}<p>Tail.</p>`);

      const dt = await startDrag(page, target.editorSelector);
      const box = await page.locator(`${target.editorSelector} pre`).first().boundingBox();
      if (!box) throw new Error('the code block has no layout box');

      // Releasing on the dragged block itself dispatches no transaction, so
      // the NodeSelection survives. This is the state the bug left on screen.
      const clientX = box.x + box.width / 2;
      const clientY = box.y + box.height / 2;
      const editor = page.locator(target.editorSelector);
      await editor.dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
      await editor.dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
      await page.locator('.dm-block-handle-drag').dispatchEvent('dragend', { dataTransfer: dt });
      await dt.dispose();
      await page.waitForTimeout(150);

      const after = await metrics(page, target.editorSelector);
      expect(after.selected).toBe(true);
      expect(after.haloPainted).toBe(true);
      expect(after.overX).toBe(0);
      expect(after.overY).toBe(0);
    });

    test('the halo still bleeds past the block it marks', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, `<p>Lead.</p>${CODE_FITS}<p>Tail.</p>`);

      const dt = await startDrag(page, target.editorSelector);
      const halo = await page.evaluate((sel) => {
        const pre = document.querySelector(`${sel} pre`);
        if (!pre) throw new Error('no code block in the editor');
        const before = getComputedStyle(pre, '::before');
        return { content: before.content, boxShadow: before.boxShadow, inset: before.inset };
      }, target.editorSelector);

      // The one assertion naming the mechanism, because here the mechanism is
      // the appearance: the tests above pass just as well against a build that
      // stopped bleeding, which is a visual regression rather than a fix.
      expect(halo.content).not.toBe('none');
      expect(halo.boxShadow).not.toBe('none');
      expect(halo.inset).toBe('0px');

      await page.locator('.dm-block-handle-drag').dispatchEvent('dragend', { dataTransfer: dt });
      await dt.dispose();
    });
  });
}
