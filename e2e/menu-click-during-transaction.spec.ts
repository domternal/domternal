/**
 * A menu button must still fire when something dispatches an editor
 * transaction during the same press.
 *
 * That is what any overlay closing on an outside press does, and it used to
 * kill the click outright in React. The wrapper re-renders on the transaction
 * and rewrites every button's `innerHTML`, because the
 * `dangerouslySetInnerHTML` payload was a fresh object on each render, so the
 * icon under the pointer is destroyed between mousedown and mouseup. With no
 * element common to the two, the browser fires no click at all.
 *
 * The probe below stands in for the overlay: it dispatches a no-op transaction
 * on any press outside the editor, which is exactly the timing that broke.
 * Only React ever failed either body, so the value is in running both against
 * all four demos.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';

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

/**
 * Dispatches an empty transaction on every press outside the editor, the way
 * a popover's outside-press listener does when it closes. Scoped to presses
 * outside so it never interferes with ProseMirror's own mousedown handling.
 */
async function installOverlayProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { view: { state: { tr: unknown }; dispatch: (tr: unknown) => void; dom: HTMLElement } }
      | undefined;
    if (!editor) throw new Error('no editor');
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target as Node | null;
        if (target && editor.view.dom.contains(target)) return;
        editor.view.dispatch(editor.view.state.tr);
      },
      true,
    );
  });
}

/** ProseMirror only reads a selectionchange while it holds DOM focus. */
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

function boldIsActive(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      (
        (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { isActive: (n: string) => boolean }
          | undefined
      )?.isActive('bold') ?? false,
  );
}

for (const target of demoTargets) {
  test(`${target.name}: a bubble menu button fires when a press dispatches a transaction`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await installOverlayProbe(page);
    await selectFirstWords(page);

    const menu = page.locator('.dm-bubble-menu');
    await expect(menu).toHaveAttribute('data-show', '');
    await menu.locator('[aria-label="Bold"]').click();

    await expect.poll(() => boldIsActive(page)).toBe(true);
    // Still there to press again, rather than suppressed until the reader
    // picks a different range.
    await expect(menu).toHaveAttribute('data-show', '');
  });

  test(`${target.name}: a toolbar button fires when the press outlives a frame`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await installOverlayProbe(page);
    await selectFirstWords(page);

    const bold = page.locator('.dm-toolbar [aria-label="Bold"]');
    await expect(bold).toBeVisible();
    const box = await bold.boundingBox();
    if (!box) throw new Error('no box');

    // Held across several frames, the way a real click is. The toolbar defers
    // its re-render by one frame, which hides the problem from an instant
    // synthetic click but not from a person pressing the button.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect.poll(() => boldIsActive(page)).toBe(true);
  });
}
