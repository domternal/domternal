import { test, expect } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const boldButton = 'button[aria-label="Bold"]';
const blurClass = 'dm-blur-selection';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('SelectionDecoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test.describe('blur highlight', () => {
    test('shows highlight when editor loses focus with text selected', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Select all text
      await page.keyboard.press(`${modifier}+a`);

      // Click outside editor to blur
      await page.locator('h1').click();

      // Check that dm-blur-selection spans exist in the editor DOM
      const blurSpan = editor.locator(`.${blurClass}`).first();
      await expect(blurSpan).toBeVisible();
    });

    test('does not show highlight when no text is selected (cursor only)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Just place cursor, no selection
      await page.keyboard.press('Home');

      // Click outside editor to blur
      await page.locator('h1').click();

      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);
    });

    test('does not show highlight when toolbar button is clicked (mousedown preventDefault)', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Select all text
      await page.keyboard.press(`${modifier}+a`);

      // Click Bold button — mousedown preventDefault keeps focus in editor
      await page.locator(boldButton).click();

      // No blur decoration because editor kept focus
      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);
    });

    test('removes highlight when editor regains focus', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Select all
      await page.keyboard.press(`${modifier}+a`);

      // Blur by clicking outside
      await page.locator('h1').click();
      await expect(editor.locator(`.${blurClass}`).first()).toBeVisible();

      // Click back into editor — focus, decorations clear
      await editor.click();
      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);
    });

    test('creates multiple spans when selection crosses inline marks', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Initial content has "Hello <strong>World</strong>! ..."
      // Select all — decoration spans will split around inline marks
      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();

      const blurSpans = editor.locator(`.${blurClass}`);
      const count = await blurSpans.count();
      // At least 1 span, possibly multiple due to inline marks
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('blur highlight with theme', () => {
    test('highlight has background style from CSS variable', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();

      const blurSpan = editor.locator(`.${blurClass}`).first();
      await expect(blurSpan).toBeVisible();

      // Verify the element has a background set (from --dm-selection-blur)
      const bg = await blurSpan.evaluate(
        (el) => getComputedStyle(el).backgroundColor
      );
      expect(bg).not.toBe('');
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('highlight adapts to dark theme', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Select text and blur
      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();

      const blurSpan = editor.locator(`.${blurClass}`).first();
      await expect(blurSpan).toBeVisible();

      // Get light theme background
      const lightBg = await blurSpan.evaluate(
        (el) => getComputedStyle(el).backgroundColor
      );

      // Switch to dark theme
      await page.locator('.theme-toggle').click();

      // Re-select and blur
      await editor.click();
      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();

      const darkBlurSpan = editor.locator(`.${blurClass}`).first();
      await expect(darkBlurSpan).toBeVisible();

      const darkBg = await darkBlurSpan.evaluate(
        (el) => getComputedStyle(el).backgroundColor
      );

      // Dark and light backgrounds should differ
      expect(darkBg).not.toBe(lightBg);
    });
  });

  test.describe('interaction with editor commands', () => {
    test('Bold command works while toolbar keeps editor focused', async ({ page }) => {
      const editor = page.locator(editorSelector);
      const output = page.locator('pre.output');
      await editor.click();

      // Type text, select all
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('make bold');
      await page.keyboard.press(`${modifier}+a`);

      // Click Bold button — editor keeps focus due to preventDefault
      await page.locator(boldButton).click();

      // Verify bold was applied
      await expect(output).toContainText('<strong>make bold</strong>');

      // No blur decoration since editor kept focus
      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);
    });

    test('selection decoration does not interfere with typing after refocus', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Select text, blur to show decoration
      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();
      await expect(editor.locator(`.${blurClass}`).first()).toBeVisible();

      // Click back into editor and type
      await editor.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' extra');

      // Blur decoration should be gone, text should be there
      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);
      await expect(editor).toContainText('extra');
    });
  });

  test.describe('blur/focus cycling', () => {
    test('decoration re-appears on repeated blur', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      await page.keyboard.press(`${modifier}+a`);

      // Cycle 1: blur → focus
      await page.locator('h1').click();
      await expect(editor.locator(`.${blurClass}`).first()).toBeVisible();
      await editor.click();
      await expect(editor.locator(`.${blurClass}`)).toHaveCount(0);

      // Cycle 2: select all again and blur
      await page.keyboard.press(`${modifier}+a`);
      await page.locator('h1').click();
      await expect(editor.locator(`.${blurClass}`).first()).toBeVisible();
    });

    test('decoration updates when selection changes between cycles', async ({ page }) => {
      const editor = page.locator(editorSelector);
      await editor.click();

      // Type "first", select all
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('first');
      await page.keyboard.press(`${modifier}+a`);

      // Blur — decoration shows "first"
      await page.locator('h1').click();
      const span1 = editor.locator(`.${blurClass}`).first();
      await expect(span1).toBeVisible();
      await expect(span1).toContainText('first');

      // Focus, replace content with "second", select all
      await editor.click();
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.type('second');
      await page.keyboard.press(`${modifier}+a`);

      // Blur again — decoration should now show "second"
      await page.locator('h1').click();
      const span2 = editor.locator(`.${blurClass}`).first();
      await expect(span2).toBeVisible();
      await expect(span2).toContainText('second');
    });
  });
});
