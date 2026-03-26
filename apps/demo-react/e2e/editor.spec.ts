import { test } from './fixtures.js';
import { expect } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const htmlOutput = 'pre.output';

test.describe('Domternal Angular Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders editor with initial content', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toContainText('Hello World');
  });

  test('renders toolbar', async ({ page }) => {
    const toolbar = page.locator('.dm-toolbar');
    await expect(toolbar).toBeVisible();
  });

  test('initial content has bold "World"', async ({ page }) => {
    const strong = page.locator(`${editorSelector} strong`).first();
    await expect(strong).toHaveText('World');
  });

  test('shows HTML output', async ({ page }) => {
    const output = page.locator(htmlOutput);
    await expect(output).toContainText('<strong>World</strong>');
  });

  test('can type text in editor', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Testing input.');

    await expect(editor).toContainText('Testing input.');
    const output = page.locator(htmlOutput);
    await expect(output).toContainText('Testing input.');
  });
});
