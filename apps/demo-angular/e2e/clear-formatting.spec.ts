import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Clear editor and type fresh content */
async function clearAndType(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

test.describe('Clear Formatting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Clear Formatting button is visible in toolbar', async ({ page }) => {
    const btn = page.locator('domternal-toolbar button[aria-label="Clear Formatting"]');
    await expect(btn).toBeVisible();
  });

  test('removes bold from selected text', async ({ page }) => {
    await clearAndType(page, 'Hello');

    // Select all and make bold
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');

    // Select all and clear formatting
    await page.keyboard.press(`${modifier}+a`);
    await page.locator('domternal-toolbar button[aria-label="Clear Formatting"]').click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('Hello');
  });

  test('removes multiple marks at once', async ({ page }) => {
    await clearAndType(page, 'Hello');

    // Select all and apply bold + italic
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press(`${modifier}+i`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');

    // Clear formatting
    await page.keyboard.press(`${modifier}+a`);
    await page.locator('domternal-toolbar button[aria-label="Clear Formatting"]').click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('Hello');
  });

  test('button is disabled with cursor only (no selection range)', async ({ page }) => {
    await clearAndType(page, 'Hello');

    // Select all and make bold
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    // Place cursor precisely via ProseMirror (collapse selection)
    await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      if (!pm) return;
      const strong = pm.querySelector('strong');
      const textNode = strong?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      if (pm instanceof HTMLElement) pm.focus();
    }, editorSelector);
    await page.waitForTimeout(100);

    // Button should be disabled when there's no selection range
    const btn = page.locator('domternal-toolbar button[aria-label="Clear Formatting"]');
    await expect(btn).toBeDisabled();
  });

  test('only removes marks from selected portion', async ({ page }) => {
    await clearAndType(page, 'Hello World');

    // Select all and make bold
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    // Select just "World" using DOM range
    await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      if (!pm) return;
      const strong = pm.querySelector('strong');
      const textNode = strong?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 6); // "World" starts at offset 6
      range.setEnd(textNode, 11);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      if (pm instanceof HTMLElement) pm.focus();
    }, editorSelector);
    await page.waitForTimeout(100);

    // Clear formatting on "World" only
    await page.locator('domternal-toolbar button[aria-label="Clear Formatting"]').click();

    const html = await getEditorHTML(page);
    // "Hello " should still be bold
    expect(html).toContain('<strong>');
    // "World" should be plain text
    expect(html).toContain('World');
  });
});
