/**
 * Regression test for the fast-drag race condition.
 *
 * Bug: `onDragStart` defers committing `draggedFrom` to plugin state via
 * `setTimeout(0)` (works around a Chrome quirk where DOM mutations during
 * dragstart abort the drag - see `BlockHandle.ts` for the full comment).
 * On extremely fast drags (mousedown → tiny pixel move → release in <1
 * frame) the timer hasn't run by the time the browser fires `drop`, and
 * `state.draggedFrom` is still null. PM also clears `view.dragging`
 * before invoking the `handleDrop` plugin hook, so we can't recover the
 * source position from there either. The user-visible symptom: drop
 * does nothing until the user wiggles the mouse and tries again.
 *
 * Fix: a closure-scoped `pendingDraggedFrom` variable, set SYNCHRONOUSLY
 * in `onDragStart` and read as a fallback in `performBlockDrop`. Closure
 * scope is independent of both the deferred state commit and PM's
 * `view.dragging` clearing.
 *
 * This spec dispatches dragstart + drop in a single synchronous JS task
 * (worst-case timing - emulates the user's fast-release scenario). The
 * old behaviour returned without moving the block; the fix moves it.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '[data-testid="mode-notion"]';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
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

async function getBlockTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { textContent: string }) => void) => void } } }
      | undefined;
    const out: string[] = [];
    ed?.state.doc.forEach((n) => { out.push(n.textContent); });
    return out;
  });
}

test('fast drag (dragstart → dragover → drop in one synchronous task) still moves the block', async ({ page }) => {
  await goNotion(page);
  await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');

  const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
  await first.hover();

  const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
  const thirdBox = await third.boundingBox();
  expect(thirdBox).not.toBeNull();
  if (!thirdBox) return;

  const cx = thirdBox.x + thirdBox.width / 2;
  const cy = thirdBox.y + thirdBox.height * 0.8;

  // ALL events fire inside one `evaluate` - no Playwright round-trips
  // between them, so the deferred `setTimeout(0)` from `onDragStart`
  // CANNOT fire between dragstart and drop. This emulates the worst-case
  // user timing: click handle, jerk mouse, release in <16ms.
  await page.evaluate(({ cx, cy }) => {
    const handle = document.querySelector('.dm-block-handle-drag') as HTMLElement | null;
    const editor = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!handle || !editor) throw new Error('handle/editor missing');

    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    editor.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { cx, cy });

  await page.waitForTimeout(80);
  const blocks = await getBlockTexts(page);
  expect(blocks).toEqual(['Bravo', 'Charlie', 'Alpha']);
});

test('fast drag does NOT throw "Selection passed to setSelection" - late timer is gated', async ({ page }) => {
  // Companion to the test above. After the synchronous drag completes,
  // the deferred `setTimeout(0)` from `onDragStart` STILL fires (it was
  // queued and the browser eventually runs it). Without the guard added
  // in the fix, that callback would dispatch a transaction with a stale
  // `nodeSelection` against a doc whose positions changed during the
  // already-completed drop - PM throws RangeError. The fix checks
  // `pendingDraggedFrom === null` (cleared by `onDragEnd` BEFORE the
  // late timer fires) and bails out cleanly.
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); });

  await goNotion(page);
  await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');

  const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
  await first.hover();

  const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
  const thirdBox = await third.boundingBox();
  if (!thirdBox) return;
  const cx = thirdBox.x + thirdBox.width / 2;
  const cy = thirdBox.y + thirdBox.height * 0.8;

  await page.evaluate(({ cx, cy }) => {
    const handle = document.querySelector('.dm-block-handle-drag') as HTMLElement | null;
    const editor = document.querySelector('.ProseMirror') as HTMLElement | null;
    if (!handle || !editor) throw new Error('missing');
    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    editor.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    editor.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy }));
    handle.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { cx, cy });

  // Wait long enough for the deferred `setTimeout(0)` to fire AFTER the
  // dragend has already cleared `pendingDraggedFrom`.
  await page.waitForTimeout(150);

  // No "Selection passed to setSelection must point at the current
  // document" error from PM. The guard inside the timer skips the
  // dispatch when `pendingDraggedFrom === null`.
  const setSelectionErrors = errors.filter((e) => e.includes('Selection passed to setSelection'));
  expect(setSelectionErrors).toHaveLength(0);
});
