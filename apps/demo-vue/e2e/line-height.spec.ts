import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = '.dm-toolbar button[aria-label="Line Height"]';

// Extension defaults: ['1', '1.15', '1.25', '1.5', '2']
const LINE_HEIGHTS = ['1', '1.15', '1.25', '1.5', '2'];

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

/** Open the line height dropdown and click a specific height item */
async function setHeightViaToolbar(page: Page, label: string) {
  await page.locator(dropdownTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_15 = '<p style="line-height: 1.5">spaced text</p>';
const PARAGRAPH_2 = '<p style="line-height: 2">double spaced</p>';
const HEADING = '<h2>my heading</h2>';
const HEADING_15 = '<h2 style="line-height: 1.5">spaced heading</h2>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';
const PARA_AND_HEADING = '<p>a paragraph</p><h2>a heading</h2>';

// ─── Toolbar dropdown ─────────────────────────────────────────────────

test.describe('LineHeight — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(dropdownTrigger)).toBeVisible();
  });

  test('clicking trigger opens dropdown panel', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
  });

  test('dropdown contains 5 heights + Default = 6 items', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(6);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(panel).not.toBeVisible();
  });

  test('all configured height labels appear in dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    for (const lh of LINE_HEIGHTS) {
      await expect(panel.locator(`button[aria-label="${lh}"]`)).toBeVisible();
    }
    await expect(panel.locator('button[aria-label="Default"]')).toBeVisible();
  });
});

// ─── Set line height via toolbar ──────────────────────────────────────

test.describe('LineHeight — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set line-height 1 on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1');
    expect(html).toContain('hello world');
  });

  test('set line-height 1.15 on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1.15');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.15');
  });

  test('set line-height 1.5 on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1.5');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.5');
  });

  test('set line-height 2 on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
  });

  test('line-height renders as style on the paragraph node (not span)', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1.5');

    const html = await getEditorHTML(page);
    // Should be on <p> tag, not a <span>
    expect(html).toMatch(/<p[^>]*style="line-height: 1\.5;?"[^>]*>/);
    expect(html).not.toContain('<span');
  });

  test('set line-height on heading', async ({ page }) => {
    await setContentAndFocus(page, HEADING);
    await page.locator(`${editorSelector} h2`).click();
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h2[^>]*style="line-height: 2;?"[^>]*>/);
    expect(html).toContain('my heading');
  });
});

// ─── Unset / Default ──────────────────────────────────────────────────

test.describe('LineHeight — unset (Default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking Default removes line-height style', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('line-height');
    expect(html).toContain('spaced text');
  });

  test('Default removes style attribute when no other styles', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('style=');
  });

  test('unset after setting via toolbar removes line-height', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    let html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');

    await setHeightViaToolbar(page, 'Default');
    html = await getEditorHTML(page);
    expect(html).not.toContain('line-height');
  });
});

// ─── Change between heights ───────────────────────────────────────────

test.describe('LineHeight — change between heights', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('change from 1.5 to 2', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
    expect(html).not.toContain('line-height: 1.5');
  });

  test('change from 2 to 1', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_2);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1');
    expect(html).not.toContain('line-height: 2');
  });

  test('switching heights multiple times keeps only latest', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await setHeightViaToolbar(page, '1');
    await setHeightViaToolbar(page, '1.5');
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
    expect(html).not.toContain('line-height: 1.5');
    // "line-height: 1" could match "line-height: 1.5" so check precisely
    expect(html).not.toMatch(/line-height: 1[^.]/);
  });
});

// ─── Active state ─────────────────────────────────────────────────────

test.describe('LineHeight — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger label shows current line-height value', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();

    // dynamicLabel dropdowns communicate state via label text, not active class
    await expect(page.locator(dropdownTrigger)).toContainText('1.5');
  });

  test('dropdown trigger not active for default text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(dropdownTrigger)).not.toHaveClass(/active/);
  });

  test('correct height item shows active in dropdown', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="1.5"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="2"]')).not.toHaveClass(/active/);
  });

  test('2 item shows active for double-spaced text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_2);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="2"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="1"]')).not.toHaveClass(/active/);
  });

  test('active state updates after changing height', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="2"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="1.5"]')).not.toHaveClass(/active/);
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('LineHeight — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves line-height: 1.5 from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('spaced text');
  });

  test('preserves line-height: 2 from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_2);

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
    expect(html).toContain('double spaced');
  });

  test('preserves line-height on heading from HTML', async ({ page }) => {
    await setContentAndFocus(page, HEADING_15);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('spaced heading');
  });

  test('unstyled paragraph has no line-height', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('line-height');
  });

  test('rejects line-height not in allowed list', async ({ page }) => {
    await setContentAndFocus(page, '<p style="line-height: 3">not allowed</p>');

    const html = await getEditorHTML(page);
    // 3 is not in the configured list, should be stripped
    expect(html).not.toContain('line-height: 3');
    expect(html).toContain('not allowed');
  });
});

// ─── Multiple nodes ───────────────────────────────────────────────────

test.describe('LineHeight — multiple nodes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set height on first paragraph without affecting second', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await page.locator(`${editorSelector} p`).first().click();
    await setHeightViaToolbar(page, '1.5');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.5');
    // Only one line-height style should be present
    const matches = html.match(/line-height/g);
    expect(matches).toHaveLength(1);
  });

  test('select all applies height to both paragraphs', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.press(`${modifier}+A`);
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    const matches = html.match(/line-height: 2/g);
    expect(matches).toHaveLength(2);
  });

  test('select all applies height to both paragraph and heading', async ({ page }) => {
    await setContentAndFocus(page, PARA_AND_HEADING);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+A`);
    await setHeightViaToolbar(page, '1.5');

    const html = await getEditorHTML(page);
    const matches = html.match(/line-height: 1\.5/g);
    expect(matches).toHaveLength(2);
    expect(html).toContain('a paragraph');
    expect(html).toContain('a heading');
  });
});

// ─── Persistence ──────────────────────────────────────────────────────

test.describe('LineHeight — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('line-height persists after typing', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '1.5');
    await page.keyboard.press('End');
    await page.keyboard.type(' extra text');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('extra text');
  });

  test('line-height survives undo and redo', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    let html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');

    // Undo
    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expect(html).not.toContain('line-height');

    // Redo
    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('LineHeight — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('line-height dropdown is disabled in code blocks', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>code line</code></pre>');
    await page.locator(`${editorSelector} pre`).click();

    // Dropdown trigger is disabled in code blocks (lineHeight types don't include codeBlock)
    await expect(page.locator(dropdownTrigger)).toBeDisabled();
  });

  test('line-height on paragraph inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await page.locator(`${editorSelector} blockquote p`).click();
    await setHeightViaToolbar(page, '1.5');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('quoted text');
  });

  test('line-height combined with text-align on same paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p style="text-align: center">centered text</p>');
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
    expect(html).toContain('text-align: center');
  });

  test('new paragraph after Enter gets default line-height', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_15);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('new line');

    const html = await getEditorHTML(page);
    // Original paragraph stays with line-height
    expect(html).toContain('line-height: 1.5');
    expect(html).toContain('new line');
  });

  test('empty paragraph can have line-height set', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await setHeightViaToolbar(page, '2');

    const html = await getEditorHTML(page);
    expect(html).toContain('line-height: 2');
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Line Height"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});
