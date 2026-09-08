import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import type {} from './fixtures/tutorial-menus/main.js';

const FIXTURE = 'http://127.0.0.1:5793/tutorial-menus/';

async function open(page: Page): Promise<void> {
  await page.goto(FIXTURE);
  await page.waitForFunction(() => Boolean(window.__TUTORIAL_MENUS__));
}

test('lowercase explicit Shift bindings execute while toolbar hints remain display only', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__TUTORIAL_MENUS__.seed('<p>unchanged</p>'); });
  const editable = page.locator('#editor .ProseMirror');
  await expect(editable).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Shift+d');
  await expect(page.locator('#shortcut-result')).toHaveText('1');
  await page.keyboard.press('F9');
  await expect(editable).toHaveText('unchanged');
  const button = page.getByRole('button', { name: 'Display only shortcut', exact: true });
  await expect(button).toHaveAttribute('title', 'Display only shortcut (F9)');
  await button.click();
  await expect(editable).toHaveText('buttonunchanged');
});

test('literal insertion replaces inline text while parsed insertion preserves block semantics', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    seed('<p><strong>aReplaceb</strong></p>', 2, 9);
    editor.chain().focus().insertText('<b>&amp;\nnext</b>').run();
  });
  const editable = page.locator('#editor .ProseMirror');
  await expect(editable.locator(':scope > p')).toHaveCount(1);
  await expect(editable.locator('strong')).toHaveText('a<b>&amp;\nnext</b>b');
  await expect(editable.locator('b')).toHaveCount(0);
  await page.keyboard.type('!');
  await expect(editable.locator('strong')).toHaveText('a<b>&amp;\nnext</b>!b');

  await page.evaluate(() => {
    const { editor, seed } = window.__TUTORIAL_MENUS__;
    seed('<p>ab</p>', 2);
    editor.chain().focus().insertContent('<strong>X &amp; Y</strong>').run();
  });
  await expect(editable.locator(':scope > p')).toHaveText(['a', 'X & Y', 'b']);
  await expect(editable.locator('strong')).toHaveText('X & Y');
});
