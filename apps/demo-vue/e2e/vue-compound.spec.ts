/**
 * Vue-specific E2E tests for <Domternal> compound component with namespaced subcomponents
 * (Domternal.Content, Domternal.Toolbar, Domternal.BubbleMenu) and useCurrentEditor() inject.
 */
import { test, EDITOR_SELECTOR, MODIFIER, focusEditor } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

async function openCompoundDemo({ page }: { page: Page }) {
  await page.goto('/');
  await page.locator('[data-testid="mode-compound"]').click();
  await expect(page.locator(EDITOR_SELECTOR)).toBeVisible();
}

test.describe('<Domternal> compound component', () => {
  test.beforeEach(openCompoundDemo);

  test('Domternal.Content renders editor DOM', async ({ page }) => {
    await expect(page.locator(EDITOR_SELECTOR)).toBeVisible();
    await expect(page.locator(EDITOR_SELECTOR)).toContainText('Compound root provides editor');
  });

  test('Domternal.Toolbar renders without explicit :editor prop', async ({ page }) => {
    const toolbar = page.locator('.dm-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('button')).not.toHaveCount(0);
  });

  test('Domternal.Toolbar bold button works via injected editor', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();
  });

  test('Domternal.BubbleMenu appears on selection via injected editor', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  });
});

test.describe('useCurrentEditor() provide/inject', () => {
  test.beforeEach(openCompoundDemo);

  test('EditorProbe receives editor via inject', async ({ page }) => {
    await expect(page.locator('[data-testid="has-editor"]')).toHaveText('yes');
  });

  test('injected editor can execute commands from custom component', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();
  });

  test('injected editor shares state with Domternal.Toolbar', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    // Apply bold via the probe (inject)
    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    // Verify the toolbar's bold button reflects active state (shared editor)
    const boldBtn = page.locator('.dm-toolbar button[aria-label="Bold"]');
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('injected editor is same instance across subcomponents (toggle bold twice)', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    // Toggle bold via toolbar
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();
    await page.waitForTimeout(200);
    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();

    // Toggle bold OFF via injected probe - if different editor instance, this would fail
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).not.toBeVisible();
  });
});
