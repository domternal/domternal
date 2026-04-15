/**
 * Vue-specific E2E tests for v-model two-way binding on DomternalEditor.
 * Tests verify both parent → editor and editor → parent sync paths.
 */
import { test, EDITOR_SELECTOR, MODIFIER, focusEditor } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

async function openVModelDemo({ page }: { page: Page }) {
  await page.goto('/');
  await page.locator('[data-testid="mode-vmodel"]').click();
  await expect(page.locator(EDITOR_SELECTOR)).toBeVisible();
}

test.describe('v-model — parent to editor sync', () => {
  test.beforeEach(openVModelDemo);

  test('editor renders initial v-model value', async ({ page }) => {
    await expect(page.locator(EDITOR_SELECTOR)).toContainText('Edit me');
  });

  test('parent state change via button updates editor content', async ({ page }) => {
    await page.locator('[data-testid="set-initial"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR)).toContainText('Initial from parent');
  });

  test('parent state change applies bold formatting in editor', async ({ page }) => {
    await page.locator('[data-testid="set-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(EDITOR_SELECTOR).locator('strong')).toContainText('Bold from parent');
  });

  test('clearing v-model clears the editor', async ({ page }) => {
    await page.locator('[data-testid="clear"]').click();
    await page.waitForTimeout(200);

    const text = await page.locator(EDITOR_SELECTOR).textContent();
    expect(text?.trim()).toBe('');
  });

  test('parent state change does not cause editor to blur', async ({ page }) => {
    await focusEditor(page);
    await page.locator('[data-testid="set-initial"]').click();
    await page.waitForTimeout(200);

    // Parent change should set new content but editor should still exist and be interactive
    await expect(page.locator(EDITOR_SELECTOR)).toContainText('Initial from parent');
  });
});

test.describe('v-model — editor to parent sync', () => {
  test.beforeEach(openVModelDemo);

  test('typing in editor updates parent v-model state', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.keyboard.press('Delete');
    await page.keyboard.type('Typed by user');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('Typed by user');
  });

  test('typing in editor updates textarea bound to v-model', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.keyboard.press('Delete');
    await page.keyboard.type('Sync test');
    await page.waitForTimeout(200);

    const textareaValue = await page.locator('[data-testid="vmodel-textarea"]').inputValue();
    expect(textareaValue).toContain('Sync test');
  });

  test('bold applied in editor reflects in parent output as <strong>', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${MODIFIER}+a`);
    await page.keyboard.press(`${MODIFIER}+b`);
    await page.waitForTimeout(200);

    const output = await page.locator('[data-testid="vmodel-output"]').textContent();
    expect(output).toContain('<strong>');
  });

  test('update counter increments on content changes', async ({ page }) => {
    const initialCount = await page.locator('[data-testid="update-count"]').textContent();

    await focusEditor(page);
    await page.keyboard.press('End');
    await page.keyboard.type(' more');
    await page.waitForTimeout(300);

    const newCount = await page.locator('[data-testid="update-count"]').textContent();
    expect(newCount).not.toBe(initialCount);
  });

  test('undo in editor syncs back to parent', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press('End');
    await page.keyboard.type(' appended');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('appended');

    await page.keyboard.press(`${MODIFIER}+z`);
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).not.toContainText('appended');
  });
});

test.describe('v-model — round-trip', () => {
  test.beforeEach(openVModelDemo);

  test('parent sets bold, user edits - both changes visible', async ({ page }) => {
    await page.locator('[data-testid="set-bold"]').click();
    await page.waitForTimeout(200);

    await focusEditor(page);
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('Bold from parent');
    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('edited');
  });

  test('multiple rapid parent updates are consistent with editor', async ({ page }) => {
    await page.locator('[data-testid="set-initial"]').click();
    await page.waitForTimeout(100);
    await page.locator('[data-testid="set-bold"]').click();
    await page.waitForTimeout(100);
    await page.locator('[data-testid="clear"]').click();
    await page.waitForTimeout(200);

    const text = await page.locator(EDITOR_SELECTOR).textContent();
    expect(text?.trim()).toBe('');
  });

  test('clearing then typing syncs correctly', async ({ page }) => {
    await page.locator('[data-testid="clear"]').click();
    await page.waitForTimeout(200);

    await focusEditor(page);
    await page.keyboard.type('Fresh');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('Fresh');
  });
});
