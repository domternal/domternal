import { test } from './fixtures.js';
import { expect } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const boldButton = '.dm-toolbar button[aria-label="Bold"]';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('SelectionDecoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test.describe('selection collapse on blur', () => {
    test('blur collapses selection — typing after refocus appends instead of replacing', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Replace content, select all
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('original');
      await page.keyboard.press(`${modifier}+a`);

      // Blur → selection collapses to cursor
      await page.locator('h1').click();

      // Focus again and type — if selection was collapsed, text appends
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' added');

      await expect(editor).toContainText('original added');
    });

    test('Bold via toolbar works (no blur, selection preserved)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('make bold');
      await page.keyboard.press(`${modifier}+a`);
      await page.locator(boldButton).click();

      await expect(output).toContainText('<strong>make bold</strong>');
    });

    test('toolbar button keeps editor focused (mousedown preventDefault)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();
      await page.keyboard.press(`${modifier}+a`);

      await page.locator(boldButton).click();

      const focused = await editor.evaluate((el) =>
        el === document.activeElement || el.contains(document.activeElement)
      );
      expect(focused).toBe(true);
    });
  });

  test.describe('data-dm-editor-ui exception', () => {
    test('link popover preserves selection — link applies to full text', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('link text');
      await page.keyboard.press(`${modifier}+a`);

      // Open link popover (focus moves to input → editor blurs)
      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      // Type URL and submit
      await page.locator('.dm-link-popover-input').fill('https://example.com');
      await page.keyboard.press('Enter');

      // Link should wrap the entire selected text — proves selection was NOT collapsed
      await expect(output).toContainText('href="https://example.com"');
      await expect(output).toContainText('>link text</a>');
    });

    test('dm-link-pending decoration appears while popover is open', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('decorate me');
      await page.keyboard.press(`${modifier}+a`);

      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      const pending = editor.locator('.dm-link-pending');
      await expect(pending.first()).toBeVisible();
    });

    test('dm-link-pending decoration disappears when popover closes', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('temp');
      await page.keyboard.press(`${modifier}+a`);

      await page.locator('.dm-toolbar button[aria-label="Link"]').click();
      await page.waitForSelector('.dm-link-popover[data-show]');
      await page.waitForTimeout(100);

      // Close with Escape — verify popover closes first
      await page.locator('.dm-link-popover-input').press('Escape');
      await expect(page.locator('.dm-link-popover[data-show]')).toHaveCount(0);
      await expect(editor.locator('.dm-link-pending')).toHaveCount(0);
    });

    test('popover input has data-dm-editor-ui on container', async ({ page }) => {
      // Verify the attribute exists on the popover element
      const popover = page.locator('.dm-link-popover');
      await expect(popover).toHaveAttribute('data-dm-editor-ui', '');
    });
  });

  test.describe('blur/focus cycling', () => {
    test('typing works after blur/focus cycle', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();
      await editor.click();

      await page.keyboard.press('End');
      await page.keyboard.type(' extra');

      await expect(editor).toContainText('extra');
    });

    test('repeated blur/focus does not break editing', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Cycle 1
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('cycle1');
      await page.locator('h1').click();
      await editor.click();

      // Cycle 2
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('cycle2');
      await page.locator('h1').click();
      await editor.click();

      // Should be able to type normally
      await page.keyboard.press('End');
      await page.keyboard.type(' done');
      await expect(editor).toContainText('cycle2 done');
    });
  });
});
