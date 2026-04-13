import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const toolbar = '.dm-toolbar';

async function setContent(page: Page, html: string) {
  await page.evaluate((h) => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function selectAll(page: Page) {
  await page.evaluate(() => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) editor.commands.selectAll();
    const el = document.querySelector('.dm-editor .ProseMirror');
    if (el instanceof HTMLElement) el.focus();
  });
  await page.waitForTimeout(100);
}

test.describe('Toolbar dropdown functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator(editorSelector).waitFor();
    await setContent(page, '<p>Hello World</p>');
    await selectAll(page);
  });

  test.describe('Text color', () => {
    test('text color dropdown opens on click', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();
    });

    test('clicking a color swatch applies text color', async ({ page }) => {
      const output = page.locator('pre.output');
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const firstSwatch = panel.locator('.dm-color-swatch').first();
      await firstSwatch.click();

      await expect(output).toContainText('style');
    });

    test('color swatch has role="menuitem"', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const swatch = page.locator('.dm-toolbar-dropdown-panel .dm-color-swatch').first();
      await expect(swatch).toHaveAttribute('role', 'menuitem');
    });

    test('color swatch has tabindex="-1"', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const swatch = page.locator('.dm-toolbar-dropdown-panel .dm-color-swatch').first();
      await expect(swatch).toHaveAttribute('tabindex', '-1');
    });

    test('color swatch can receive focus', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const firstItem = panel.locator('[role="menuitem"]').first();
      await firstItem.focus();
      await page.waitForTimeout(100);

      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('role') === 'menuitem'
      );
      expect(focused).toBe(true);
    });

    test('focused color swatch shows focus-visible ring', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const firstSwatch = panel.locator('.dm-color-swatch').first();
      await firstSwatch.focus();
      await page.waitForTimeout(100);

      const boxShadow = await firstSwatch.evaluate((el) => getComputedStyle(el).boxShadow);
      // box-shadow should not be 'none' when focused
      expect(boxShadow).not.toBe('none');
    });

    test('Enter on focused color swatch applies text color', async ({ page }) => {
      const output = page.locator('pre.output');
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const swatch = panel.locator('.dm-color-swatch').first();
      await swatch.focus();
      await page.waitForTimeout(100);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);

      await expect(output).toContainText('style');
    });

    test('selection is preserved when focusing dropdown item', async ({ page }) => {
      const colorBtn = page.locator(`${toolbar} button[aria-label="Text Color"]`);
      await colorBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const swatch = panel.locator('.dm-color-swatch').first();
      await swatch.focus();
      await page.waitForTimeout(100);

      const selection = await page.evaluate(() => {
        const editor = (window as any).__DEMO_EDITOR__;
        if (editor) {
          const { from, to } = editor.state.selection;
          return { from, to, empty: from === to };
        }
        return null;
      });
      expect(selection?.empty).toBe(false);
    });
  });

  test.describe('Font size', () => {
    test('font size dropdown is visible in default toolbar', async ({ page }) => {
      const fontSizeBtn = page.locator(`${toolbar} button[aria-label="Font Size"]`);
      await expect(fontSizeBtn).toBeVisible();
    });

    test('font size dropdown opens on click', async ({ page }) => {
      const fontSizeBtn = page.locator(`${toolbar} button[aria-label="Font Size"]`);
      await fontSizeBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();
    });

    test('clicking a font size applies it to selected text', async ({ page }) => {
      const output = page.locator('pre.output');
      const fontSizeBtn = page.locator(`${toolbar} button[aria-label="Font Size"]`);
      await fontSizeBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const item = panel.locator('.dm-toolbar-dropdown-item', { hasText: '24px' });
      await item.click();

      await expect(output).toContainText('font-size');
    });

    test('font size dropdown item can receive focus', async ({ page }) => {
      const fontSizeBtn = page.locator(`${toolbar} button[aria-label="Font Size"]`);
      await fontSizeBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const firstItem = panel.locator('[role="menuitem"]').first();
      await firstItem.focus();
      await page.waitForTimeout(100);

      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('role') === 'menuitem'
      );
      expect(focused).toBe(true);
    });
  });

  test.describe('Heading dropdown', () => {
    test('heading dropdown opens and applies heading', async ({ page }) => {
      const output = page.locator('pre.output');
      const headingBtn = page.locator(`${toolbar} button[aria-label="Heading"]`);
      await headingBtn.click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();

      const h2 = panel.locator('.dm-toolbar-dropdown-item', { hasText: 'Heading 2' });
      await h2.click();

      await expect(output).toContainText('<h2>');
    });
  });
});
