import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

test.describe('Blockquote input rule - undoInputRule on Backspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // ── Basic input rule ──────────────────────────────────────────────────

  test('typing "> " triggers blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> ');

    expect(await getEditorHTML(page)).toContain('<blockquote>');
  });

  test('typing "> 123" triggers blockquote with "123" inside', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> 123');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('123');
  });

  // ── Backspace immediately after input rule reverts it ─────────────────

  test('Backspace immediately after "> " reverts wrapping and restores "> "', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> ');
    expect(await getEditorHTML(page)).toContain('<blockquote>');

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('>');
  });

  test('after Backspace undo, typing "123" gives "> 123" as plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> ');
    expect(await getEditorHTML(page)).toContain('<blockquote>');

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    expect(await getEditorHTML(page)).not.toContain('<blockquote>');

    await page.keyboard.type('123');
    await page.waitForTimeout(50);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('> 123');
  });

  // ── Backspace undo only works immediately ─────────────────────────────

  test('Backspace after typing more text does NOT undo input rule', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> hello');
    expect(await getEditorHTML(page)).toContain('<blockquote>');

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('hell');
  });

  // ── Works for other wrapping input rules too ──────────────────────────

  test('Backspace after "- " (bullet list) reverts to plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('- ');
    expect(await getEditorHTML(page)).toContain('<ul>');

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ul>');
    const text = await getEditorText(page);
    expect(text).toContain('-');
  });

  test('Backspace after "1. " (ordered list) reverts to plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('1. ');
    expect(await getEditorHTML(page)).toContain('<ol>');

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ol>');
    const text = await getEditorText(page);
    expect(text).toContain('1.');
  });

  // ── Mid-line still safe ───────────────────────────────────────────────

  test('typing "> " mid-line does NOT trigger blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('hello > world');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    expect(await getEditorText(page)).toContain('hello > world');
  });
});
