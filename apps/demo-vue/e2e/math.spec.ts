/**
 * E2E for the math extension in the Notion-style demo: inserting block and
 * inline equations via commands renders KaTeX, and clicking a node opens the
 * edit popover (LaTeX source + live preview) which applies on Enter.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '[data-testid="mode-notion"]';

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

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (f: (n: { type: { name: string } }) => void) => void } } }
      | undefined;
    const names: string[] = [];
    ed?.state.doc.forEach((n) => names.push(n.type.name));
    return names;
  });
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

    await page.keyboard.type('a^2');
    await expect(input).toHaveValue('a^2');
    await expect(page.locator(editorSelector)).not.toContainText('a^2');
  });

  test('inserting a block equation on an empty line replaces it (no dangling paragraph)', async ({
    page,
  }) => {
    await setContent(page, '<p></p>');
    await insertBlock(page, 'x^2');
    await expect(page.locator('.app-notion-demo .dm-math-block')).toBeVisible();
    // The empty paragraph is replaced by the block, not left dangling beside it.
    expect(await topLevelTypes(page)).toEqual(['mathBlock']);
  });

  test('the block equation edit popover is centered under the block', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, '');

    const block = page.locator('.app-notion-demo .dm-math-block');
    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(block).toBeVisible();

    const bb = await block.boundingBox();
    const pb = await popover.boundingBox();
    expect(bb).not.toBeNull();
    expect(pb).not.toBeNull();
    const blockCenter = bb!.x + bb!.width / 2;
    const popCenter = pb!.x + pb!.width / 2;
    // The popover hugs the block's center (Notion-style), not its far-left edge.
    expect(Math.abs(blockCenter - popCenter)).toBeLessThan(16);
  });

  test('Escape on a freshly inserted empty equation removes it', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, '');

    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('.app-notion-demo .dm-math-block')).toHaveCount(1);

    await page.locator('.dm-math-popover textarea').press('Escape');
    await expect(popover).toBeHidden();
    await expect(page.locator('.app-notion-demo .dm-math-block')).toHaveCount(0);
  });

  test('a node-selected block equation opens the edit popover on Enter (keyboard a11y)', async ({
    page,
  }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, 'a^2');
    await page.locator(editorSelector).click();
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { focus: (pos?: string) => boolean } }
        | undefined;
      ed?.commands.focus('start');
    });
    // Arrow down out of the paragraph to node-select the block atom, then Enter
    // opens the same popover a click would (WCAG 2.1.1 keyboard access).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('textarea')).toHaveValue('a^2');
  });

  test('the text bubble menu turns a selection into inline math', async ({ page }) => {
    await setContent(page, '<p>x^2</p>');
    await page.locator(`${editorSelector} p`).first().click({ clickCount: 3 });
    await page.waitForSelector('.dm-bubble-menu[data-show]');

    const inlineBtn = page.locator('.dm-bubble-menu button[title="Inline equation"]');
    await expect(inlineBtn).toBeVisible();
    await inlineBtn.click();

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    // The selected text became the equation source.
    await inline.click();
    await expect(page.locator('.dm-math-popover textarea')).toHaveValue('x^2');
  });

  test('typing $$ inserts a block equation and opens the editor', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('$$');

    await expect(page.locator('.app-notion-demo .dm-math-block')).toBeVisible();
    const input = page.locator('.dm-math-popover textarea');
    await expect(input).toBeFocused();

    // Finishing the equation in the popover renders it.
    await input.fill('a^2');
    await input.press('Enter');
    await expect(page.locator('.dm-math-popover')).toBeHidden();
    await expect(page.locator('.app-notion-demo .dm-math-block .katex')).toBeVisible();
  });

  test('typing $x^2$ inserts an inline equation', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('$x^2$');

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    await expect(inline.locator('.katex')).toBeVisible();
  });
});
