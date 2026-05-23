/**
 * E2E regression: during a BlockHandle drag, only the custom
 * `.dm-block-drop-indicator` is visible; the native
 * `prosemirror-dropcursor-block` / `-inline` element is hidden by the
 * theme's `.dm-block-handle-dragging` rule.
 *
 * Without the hide rule (or with a typo in the selector, which is how
 * this bug originally shipped), both indicators render and the user
 * sees a doubled drop line. The unit test in BlockHandle only checks
 * the class toggle, so this CSS visibility assertion has to live in a
 * real browser.
 */
import { test } from './fixtures.js';
import { expect, type Page, type JSHandle } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';
const editorWrapperSelector = '.app-notion-demo .dm-editor';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

/**
 * Read the relevant indicator state from the page. Captures both
 * BlockHandle's custom indicator and the native PM dropcursor (both
 * possible classes) so a single call answers "is the bug visible?".
 */
async function readIndicatorState(page: Page): Promise<{
  hasDraggingClass: boolean;
  customVisible: boolean;
  nativeBlockVisible: boolean;
  nativeInlineVisible: boolean;
}> {
  return page.evaluate(() => {
    const isVisible = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      // PM dropcursor sets inline `position: absolute; ...`; treat zero
      // bounding rect as not visible (e.g. before any dragover fires).
      const rect = el.getBoundingClientRect();
      return rect.width > 0 || rect.height > 0;
    };
    const dmEditor = document.querySelector<HTMLElement>('.dm-editor');
    return {
      hasDraggingClass: !!dmEditor?.classList.contains('dm-block-handle-dragging'),
      customVisible: isVisible(document.querySelector<HTMLElement>('.dm-block-drop-indicator')),
      nativeBlockVisible: isVisible(document.querySelector<HTMLElement>('.prosemirror-dropcursor-block')),
      nativeInlineVisible: isVisible(document.querySelector<HTMLElement>('.prosemirror-dropcursor-inline')),
    };
  });
}

/**
 * Start a synthetic HTML5 drag from the first block's handle and fire a
 * single dragover at a position inside the editor. Returns the shared
 * DataTransfer handle so the caller can run dragend later.
 */
async function startDragOverFirstBlock(page: Page): Promise<JSHandle<DataTransfer>> {
  // Surface the handle by hovering the first block.
  const firstBlock = page.locator(`${editorSelector} > *`).first();
  await firstBlock.hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);

  // Target the second block to ensure the drop position is meaningful
  // (PM's dropcursor needs a resolved position to render).
  const target = page.locator(`${editorSelector} > *`).nth(1);
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) throw new Error('target rect missing');
  const clientX = targetBox.x + targetBox.width / 2;
  const clientY = targetBox.y + targetBox.height * 0.8;

  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  // dragover wakes both indicators: BlockHandle's `dragover` listener
  // positions `.dm-block-drop-indicator`, and PM's dropcursor plugin
  // creates its DOM element (then the CSS rule hides it).
  await page.locator(editorSelector).dispatchEvent('dragover', {
    dataTransfer: dt,
    clientX,
    clientY,
  });

  // Two RAFs give layout time to flush so getBoundingClientRect reads
  // the latest values for both indicator elements.
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  return dt;
}

async function endDrag(page: Page, dt: JSHandle<DataTransfer>): Promise<void> {
  await page.locator(dragBtnSelector).dispatchEvent('dragend', { dataTransfer: dt });
  await dt.dispose();
  // PM dropcursor schedules its element removal ~20ms after dragend
  // (`scheduleRemoval(20)`); wait past that so the post-drag assertions
  // see the cleared state.
  await page.waitForTimeout(80);
}

test.describe('BlockHandle drag - single drop indicator only', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('editor gets `dm-block-handle-dragging` class while a handle drag is in flight', async ({ page }) => {
    const before = await readIndicatorState(page);
    expect(before.hasDraggingClass).toBe(false);

    const dt = await startDragOverFirstBlock(page);

    const during = await readIndicatorState(page);
    expect(during.hasDraggingClass).toBe(true);

    await endDrag(page, dt);

    const after = await readIndicatorState(page);
    expect(after.hasDraggingClass).toBe(false);
  });

  test('custom `.dm-block-drop-indicator` is visible during a handle drag', async ({ page }) => {
    const dt = await startDragOverFirstBlock(page);
    const state = await readIndicatorState(page);
    expect(state.customVisible).toBe(true);
    await endDrag(page, dt);
  });

  test('native PM dropcursor is hidden during a handle drag (no double line)', async ({ page }) => {
    const dt = await startDragOverFirstBlock(page);
    const state = await readIndicatorState(page);
    // Whichever of the two PM cursor flavours got mounted MUST be invisible.
    // The bug this guards against: both visible at the same time.
    expect(state.nativeBlockVisible).toBe(false);
    expect(state.nativeInlineVisible).toBe(false);
    await endDrag(page, dt);
  });

  test('only one drop indicator is visible during a handle drag', async ({ page }) => {
    const dt = await startDragOverFirstBlock(page);
    const state = await readIndicatorState(page);
    const visibleCount = [state.customVisible, state.nativeBlockVisible, state.nativeInlineVisible]
      .filter(Boolean).length;
    expect(visibleCount).toBe(1);
    expect(state.customVisible).toBe(true);
    await endDrag(page, dt);
  });

  test('PM dropcursor element carries a `prosemirror-dropcursor-*` class (not the legacy `ProseMirror-dropcursor`)', async ({ page }) => {
    // Sanity check that pins down the class name PM actually emits. If
    // the underlying library renames these, this test fires first and
    // the hide rule needs the same rename.
    const dt = await startDragOverFirstBlock(page);
    const data = await page.evaluate(() => {
      const block = document.querySelector('.prosemirror-dropcursor-block');
      const inline = document.querySelector('.prosemirror-dropcursor-inline');
      const legacy = document.querySelector('.ProseMirror-dropcursor');
      return {
        hasBlockOrInline: !!(block || inline),
        hasLegacy: !!legacy,
      };
    });
    expect(data.hasBlockOrInline).toBe(true);
    expect(data.hasLegacy).toBe(false);
    await endDrag(page, dt);
  });

  test('custom indicator and dragging class clear after dragend', async ({ page }) => {
    // PM dropcursor's own cleanup runs on its `dragend` listener attached
    // to `view.dom`. Our synthetic dragend fires on the handle button (a
    // sibling of `.ProseMirror`, not a descendant), so PM never sees it
    // and its element lingers until the 5s scheduled removal. We assert
    // only what BlockHandle owns: its custom indicator is hidden and the
    // `.dm-block-handle-dragging` class is cleared.
    const dt = await startDragOverFirstBlock(page);
    await endDrag(page, dt);
    const state = await readIndicatorState(page);
    expect(state.customVisible).toBe(false);
    expect(state.hasDraggingClass).toBe(false);
  });
});
