import { test, expect } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const toolbar = 'domternal-toolbar';
const toolbarButton = `${toolbar} .dm-toolbar-button`;

test.describe('Toolbar — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('first toolbar button has tabindex=0, others have tabindex=-1', async ({ page }) => {
    const buttons = page.locator(toolbarButton);
    const first = buttons.first();
    await expect(first).toHaveAttribute('tabindex', '0');

    // At least one other button should have tabindex=-1
    const second = buttons.nth(1);
    await expect(second).toHaveAttribute('tabindex', '-1');
  });

  test('ArrowRight moves focus to next button', async ({ page }) => {
    // Focus the first toolbar button
    const firstBtn = page.locator(toolbarButton).first();
    await firstBtn.focus();

    const firstName = await firstBtn.getAttribute('aria-label');
    await page.keyboard.press('ArrowRight');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focused).not.toBe(firstName);
  });

  test('ArrowLeft moves focus to previous button', async ({ page }) => {
    const buttons = page.locator(toolbarButton);
    // Focus second button
    await buttons.nth(1).focus();
    const secondName = await buttons.nth(1).getAttribute('aria-label');

    await page.keyboard.press('ArrowLeft');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focused).not.toBe(secondName);
  });

  test('ArrowRight wraps from last to first', async ({ page }) => {
    const buttons = page.locator(toolbarButton);
    const count = await buttons.count();
    // Focus last button
    await buttons.nth(count - 1).focus();

    await page.keyboard.press('ArrowRight');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstName = await buttons.first().getAttribute('aria-label');
    expect(focused).toBe(firstName);
  });

  test('Home moves focus to first button', async ({ page }) => {
    const buttons = page.locator(toolbarButton);
    // Focus somewhere in the middle
    await buttons.nth(3).focus();

    await page.keyboard.press('Home');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstName = await buttons.first().getAttribute('aria-label');
    expect(focused).toBe(firstName);
  });

  test('End moves focus to last button', async ({ page }) => {
    const buttons = page.locator(toolbarButton);
    const count = await buttons.count();
    await buttons.first().focus();

    await page.keyboard.press('End');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const lastName = await buttons.nth(count - 1).getAttribute('aria-label');
    expect(focused).toBe(lastName);
  });
});

test.describe('Toolbar — dropdown keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Escape closes open dropdown when toolbar button focused', async ({ page }) => {
    // Focus the trigger button, then click to open dropdown
    const trigger = page.locator('button[aria-label="Highlight"]');
    await trigger.focus();
    await trigger.click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette');
    await expect(panel).toBeVisible();

    // Focus must be on toolbar for Escape handler to fire
    await trigger.focus();
    await page.keyboard.press('Escape');
    await expect(panel).not.toBeVisible();
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator('button[aria-label="Highlight"]').click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette');
    await expect(panel).toBeVisible();

    // Click outside (on editor)
    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});

test.describe('Toolbar — ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar has role="toolbar"', async ({ page }) => {
    await expect(page.locator(toolbar)).toHaveAttribute('role', 'toolbar');
  });

  test('toolbar has aria-label', async ({ page }) => {
    await expect(page.locator(toolbar)).toHaveAttribute('aria-label', 'Editor formatting');
  });

  test('toolbar groups have role="group"', async ({ page }) => {
    const groups = page.locator(`${toolbar} .dm-toolbar-group`);
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(groups.nth(i)).toHaveAttribute('role', 'group');
    }
  });

  test('toggle buttons have aria-pressed', async ({ page }) => {
    const boldBtn = page.locator('button[aria-label="Bold"]');
    const pressed = await boldBtn.getAttribute('aria-pressed');
    expect(pressed).toBe('false');
  });

  test('dropdown trigger has aria-haspopup and aria-expanded', async ({ page }) => {
    const trigger = page.locator('button[aria-label="Highlight"]');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  test('separator dividers exist between groups', async ({ page }) => {
    const separators = page.locator(`${toolbar} .dm-toolbar-separator`);
    const count = await separators.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(separators.nth(i)).toHaveAttribute('role', 'separator');
    }
  });
});
