import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';

const btn = {
  bold: `${bubbleMenu} button[title="Bold"]`,
  italic: `${bubbleMenu} button[title="Italic"]`,
  underline: `${bubbleMenu} button[title="Underline"]`,
  strike: `${bubbleMenu} button[title="Strikethrough"]`,
  code: `${bubbleMenu} button[title="Code"]`,
  link: `${bubbleMenu} button[title="Link"]`,
} as const;

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function selectText(page: Page, startOffset: number, endOffset: number, selector = `${editorSelector} p`) {
  await page.evaluate(
    ({ sel, edSel, startOffset, endOffset }) => {
      const el = document.querySelector(sel);
      if (!el || !el.firstChild) return;
      const range = document.createRange();
      range.setStart(el.firstChild, startOffset);
      range.setEnd(el.firstChild, endOffset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { sel: selector, edSel: editorSelector, startOffset, endOffset },
  );
  await page.waitForTimeout(150);
}

/** Select all text inside a tag via ProseMirror's selection API. */
async function selectAllViaEditor(page: Page) {
  await page.evaluate((sel) => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) editor.commands.selectAll();
    const el = document.querySelector(sel);
    if (el instanceof HTMLElement) el.focus();
  }, editorSelector);
  await page.waitForTimeout(150);
}

// ─── ARIA attributes ────────────────────────────────────────────────

test.describe('Bubble menu — ARIA attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('bubble menu has role="toolbar"', async ({ page }) => {
    await expect(page.locator(bubbleMenu)).toHaveAttribute('role', 'toolbar');
  });

  test('bubble menu has aria-label="Text formatting"', async ({ page }) => {
    await expect(page.locator(bubbleMenu)).toHaveAttribute('aria-label', 'Text formatting');
  });

  test('separators have role="separator"', async ({ page }) => {
    // Demo uses contexts with '|' separator: ['bold', 'italic', 'underline', 'strike', 'code', '|', 'link']
    await expect(page.locator(`${bubbleMenu} [role="separator"]`)).toHaveCount(1);
  });

  test('all buttons have aria-label', async ({ page }) => {
    const buttons = page.locator(`${bubbleMenu} button`);
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const label = await buttons.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });

  test('all buttons have aria-pressed attribute', async ({ page }) => {
    const buttons = page.locator(`${bubbleMenu} button`);
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const pressed = await buttons.nth(i).getAttribute('aria-pressed');
      expect(pressed === 'true' || pressed === 'false').toBe(true);
    }
  });
});

// ─── aria-pressed state sync ────────────────────────────────────────

test.describe('Bubble menu — aria-pressed state sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('aria-pressed="false" on plain text selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Plain text</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(btn.italic)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(btn.underline)).toHaveAttribute('aria-pressed', 'false');
  });

  test('aria-pressed="true" when bold text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectAllViaEditor(page);

    // Bubble menu buttons update even when hidden - check aria-pressed directly
    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(btn.italic)).toHaveAttribute('aria-pressed', 'false');
  });

  test('aria-pressed="true" when italic text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>Italic text</em></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.italic)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'false');
  });

  test('aria-pressed="true" when underlined text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><u>Underlined text</u></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.underline)).toHaveAttribute('aria-pressed', 'true');
  });

  test('aria-pressed updates after toggling bold via bubble menu', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'false');

    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'true');
  });

  test('aria-pressed updates after toggling bold off', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'true');

    // Use keyboard shortcut to toggle off (works without visible bubble menu)
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+b`);
    await page.waitForTimeout(100);

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'false');
  });

  test('multiple aria-pressed="true" for bold+italic text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong><em>Bold italic</em></strong></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.bold)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(btn.italic)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(btn.underline)).toHaveAttribute('aria-pressed', 'false');
  });
});

// ─── Active class sync (activeVersion) ──────────────────────────────

test.describe('Bubble menu — active class sync', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('active class appears after clicking bold button', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await expect(page.locator(btn.bold)).not.toHaveClass(/active/);

    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);

    await expect(page.locator(btn.bold)).toHaveClass(/active/);
  });

  test('active class removed after toggling bold off', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.bold)).toHaveClass(/active/);

    // Use keyboard shortcut to toggle off
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+b`);
    await page.waitForTimeout(100);

    await expect(page.locator(btn.bold)).not.toHaveClass(/active/);
  });

  test('active class updates when applying multiple marks sequentially', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Apply bold
    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);
    await expect(page.locator(btn.bold)).toHaveClass(/active/);
    await expect(page.locator(btn.italic)).not.toHaveClass(/active/);

    // Apply italic
    await page.locator(btn.italic).click();
    await page.waitForTimeout(100);
    await expect(page.locator(btn.bold)).toHaveClass(/active/);
    await expect(page.locator(btn.italic)).toHaveClass(/active/);
  });

  test('active class reflects pre-existing marks on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong><em><u>All marks</u></em></strong></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(btn.bold)).toHaveClass(/active/);
    await expect(page.locator(btn.italic)).toHaveClass(/active/);
    await expect(page.locator(btn.underline)).toHaveClass(/active/);
    await expect(page.locator(btn.strike)).not.toHaveClass(/active/);
  });
});

// ─── Toolbar aria-pressed sync ──────────────────────────────────────

test.describe('Toolbar — aria-pressed state sync', () => {
  const toolbarBold = '.dm-toolbar button[aria-label="Bold"]';
  const toolbarItalic = '.dm-toolbar button[aria-label="Italic"]';
  const toolbarUnderline = '.dm-toolbar button[aria-label="Underline"]';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('aria-pressed="false" initially on plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p>Plain text</p>');
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(toolbarItalic)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator(toolbarUnderline)).toHaveAttribute('aria-pressed', 'false');
  });

  test('aria-pressed="true" when cursor is inside bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold</strong> plain</p>');
    // Use click() which naturally triggers ProseMirror's input handlers
    await page.locator(`${editorSelector} strong`).click();

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'true');
  });

  test('aria-pressed updates after toggling bold via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'false');

    await page.locator(toolbarBold).click();

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'true');
  });

  test('aria-pressed toggles back to false after removing bold', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectAllViaEditor(page);

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'true');

    await page.locator(toolbarBold).click();
    await page.waitForTimeout(100);

    await expect(page.locator(toolbarBold)).toHaveAttribute('aria-pressed', 'false');
  });
});
