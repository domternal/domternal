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
 *
 * Vanilla broke the same way twice more, in shapes the press tests miss when
 * the render lands outside the press: the bubble menu rebuilt its whole DOM,
 * and the toolbar compared its trigger against `btn.innerHTML`, the browser's
 * re-serialisation, which never matched. So the tests below assert identity
 * instead. A click fires only when mousedown and mouseup share an element.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';
/** Any toolbar control that opens a panel; alignment exists in every demo. */
const ALIGN_TRIGGER = '.dm-toolbar [aria-label="Text Alignment"]';
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

/**
 * Remembers the live node, so a later render can be asked whether it kept it.
 * A rebuilt menu looks identical to a preserved one in every other query.
 */
async function rememberNode(page: Page, selector: string, key: string): Promise<void> {
  await page.evaluate(
    ({ sel, k }) => {
      const element = document.querySelector(sel);
      if (!element) throw new Error(`nothing matches ${sel}`);
      (window as unknown as Record<string, unknown>)[k] = element;
    },
    { sel: selector, k: key },
  );
}

/** Whether the selector still resolves to the very node remembered earlier. */
function isSameNode(page: Page, selector: string, key: string): Promise<boolean> {
  return page.evaluate(
    ({ sel, k }) => {
      const remembered = (window as unknown as Record<string, unknown>)[k] as Element | undefined;
      const current = document.querySelector(sel);
      return Boolean(remembered && current && remembered === current && remembered.isConnected);
    },
    { sel: selector, k: key },
  );
}

/**
 * Repaints active states without changing which items the menus hold: the
 * state-only render the structure is supposed to survive.
 */
async function stateOnlyRender(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+b');
  // Two frames: the toolbar defers its render by one.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => { resolve(); }));
      }),
  );
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

  test(`${target.name}: a bubble menu button and its icon survive a state-only render`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await selectFirstWords(page);
    const menu = page.locator('.dm-bubble-menu');
    await expect(menu).toHaveAttribute('data-show', '');

    const button = '.dm-bubble-menu [aria-label="Italic"]';
    const icon = `${button} svg`;
    await expect(page.locator(icon)).toHaveCount(1);
    await rememberNode(page, button, '__buttonBefore');
    await rememberNode(page, icon, '__iconBefore');

    await stateOnlyRender(page);

    // Bold went on, so the menu re-rendered; Italic had no reason to change.
    await expect.poll(() => boldIsActive(page)).toBe(true);
    expect(await isSameNode(page, button, '__buttonBefore'), 'the button was replaced').toBe(true);
    expect(await isSameNode(page, icon, '__iconBefore'), 'the icon was rewritten').toBe(true);
  });

  test(`${target.name}: a toolbar dropdown trigger keeps its glyph across a render`, async ({
    page,
  }) => {
    // The alignment glyph is dynamic, so it may change when the alignment
    // does. This render changes a mark, so rewriting it is pure destruction.
    await openDemo(page, target);
    await selectFirstWords(page);
    await expect(page.locator(ALIGN_TRIGGER)).toBeVisible();
    await rememberNode(page, ALIGN_TRIGGER, '__triggerBefore');
    await rememberNode(page, `${ALIGN_TRIGGER} svg`, '__triggerIconBefore');

    await stateOnlyRender(page);

    await expect.poll(() => boldIsActive(page)).toBe(true);
    expect(
      await isSameNode(page, ALIGN_TRIGGER, '__triggerBefore'),
      'the trigger was replaced',
    ).toBe(true);
    expect(
      await isSameNode(page, `${ALIGN_TRIGGER} svg`, '__triggerIconBefore'),
      'the glyph was rewritten though it depicts the same alignment',
    ).toBe(true);
  });

  test(`${target.name}: a slash menu item fires when the press outlives a transaction`, async ({
    page,
  }) => {
    // The third shape: the slash menu rebuilt every row on every update, and
    // `onUpdate` runs on every transaction. The transaction goes between the
    // press and the release rather than through the outside-press probe, since
    // this popup renders synchronously and a pointerdown probe would land
    // before mousedown. An overlay listening on mousedown lands right here.
    await page.goto(target.baseURL + '/');
    await page.waitForSelector(target.notionToggle);
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      editor?.setContent('<p>The sentence under the pointer.</p>', false);
    });
    await expect(page.locator(`${target.editorSelector} h1`)).toHaveCount(0);

    await page.click(`${target.editorSelector} > *:first-child`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');

    const item = page.locator('.dm-slash-command-item', { hasText: 'Heading 1' }).first();
    await expect(item).toBeVisible();
    // Raw coordinates do not scroll the way `click()` does.
    await item.scrollIntoViewIfNeeded();
    const box = await item.boundingBox();
    if (!box) throw new Error('no box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { view: { state: { tr: unknown }; dispatch: (tr: unknown) => void } }
        | undefined;
      if (!editor) throw new Error('no editor');
      editor.view.dispatch(editor.view.state.tr);
    });
    await page.mouse.up();

    await expect(page.locator(`${target.editorSelector} h1`)).toHaveCount(1);
    await expect(page.locator(target.editorSelector)).not.toContainText('/');
  });

  test(`${target.name}: a toolbar dropdown trigger fires when the press outlives a frame`, async ({
    page,
  }) => {
    // Harder than the plain button above: this trigger's markup is recomputed
    // every render, since the glyph follows the active sub-item. Rewriting it
    // replaces the node under the pointer and the press yields no click.
    await openDemo(page, target);
    await installOverlayProbe(page);
    await selectFirstWords(page);

    const trigger = page.locator('.dm-toolbar .dm-toolbar-dropdown-trigger').first();
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    if (!box) throw new Error('no box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    await page.mouse.up();

    await expect(page.locator(PANEL)).toBeVisible();
  });
}
