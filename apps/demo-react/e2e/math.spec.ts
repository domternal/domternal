/**
 * E2E for the math extension in the Notion-style demo: inserting block and
 * inline equations via commands renders KaTeX, and clicking a node opens the
 * edit popover (LaTeX source + live preview) which applies on Enter.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

async function insertBlock(page: Page, latex: string): Promise<void> {
  await page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathBlock: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathBlock(l);
  }, latex);
}

async function insertInline(page: Page, latex: string): Promise<void> {
  await page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathInline: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathInline(l);
  }, latex);
}

test.describe('Math extension', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
  });

  test('renders a block equation as KaTeX', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, 'x^2 + y^2');
    const block = page.locator('.app-notion-demo .dm-math-block');
    await expect(block).toBeVisible();
    await expect(block.locator('.katex')).toBeVisible();
  });

  test('renders an inline equation and edits it via the popover', async ({ page }) => {
    await setContent(page, '<p>before </p>');
    await insertInline(page, 'a_1');

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    await expect(inline.locator('.katex')).toBeVisible();

    await inline.click();
    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();

    const input = popover.locator('textarea');
    await expect(input).toHaveValue('a_1');
    await input.fill('b_2');
    await input.press('Enter');

    await expect(popover).toBeHidden();
    await expect(inline.locator('.katex')).toContainText('b');
  });

  test('inserting an empty equation focuses the LaTeX field, not the document', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('/inline equation');
    await page.waitForSelector('.dm-slash-command-menu');
    await page.keyboard.press('Enter');

    const input = page.locator('.dm-math-popover textarea');
    await expect(input).toBeFocused();

    // Typing lands in the equation field, not back in the document.
    await page.keyboard.type('a^2');
    await expect(input).toHaveValue('a^2');
    await expect(page.locator(editorSelector)).not.toContainText('a^2');
  });
});
