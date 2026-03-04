import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = 'button[aria-label="Font Size"]';

const DEFAULT_SIZES = ['12px', '14px', '16px', '18px', '24px', '32px'];

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

async function selectAll(page: Page) {
  await page.locator(editorSelector).click();
  await page.keyboard.press(`${modifier}+A`);
}

/** Open the font size dropdown and click a specific size item */
async function setSizeViaToolbar(page: Page, label: string) {
  await page.locator(dropdownTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_16 = '<p><span style="font-size: 16px">sized text</span></p>';
const PARAGRAPH_24 = '<p><span style="font-size: 24px">large text</span></p>';
const PARAGRAPH_32 = '<p><span style="font-size: 32px">huge text</span></p>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';

// ─── Toolbar dropdown ─────────────────────────────────────────────────

test.describe('FontSize — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(dropdownTrigger)).toBeVisible();
  });

  test('clicking trigger opens dropdown panel', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
  });

  test('dropdown contains 6 sizes + Default = 7 items', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(7);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(panel).not.toBeVisible();
  });

  test('all default size labels appear in dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    for (const size of DEFAULT_SIZES) {
      await expect(panel.locator(`button[aria-label="${size}"]`)).toBeVisible();
    }
    await expect(panel.locator('button[aria-label="Default"]')).toBeVisible();
  });
});

// ─── Set font size via toolbar ────────────────────────────────────────

test.describe('FontSize — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set 12px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '12px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 12px');
    expect(html).toContain('hello world');
  });

  test('set 14px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '14px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 14px');
  });

  test('set 16px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '16px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 16px');
  });

  test('set 18px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '18px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 18px');
  });

  test('set 24px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
  });

  test('set 32px on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
  });

  test('font size renders as span with style', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    // Browser may add trailing semicolon to style
    expect(html).toMatch(/<span[^>]*style="font-size: 24px;?"[^>]*>/);
  });
});

// ─── Unset / Default ──────────────────────────────────────────────────

test.describe('FontSize — unset (Default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking Default removes font-size from text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    await selectAll(page);
    await setSizeViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('font-size');
    expect(html).toContain('large text');
  });

  test('Default removes span wrapper when no other styles', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    await selectAll(page);
    await setSizeViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
  });

  test('unset after setting via toolbar removes font-size', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    let html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');

    // Re-focus editor and select all via evaluate (toolbar interaction loses editor focus)
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const s = window.getSelection();
      if (s && editor) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        s.removeAllRanges();
        s.addRange(range);
      }
    }, editorSelector);
    await page.waitForTimeout(50);
    await setSizeViaToolbar(page, 'Default');
    html = await getEditorHTML(page);
    expect(html).not.toContain('font-size');
  });
});

// ─── Change between sizes ─────────────────────────────────────────────

test.describe('FontSize — change between sizes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('change from 16px to 32px', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_16);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
    expect(html).not.toContain('font-size: 16px');
  });

  test('change from 24px to 12px', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    await selectAll(page);
    await setSizeViaToolbar(page, '12px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 12px');
    expect(html).not.toContain('font-size: 24px');
  });

  test('rapid size changes keep only the last', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '12px');
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setSizeViaToolbar(page, '18px');
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
    expect(html).not.toContain('font-size: 12px');
    expect(html).not.toContain('font-size: 18px');
  });
});

// ─── Active state ─────────────────────────────────────────────────────

