/**
 * Caret-follow placeholder focus gating, across all four demos (commit a99d010).
 *
 * The Placeholder extension renders two distinct decorations (see
 * `packages/core/src/extensions/Placeholder.ts`):
 *   - The caret-follow hint on the CURRENT empty textblock. It is gated on
 *     `view.hasFocus()`: when the document is not fully empty the decoration
 *     only renders while the editor holds DOM focus. Focus and blur dispatch a
 *     plugin meta so ProseMirror repaints the decoration set.
 *   - The whole-editor-empty invitation, drawn when the document is empty. It
 *     bypasses the focus gate (`!isDocEmpty && !hasFocus` short-circuit) and
 *     carries the extra `is-editor-empty` class.
 *
 * Both decorations are `Decoration.node` specs applied to the empty `<p>`,
 * adding the `is-empty` class and a `data-placeholder` attribute. The Notion
 * demos configure the text as "Press '/' for commands" for paragraphs (see the
 * four `NotionDemo` sources), so the assertions below use that string, not the
 * core default 'Write something …'.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/** Placeholder text the Notion demos return for an empty paragraph. */
const CARET_HINT = "Press '/' for commands";

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

/** Replace the document without focusing, so focus state stays under test control. */
async function setContentNoFocus(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void }
      | undefined;
    ed?.setContent(h, false);
  }, html);
}

/** Focus the editor with the caret at the end of the document (the trailing empty block). */
async function focusAtEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { focus: (position?: string) => void } }
      | undefined;
    ed?.commands.focus('end');
  });
}

/**
 * Blur the editor the way a tab switch does: drop DOM focus off the ProseMirror
 * element so the plugin's `blur` handler dispatches its repaint meta.
 */
async function blurEditor(page: Page, target: DemoTarget): Promise<void> {
  await page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    if (pm instanceof HTMLElement) pm.blur();
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, target.editorSelector);
}

for (const target of demoTargets) {
  test.describe(`${target.name} - placeholder focus gating`, () => {
    /** The caret-follow / invitation decoration lives on an empty `<p>` in the editor. */
    const hint = (page: Page) => page.locator(`${target.editorSelector} [data-placeholder]`);

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
    });

    test('caret-follow hint shows only while the editor has focus', async ({ page }) => {
      // One non-empty block plus a trailing empty block: the doc is NOT empty,
      // so the hint on the empty block is subject to the hasFocus gate.
      await setContentNoFocus(page, '<p>Anchor</p><p></p>');
      await expect(page.locator(`${target.editorSelector} > p`)).toHaveText(['Anchor', '']);

      // Unfocused: the caret sits in the empty trailing block, but no hint renders.
      await blurEditor(page, target);
      await expect(hint(page)).toHaveCount(0);

      // Focus the empty trailing block: the caret-follow hint appears there.
      await focusAtEnd(page);
      await expect(hint(page)).toHaveCount(1);
      await expect(hint(page)).toHaveClass(/is-empty/);
      // A non-empty doc must not carry the whole-editor-empty class.
      await expect(hint(page)).not.toHaveClass(/is-editor-empty/);
      await expect(hint(page)).toHaveAttribute('data-placeholder', CARET_HINT);

      // Blur again (tab away): the caret-follow hint is removed.
      await blurEditor(page, target);
      await expect(hint(page)).toHaveCount(0);
    });

    test('setContent leaves no stale caret-follow hint while unfocused', async ({ page }) => {
      // Regression: after load / tab switch the caret can land in an empty block
      // via setContent, but with the editor unfocused no hint must linger.
      await blurEditor(page, target);
      await setContentNoFocus(page, '<p>Body</p><p></p>');
      await expect(page.locator(`${target.editorSelector} > p`)).toHaveText(['Body', '']);
      await expect(hint(page)).toHaveCount(0);

      // Focusing the empty block reveals the hint, proving it is focus-gated, not gone.
      await focusAtEnd(page);
      await expect(hint(page)).toHaveCount(1);
      await expect(hint(page)).toHaveAttribute('data-placeholder', CARET_HINT);
    });

    test('the empty-document invitation renders even while blurred', async ({ page }) => {
      // A fully empty document bypasses the focus gate: the invitation shows
      // with the extra is-editor-empty class regardless of focus.
      await setContentNoFocus(page, '');
      await blurEditor(page, target);
      await expect(hint(page)).toHaveCount(1);
      await expect(hint(page)).toHaveClass(/is-empty/);
      await expect(hint(page)).toHaveClass(/is-editor-empty/);
      await expect(hint(page)).toHaveAttribute('data-placeholder', CARET_HINT);
    });
  });
}
