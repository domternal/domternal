import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const blockquoteBtn = 'button[aria-label="Blockquote"]';

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      comp.editor.setContent(h, false);
      comp.editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

const FIVE_PARAGRAPHS = '<p>Line 1</p><p>Line 2</p><p>Line 3</p><p>Line 4</p><p>Line 5</p>';

test.describe('Blockquote — select all + toggle twice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('select 5 paragraphs, blockquote, then select all and blockquote again unwraps all', async ({ page }) => {
    await setContentAndFocus(page, FIVE_PARAGRAPHS);

    // Select all and wrap
    await page.locator(editorSelector).click();
    await page.keyboard.press('Meta+A');
    await page.waitForTimeout(50);
    await page.locator(blockquoteBtn).click();
    await page.waitForTimeout(50);

    const html1 = await getEditorHTML(page);
    expect(html1).toContain('<blockquote>');

    // Select all and unwrap
    await page.keyboard.press('Meta+A');
    await page.waitForTimeout(50);
    await page.locator(blockquoteBtn).click();
    await page.waitForTimeout(50);

    const html2 = await getEditorHTML(page);
    expect(html2).not.toContain('<blockquote>');

    // All text preserved
    const text = (await page.locator(editorSelector).textContent()) ?? '';
    for (let i = 1; i <= 5; i++) {
      expect(text).toContain(`Line ${i}`);
    }
  });
});
