import { test } from './fixtures.js';
import { expect } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';

test.describe('Styled HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('styled HTML output section is visible', async ({ page }) => {
    const heading = page.locator('h3', { hasText: 'Styled HTML Output' });
    await expect(heading).toBeVisible();

    const output = heading.locator('+ pre.output-styled');
    await expect(output).toBeVisible();
  });

  test('styled HTML contains inline border on table td', async ({ page }) => {
    // Demo content includes a table
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    expect(text).toContain('border: 1px solid #e5e7eb');
    expect(text).toContain('padding: 0.5em 0.75em');
  });

  test('styled HTML contains inline border-left on blockquote', async ({ page }) => {
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    expect(text).toContain('border-left: 3px solid #6a6a6a');
  });

  test('styled HTML contains inline styles on headings', async ({ page }) => {
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    expect(text).toContain('font-weight: 700');
  });

  test('styled HTML contains inline styles on code blocks', async ({ page }) => {
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    // pre should have background
    expect(text).toContain('background: #f0f0f0');
    expect(text).toContain('border-radius: 0.375rem');
  });

  test('styled HTML contains syntax highlighting colors in code blocks', async ({ page }) => {
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    // Demo code block has JS — lowlight should produce hljs spans with inline colors
    // keyword color (function, const, return)
    expect(text).toContain('color: #d73a49');
    // function name color (greet)
    expect(text).toContain('color: #6f42c1');
  });

  test('styled HTML contains inline styles on links when present', async ({ page }) => {
    // Insert a link via the editor
    await page.locator(editorSelector).click();
    await page.keyboard.press('Meta+a');
    await page.evaluate(() => {
      // Access editor exposed by demo app
      
      const editor = (window as any).__DEMO_EDITOR__;
      if (editor) {
        editor.setContent('<p><a href="https://example.com">link text</a></p>', false);
      }
    });
    await page.waitForTimeout(200);

    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');
    const text = await styledOutput.textContent();
    expect(text).toContain('color: #2563eb');
    expect(text).toContain('text-decoration: underline');
  });

  test('regular HTML output does NOT contain inline structural styles', async ({ page }) => {
    // Use exact text match to avoid matching "Styled HTML Output"
    const regularOutput = page.locator('h3').filter({ hasText: /^HTML Output$/ }).locator('+ pre.output');
    const text = await regularOutput.textContent();
    // Regular output should not have theme inline styles on blockquote
    expect(text).not.toContain('border-left: 3px solid #6a6a6a');
  });

  test('styled HTML updates when editor content changes', async ({ page }) => {
    const styledOutput = page.locator('h3:has-text("Styled HTML Output") + pre.output-styled');

    // Set content programmatically to avoid typing race conditions
    await page.evaluate(() => {
      // Access editor exposed by demo app
      
      const editor = (window as any).__DEMO_EDITOR__;
      if (editor) {
        editor.setContent('<p>Updated content</p>', false);
      }
    });
    await page.waitForTimeout(200);

    const text = await styledOutput.textContent();
    expect(text).toContain('Updated content');
  });
});
