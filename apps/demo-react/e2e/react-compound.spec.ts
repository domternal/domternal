/**
 * React-specific E2E tests for the <Domternal> compound component with
 * namespaced subcomponents (Domternal.Content / .Toolbar / .BubbleMenu) and
 * the useCurrentEditor() context hook. Mirrors the Vue compound suite so both
 * wrappers cover the same provide/inject editor-sharing behaviour.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const EDITOR_SELECTOR = '.dm-editor .ProseMirror';
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusEditor(page: Page): Promise<void> {
  await page.locator(EDITOR_SELECTOR).click();
}

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

  test('Domternal.Toolbar renders without explicit editor prop', async ({ page }) => {
    const toolbar = page.locator('.dm-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar.locator('button')).not.toHaveCount(0);
  });

  test('Domternal.Toolbar bold button works via context editor', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();
  });

  test('Domternal.BubbleMenu appears on selection via context editor', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  });
});

test.describe('useCurrentEditor() provide/inject', () => {
  test.beforeEach(openCompoundDemo);

  test('EditorProbe receives editor via context', async ({ page }) => {
    await expect(page.locator('[data-testid="has-editor"]')).toHaveText('yes');
  });

  test('context editor can execute commands from custom component', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();
  });

  test('context editor shares state with Domternal.Toolbar', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    // Apply bold via the probe (context)
    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    // Verify the toolbar's bold button reflects active state (shared editor)
    const boldBtn = page.locator('.dm-toolbar button[aria-label="Bold"]');
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('context editor is same instance across subcomponents (toolbar bolds, probe unbolds)', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);

    // Toggle bold ON via the toolbar (toolbar buttons preserve the selection).
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();
    await page.waitForTimeout(200);
    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toBeVisible();

    // Toggle bold OFF via the inject probe over the SAME preserved selection.
    // If the probe and toolbar held different editor instances, the probe could
    // not unbold what the toolbar just bolded.
    await page.locator('[data-testid="inject-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).not.toBeVisible();
  });
});