test.describe('FontSize — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger shows active when size is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    await page.locator(`${editorSelector} span`).click();

    await expect(page.locator(dropdownTrigger)).toHaveClass(/active/);
  });

  test('dropdown trigger not active for unstyled text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(dropdownTrigger)).not.toHaveClass(/active/);
  });

  test('correct size item shows active in dropdown', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="24px"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="16px"]')).not.toHaveClass(/active/);
  });

  test('32px item shows active for 32px text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_32);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="32px"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="12px"]')).not.toHaveClass(/active/);
  });

  test('active state updates after changing size', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_16);
    await selectAll(page);
    await setSizeViaToolbar(page, '24px');
    await page.waitForTimeout(50);
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="24px"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="16px"]')).not.toHaveClass(/active/);
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('FontSize — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves font-size: 16px from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_16);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 16px');
    expect(html).toContain('sized text');
  });

  test('preserves font-size: 24px from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('large text');
  });

  test('preserves font-size: 32px from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_32);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
    expect(html).toContain('huge text');
  });

  test('unstyled paragraph has no span wrapper', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
    expect(html).not.toContain('font-size');
  });

  test('rejects font-size not in allowed list', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 99px">not allowed</span></p>');

    const html = await getEditorHTML(page);
    // 99px is not in the default list, so it should be stripped
    expect(html).not.toContain('font-size: 99px');
    expect(html).toContain('not allowed');
  });

  test('preserves 12px (smallest default size)', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 12px">small text</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 12px');
    expect(html).toContain('small text');
  });
});

// ─── Partial selection ────────────────────────────────────────────────

test.describe('FontSize — partial selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply size to partial text creates styled span', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    // Select "hello" using evaluate for precision
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('world');
    const spans = html.match(/<span[^>]*font-size[^>]*>/g);
    expect(spans).toHaveLength(1);
  });

  test('apply different sizes to different paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first line</p><p>second line</p>');

    // Select first paragraph text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setSizeViaToolbar(page, '12px');

    await page.waitForTimeout(50);

    // Select second paragraph text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const p2 = editor?.querySelectorAll('p')[1];
      const textNode = p2?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 12px');
    expect(html).toContain('font-size: 32px');
  });
});

// ─── Multiple paragraphs ─────────────────────────────────────────────

test.describe('FontSize — multiple paragraphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply size to first paragraph only', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    // Select only first paragraph text via evaluate
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    // Second paragraph should remain unstyled
    expect(html).toContain('second paragraph</p>');
  });

  test('select all applies size to all paragraphs', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await selectAll(page);
    await setSizeViaToolbar(page, '18px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 18px');
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');
  });
});

// ─── Combined with other styles ───────────────────────────────────────

test.describe('FontSize — combined with other marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('font-size with bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await selectAll(page);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('bold text');
    expect(html).toMatch(/strong|font-weight/);
  });

  test('font-size with italic text', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>italic text</em></p>');
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
    expect(html).toContain('italic text');
    expect(html).toContain('<em');
  });

  test('font-size combined with font-family on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia">styled text</span></p>');
    await selectAll(page);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });

  test('unset font-size preserves font-family', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia; font-size: 24px">styled text</span></p>');
    await selectAll(page);
    await setSizeViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('font-size');
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });
});

// ─── Persistence ──────────────────────────────────────────────────────

test.describe('FontSize — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('font-size persists after typing more text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_24);
    // Click inside styled span and type at the end
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('extra');
  });

  test('undo restores original text without size', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    let html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expect(html).not.toContain('font-size');
  });

  test('redo re-applies size', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    await page.keyboard.press(`${modifier}+Z`);
    let html = await getEditorHTML(page);
    expect(html).not.toContain('font-size');

    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('FontSize — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('applying size with collapsed cursor affects next typed text', async ({ page }) => {
    await setContentAndFocus(page, '<p>text</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    await setSizeViaToolbar(page, '24px');
    await page.keyboard.type(' new');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('new');
  });

  test('font-size on heading text', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expect(html).toContain('font-size: 32px');
    expect(html).toContain('heading text');
  });

  test('font-size inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await selectAll(page);
    await setSizeViaToolbar(page, '18px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 18px');
    expect(html).toContain('quoted text');
  });

  test('font-size inside list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>list item</p></li></ul>');
    await selectAll(page);
    await setSizeViaToolbar(page, '14px');

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 14px');
    expect(html).toContain('list item');
  });

  test('font-size does not bleed into adjacent paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first</p><p>second</p>');
    // Select only first paragraph
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('second</p>');
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});
