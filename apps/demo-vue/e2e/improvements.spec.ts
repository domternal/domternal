import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const emojiBtn = 'button[aria-label="Insert Emoji"]';
const suggestionSelector = '.dm-emoji-suggestion';
const suggestionItem = '.dm-emoji-suggestion-item';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

// 1x1 red pixel PNG as base64 for test fixtures
const BASE64_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const IMG_BASIC = `<img src="${BASE64_1PX}">`;

async function setEditorContent(page: Page, html: string) {
  await page.evaluate((h) => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

// =============================================================================
// Emoji toolbar option (toolbar: false hides button)
// =============================================================================

test.describe('Emoji — toolbar: true (default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('emoji button is visible in toolbar by default', async ({ page }) => {
    await expect(page.locator(emojiBtn)).toBeVisible();
  });
});

test.describe('Emoji — toolbar: false (hidden)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?emojiToolbar=false');
    await page.waitForSelector(editorSelector);
  });

  test('emoji button is not rendered in toolbar', async ({ page }) => {
    await expect(page.locator(emojiBtn)).toHaveCount(0);
  });

  test('suggestion trigger still works when button hidden', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(':smi');
    await expect(page.locator(suggestionSelector)).toBeVisible();
    const items = page.locator(suggestionItem);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});

// =============================================================================
// Bubble menu auto mode (shows on image selection without contexts)
// =============================================================================

test.describe('Bubble menu — auto mode (no contexts)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?bubbleAuto=true');
    await page.waitForSelector(editorSelector);
  });

  test('selecting image shows bubble menu without contexts configured', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toBeVisible();
  });

  test('image bubble menu exposes float controls in auto mode', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    await expect(page.locator('.dm-bubble-menu button[title="Float left"]')).toBeVisible();
    await expect(page.locator('.dm-bubble-menu button[title="Float right"]')).toBeVisible();
    await expect(page.locator('.dm-bubble-menu button[title="Center"]')).toBeVisible();
    await expect(page.locator('.dm-bubble-menu button[title="Delete"]')).toBeVisible();
  });

  test('text selection still shows bubble menu with default items in auto mode', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(200);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toBeVisible();
  });

  test('text selection shows bold/italic/underline by default in auto mode', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(200);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toBeVisible();
    await expect(bubbleMenu.locator('button[title="Bold"]')).toBeVisible();
    await expect(bubbleMenu.locator('button[title="Italic"]')).toBeVisible();
    await expect(bubbleMenu.locator('button[title="Underline"]')).toBeVisible();
    // Image-specific controls should NOT be present
    await expect(bubbleMenu.locator('button[title="Float left"]')).toHaveCount(0);
  });

  test('items switch from image to text on selection change', async ({ page }) => {
    await setEditorContent(page, `<p>Hello world</p>${IMG_BASIC}<p>More text</p>`);

    // Step 1: select image
    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu.locator('button[title="Float left"]')).toBeVisible();

    // Step 2: select text (in first paragraph)
    await page.locator(editorSelector).locator('p').first().click();
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(300);

    await expect(bubbleMenu.locator('button[title="Bold"]')).toBeVisible();
    await expect(bubbleMenu.locator('button[title="Float left"]')).toHaveCount(0);
  });

  test('items switch from text to image on selection change', async ({ page }) => {
    await setEditorContent(page, `<p>Hello world</p>${IMG_BASIC}<p>More text</p>`);

    // Step 1: select text first
    await page.locator(editorSelector).locator('p').first().click();
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu.locator('button[title="Bold"]')).toBeVisible();

    // Step 2: select image
    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    await expect(bubbleMenu.locator('button[title="Float left"]')).toBeVisible();
    await expect(bubbleMenu.locator('button[title="Bold"]')).toHaveCount(0);
  });
});
