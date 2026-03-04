import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = 'button[aria-label="Text Alignment"]';
const alignBtn = {
  left: 'button[aria-label="Align Left"]',
  center: 'button[aria-label="Align Center"]',
  right: 'button[aria-label="Align Right"]',
  justify: 'button[aria-label="Justify"]',
} as const;

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

/** Open the alignment dropdown and click a specific alignment button */
async function setAlignViaToolbar(
  page: Page,
  btn: (typeof alignBtn)[keyof typeof alignBtn],
) {
  await page.locator(dropdownTrigger).click();
  await page.locator(btn).click();
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_CENTER = '<p style="text-align: center">centered text</p>';
const PARAGRAPH_RIGHT = '<p style="text-align: right">right text</p>';
const PARAGRAPH_JUSTIFY = '<p style="text-align: justify">justified text</p>';
const HEADING = '<h2>my heading</h2>';
const HEADING_CENTER = '<h2 style="text-align: center">centered heading</h2>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';
const PARA_AND_HEADING = '<p>a paragraph</p><h2>a heading</h2>';

// ─── Toolbar dropdown ─────────────────────────────────────────────────

test.describe('TextAlign — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(dropdownTrigger)).toBeVisible();
  });

  test('clicking trigger opens dropdown panel', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
  });

  test('dropdown contains 4 alignment options', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const items = page.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(4);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).not.toBeVisible();
  });
});

// ─── Set alignment via toolbar ────────────────────────────────────────

test.describe('TextAlign — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set center alignment on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.center);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: center');
    expect(html).toContain('hello world');
  });

  test('set right alignment on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.right);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
  });

  test('set justify alignment on paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.justify);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: justify');
  });

  test('set left alignment removes style (default)', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.left);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');
    expect(html).toContain('centered text');
  });

  test('set center alignment on heading', async ({ page }) => {
    await setContentAndFocus(page, HEADING);
    await page.locator(`${editorSelector} h2`).click();
    await setAlignViaToolbar(page, alignBtn.center);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expect(html).toContain('text-align: center');
    expect(html).toContain('my heading');
  });

  test('change alignment from center to right', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.right);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
    expect(html).not.toContain('text-align: center');
  });
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────
// Note: Mod-Shift-E (center) is intercepted by Chromium, so center alignment
// is tested via toolbar clicks above. Other shortcuts work correctly.

test.describe('TextAlign — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Mod-Shift-R sets right alignment', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
  });

  test('Mod-Shift-J sets justify alignment', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+J`);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: justify');
  });

  test('Mod-Shift-L resets to left (removes style)', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+L`);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');
    expect(html).toContain('centered text');
  });

  test('shortcut sequence: right then justify', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    let html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');

    await page.keyboard.press(`${modifier}+Shift+J`);
    html = await getEditorHTML(page);
    expect(html).toContain('text-align: justify');
    expect(html).not.toContain('text-align: right');
  });

  test('Mod-Shift-L after right resets to default', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    let html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');

    await page.keyboard.press(`${modifier}+Shift+L`);
    html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');
  });
});

// ─── Active state ─────────────────────────────────────────────────────

