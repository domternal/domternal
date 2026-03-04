import { test } from './fixtures.js';
import { expect } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
// After plugin registration the .dm-floating-menu element is reparented into .dm-editor
const floatingMenuInner = '.dm-editor .dm-floating-menu';

test.describe.skip('Floating Menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('floating menu is hidden when editor has content', async ({ page }) => {
    const menu = page.locator(floatingMenuInner);
    await expect(menu).not.toHaveAttribute('data-show', '');
  });

  test('floating menu appears on empty paragraph', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear all content
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const menu = page.locator(floatingMenuInner);
    await expect(menu).toHaveAttribute('data-show', '');
  });

  test('floating menu has H1, H2, List, Quote, HR buttons', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content to show floating menu
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const menu = page.locator(floatingMenuInner);
    await expect(menu).toHaveAttribute('data-show', '');

    // Check for the buttons
    await expect(menu.locator('button', { hasText: 'H1' })).toBeAttached();
    await expect(menu.locator('button', { hasText: 'H2' })).toBeAttached();
    await expect(menu.locator('button', { hasText: 'List' })).toBeAttached();
    await expect(menu.locator('button', { hasText: 'Quote' })).toBeAttached();
    await expect(menu.locator('button', { hasText: '—' })).toBeAttached();
  });

  test('H1 button converts empty paragraph to heading', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Click H1 button
    const menu = page.locator(floatingMenuInner);
    await menu.locator('button', { hasText: 'H1' }).click({ force: true });

    const html = await editor.innerHTML();
    expect(html).toContain('<h1>');
  });

  test('List button converts empty paragraph to bullet list', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Click List button
    const menu = page.locator(floatingMenuInner);
    await menu.locator('button', { hasText: 'List' }).click({ force: true });

    const html = await editor.innerHTML();
    expect(html).toContain('<ul>');
  });

  test('Quote button converts empty paragraph to blockquote', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Click Quote button
    const menu = page.locator(floatingMenuInner);
    await menu.locator('button', { hasText: 'Quote' }).click({ force: true });

    const html = await editor.innerHTML();
    expect(html).toContain('<blockquote>');
  });

  test('HR button inserts horizontal rule', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Click HR button
    const menu = page.locator(floatingMenuInner);
    await menu.locator('button', { hasText: '—' }).click({ force: true });

    const html = await editor.innerHTML();
    expect(html).toMatch(/<hr/);
  });

  test('floating menu hides after typing content', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Clear content to show floating menu
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    const menu = page.locator(floatingMenuInner);
    await expect(menu).toHaveAttribute('data-show', '');

    // Type something
    await page.keyboard.type('Hello');
    await page.waitForTimeout(200);

    // Menu should hide since paragraph is no longer empty
    await expect(menu).not.toHaveAttribute('data-show', '');
  });
});
