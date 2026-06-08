/**
 * Angular-specific E2E tests for [(ngModel)] two-way binding on
 * DomternalEditorComponent (which implements ControlValueAccessor).
 * Mirrors the Vue v-model suite so both wrappers cover the same
 * parent <-> editor sync behaviour.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function focusEditor(page: Page): Promise<void> {
  // Click rather than programmatic focus: a real pointer click establishes a
  // non-empty ProseMirror selection so Mod+a / Mod+b act on actual content
  // (programmatic .focus() can leave the selection collapsed, making the
  // keyboard formatting a no-op under Angular's zone/CD timing).
  await page.locator(editorSelector).click();
}

async function openNgModelDemo({ page }: { page: Page }) {
  await page.goto('/');
  await page.locator('[data-testid="mode-ngmodel"]').click();
  await expect(page.locator(editorSelector)).toBeVisible();
}

test.describe('ngModel - parent to editor sync', () => {
  test.beforeEach(openNgModelDemo);

  test('editor renders initial ngModel value', async ({ page }) => {
    await expect(page.locator(editorSelector)).toContainText('Edit me');
  });

  test('parent state change via button updates editor content', async ({ page }) => {
    await page.locator('[data-testid="set-initial"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(editorSelector)).toContainText('Initial from parent');
  });

  test('parent state change applies bold formatting in editor', async ({ page }) => {
    await page.locator('[data-testid="set-bold"]').click();
    await page.waitForTimeout(200);

    await expect(page.locator(editorSelector).locator('strong')).toContainText('Bold from parent');
  });

  test('clearing ngModel clears the editor', async ({ page }) => {
    await page.locator('[data-testid="clear"]').click();
    await page.waitForTimeout(200);

    const text = await page.locator(editorSelector).textContent();
    expect(text?.trim()).toBe('');
  });

  test('parent state change does not cause editor to blur', async ({ page }) => {
    await focusEditor(page);
    await page.locator('[data-testid="set-initial"]').click();
    await page.waitForTimeout(200);

    // Parent change should set new content but editor should still exist and be interactive
    await expect(page.locator(editorSelector)).toContainText('Initial from parent');
  });
});

test.describe('ngModel - editor to parent sync', () => {
  test.beforeEach(openNgModelDemo);

  test('typing in editor updates parent ngModel state', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Delete');
    await page.keyboard.type('Typed by user');
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).toContainText('Typed by user');
  });

  test('typing in editor updates textarea bound to ngModel', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Delete');
    await page.keyboard.type('Sync test');
    await page.waitForTimeout(200);

    const textareaValue = await page.locator('[data-testid="vmodel-textarea"]').inputValue();
    expect(textareaValue).toContain('Sync test');
  });

  test('bold applied in editor reflects in parent output as <strong>', async ({ page }) => {
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);
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

    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(200);

    await expect(page.locator('[data-testid="vmodel-output"]')).not.toContainText('appended');
  });
});

test.describe('ngModel - round-trip', () => {
  test.beforeEach(openNgModelDemo);

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

    const text = await page.locator(editorSelector).textContent();
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