test.describe('TextAlign — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger shows active when non-left alignment is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(dropdownTrigger)).toHaveClass(/active/);
  });

  test('dropdown trigger active for default (left) alignment', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    // Left alignment is always active (isActive matches the default textAlign attribute)
    await expect(page.locator(dropdownTrigger)).toHaveClass(/active/);
  });

  test('center item shows active in dropdown when center is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    await expect(page.locator(alignBtn.center)).toHaveClass(/active/);
    await expect(page.locator(alignBtn.left)).not.toHaveClass(/active/);
  });

  test('left item shows active in dropdown for default text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    await expect(page.locator(alignBtn.left)).toHaveClass(/active/);
    await expect(page.locator(alignBtn.center)).not.toHaveClass(/active/);
  });

  test('right item shows active in dropdown when right is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RIGHT);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    await expect(page.locator(alignBtn.right)).toHaveClass(/active/);
    await expect(page.locator(alignBtn.left)).not.toHaveClass(/active/);
  });

  test('active state updates when alignment changes via toolbar', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    // Set center
    await setAlignViaToolbar(page, alignBtn.center);

    // Open dropdown and verify center is active
    await page.locator(dropdownTrigger).click();
    await expect(page.locator(alignBtn.center)).toHaveClass(/active/);
    await expect(page.locator(alignBtn.left)).not.toHaveClass(/active/);
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('TextAlign — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves center alignment from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: center');
    expect(html).toContain('centered text');
  });

  test('preserves right alignment from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RIGHT);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
    expect(html).toContain('right text');
  });

  test('preserves justify alignment from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_JUSTIFY);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: justify');
    expect(html).toContain('justified text');
  });

  test('preserves center alignment on heading from HTML', async ({ page }) => {
    await setContentAndFocus(page, HEADING_CENTER);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expect(html).toContain('text-align: center');
    expect(html).toContain('centered heading');
  });

  test('left-aligned paragraph has no style attribute', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');
  });

  test('explicit left style is stripped (matches default)', async ({ page }) => {
    await setContentAndFocus(page, '<p style="text-align: left">left text</p>');

    const html = await getEditorHTML(page);
    // Left is the default alignment, so style attribute should not be rendered
    expect(html).not.toContain('text-align');
    expect(html).toContain('left text');
  });
});

// ─── Multiple nodes ───────────────────────────────────────────────────

test.describe('TextAlign — multiple nodes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('align first paragraph without affecting second', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await page.locator(`${editorSelector} p`).first().click();
    await setAlignViaToolbar(page, alignBtn.center);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: center');
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');

    // Only one text-align style should be present
    const matches = html.match(/text-align/g);
    expect(matches).toHaveLength(1);
  });

  test('select all and align right-aligns both paragraphs', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press(`${modifier}+Shift+R`);

    const html = await getEditorHTML(page);
    const matches = html.match(/text-align: right/g);
    expect(matches).toHaveLength(2);
  });

  test('select all aligns both paragraph and heading', async ({ page }) => {
    await setContentAndFocus(page, PARA_AND_HEADING);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press(`${modifier}+Shift+R`);

    const html = await getEditorHTML(page);
    const matches = html.match(/text-align: right/g);
    expect(matches).toHaveLength(2);
    expect(html).toContain('a paragraph');
    expect(html).toContain('a heading');
  });
});

// ─── Alignment persists ───────────────────────────────────────────────

test.describe('TextAlign — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('alignment persists after typing', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);
    await page.keyboard.press('End');
    await page.keyboard.type(' extra text');

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
    expect(html).toContain('extra text');
  });

  test('new paragraph after Enter keeps original alignment', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_CENTER);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('new line');

    const html = await getEditorHTML(page);
    // Original paragraph stays centered, new line exists
    expect(html).toContain('text-align: center');
    expect(html).toContain('new line');
  });

  test('alignment survives undo and redo', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    let html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');

    // Undo
    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');

    // Redo
    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('TextAlign — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('alignment does not apply to code blocks', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<pre><code>code line</code></pre>',
    );
    await page.locator(`${editorSelector} pre`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('text-align');
  });

  test('paragraph inside blockquote can be aligned', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<blockquote><p>quoted text</p></blockquote>',
    );
    await page.locator(`${editorSelector} blockquote p`).click();
    await setAlignViaToolbar(page, alignBtn.right);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
    expect(html).toContain('quoted text');
  });

  test('alignment on list item paragraphs', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>list item</p></li></ul>',
    );
    await page.locator(`${editorSelector} li p`).click();
    await page.keyboard.press(`${modifier}+Shift+R`);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
    expect(html).toContain('list item');
  });

  test('empty paragraph can be aligned via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await setAlignViaToolbar(page, alignBtn.right);

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: right');
  });

  test('switching alignment multiple times keeps only latest', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.press(`${modifier}+Shift+R`); // right
    await page.keyboard.press(`${modifier}+Shift+J`); // justify

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: justify');
    expect(html).not.toContain('text-align: right');
  });

  test('heading alignment via keyboard shortcut', async ({ page }) => {
    await setContentAndFocus(page, HEADING);
    await page.locator(`${editorSelector} h2`).click();
    await page.keyboard.press(`${modifier}+Shift+J`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expect(html).toContain('text-align: justify');
  });
});
