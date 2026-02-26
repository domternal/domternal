import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

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

// ─── Keyboard shortcuts ──────────────────────────────────────────────

test.describe('HardBreak — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Shift+Enter inserts <br> within paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p>first line</p>');
    const editor = page.locator(editorSelector);
    await editor.click();
    // Place cursor at end of text
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('first line');
    expect(html).toContain('second line');
    // Should still be one paragraph (not two)
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(1);
  });

  test('Mod+Enter inserts <br> within paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p>before</p>');
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press(`${modifier}+Enter`);
    await page.keyboard.type('after');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('Enter (without Shift) creates new paragraph, not hard break', async ({ page }) => {
    await setContentAndFocus(page, '<p>paragraph one</p>');
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('paragraph two');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<br>');
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(2);
  });

  test('multiple Shift+Enter creates multiple <br> tags', async ({ page }) => {
    await setContentAndFocus(page, '<p>line 1</p>');
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line 2');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('line 3');

    const html = await getEditorHTML(page);
    const brCount = (html.match(/<br>/g) || []).length;
    expect(brCount).toBe(2);
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('HardBreak — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parses existing <br> in content', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello<br>world</p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('hello');
    expect(html).toContain('world');
  });

  test('hard break inside bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold<br>break</strong></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('<strong>');
  });
});

// ─── Behavior within different block types ───────────────────────────

test.describe('HardBreak — in block contexts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Shift+Enter works inside list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>item text</p></li></ul>');
    await page.locator(`${editorSelector} li p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('continued');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('continued');
    // Should still be one list item
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(1);
  });

  test('Shift+Enter works inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await page.locator(`${editorSelector} blockquote p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('still quoted');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('<blockquote>');
  });

  test('Shift+Enter works inside heading', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await page.locator(`${editorSelector} h2`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('sub line');

    const html = await getEditorHTML(page);
    expect(html).toContain('<br>');
    expect(html).toContain('<h2>');
    expect(html).toContain('sub line');
  });
});

// ─── Non-breaking space ──────────────────────────────────────────────

test.describe('HardBreak — non-breaking space', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Mod-Shift-Space inserts non-breaking space', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    // Type content reliably and position cursor at end
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('before');
    // Cursor is now at end after typing
    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.keyboard.type('after');

    // Non-breaking space should be between the words
    const html = await getEditorHTML(page);
    expect(html).toMatch(/before(\u00a0|&nbsp;)after/);
  });
});
