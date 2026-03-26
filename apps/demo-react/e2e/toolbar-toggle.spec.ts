import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

// Toolbar buttons
const linkBtn = '.dm-toolbar button[aria-label="Link"]';
const imageBtn = '.dm-toolbar button[aria-label="Insert Image"]';
const emojiBtn = '.dm-toolbar button[aria-label="Insert Emoji"]';
const highlightBtn = '.dm-toolbar button[aria-label="Highlight"]';

// Floating elements
const linkPopover = '.dm-link-popover';
const imagePopover = '.dm-image-popover';
const emojiPicker = '.dm-emoji-picker';
const highlightPanel = '.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette';

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

// =============================================================================
// Link popover — toggle & expanded state
// =============================================================================

test.describe('Link popover — toggle & aria-expanded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
  });

  test('toolbar button click opens link popover', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
  });

  test('toolbar button click again closes link popover', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');

    // Re-focus editor so the next click acts as a toggle
    await page.locator(editorSelector).focus();
    await page.waitForTimeout(100);
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
  });

  test('aria-expanded is "true" when link popover is open', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');
  });

  test('aria-expanded removed when link popover is closed via toggle', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(editorSelector).focus();
    await page.waitForTimeout(100);
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('aria-expanded removed after click-outside', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('aria-expanded removed after Escape', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.waitForTimeout(300);
    await page.locator(`${linkPopover} .dm-link-popover-input`).press('Escape');
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('multiple toggle cycles work correctly', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator(linkBtn).click();
      await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
      await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

      // Close via Escape
      await page.waitForTimeout(200);
      await page.locator(`${linkPopover} .dm-link-popover-input`).press('Escape');
      await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
      await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');

      // Re-select text for next cycle (Escape returns focus to editor)
      await selectText(page, 0, 5);
    }
  });

  test('Ctrl+K toggle updates aria-expanded', async ({ page }) => {
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

    // Re-focus editor and press Ctrl+K again to toggle off
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });
});

// =============================================================================
// Image popover — toggle & expanded state
// =============================================================================

test.describe('Image popover — toggle & aria-expanded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<p>Hello</p>');
  });

  test('toolbar button click opens image popover', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();
  });

  test('toolbar button click again closes image popover', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();

    await page.locator(imageBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
  });

  test('aria-expanded is "true" when image popover is open', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();
    await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');
  });

  test('aria-expanded removed when image popover is closed via toggle', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(imageBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
    await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('aria-expanded removed after click-outside', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
    await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('aria-expanded removed after Escape', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
    await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('multiple toggle cycles work correctly', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator(imageBtn).click();
      await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();
      await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');

      await page.locator(imageBtn).click();
      await page.waitForTimeout(200);
      await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
      await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
    }
  });

  test('popover stays closed after rapid double-click', async ({ page }) => {
    // Rapid double-click should result in open then close
    await page.locator(imageBtn).dblclick();
    await page.waitForTimeout(300);
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
    await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
  });
});

// =============================================================================
// Emoji picker — toggle
// =============================================================================

test.describe('Emoji picker — toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<p>Hello</p>');
  });

  test('toolbar button click opens emoji picker', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).toBeVisible();
  });

  test('toolbar button click again closes emoji picker', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).toBeVisible();

    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).not.toBeVisible();
  });

  test('picker closes on click-outside', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).toBeVisible();

    await page.locator('h1').click();
    await expect(page.locator(emojiPicker)).not.toBeVisible();
  });

  test('picker closes on Escape', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(emojiPicker)).not.toBeVisible();
  });

  test('multiple toggle cycles work correctly', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator(emojiBtn).click();
      await expect(page.locator(emojiPicker)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(page.locator(emojiPicker)).not.toBeVisible();
    }
  });
});

// =============================================================================
// Highlight dropdown — toggle & expanded state
// =============================================================================

test.describe('Highlight dropdown — toggle & aria-expanded', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('click opens dropdown panel', async ({ page }) => {
    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightPanel)).toBeVisible();
  });

  test('click again closes dropdown panel', async ({ page }) => {
    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightPanel)).toBeVisible();

    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightPanel)).not.toBeVisible();
  });

  test('aria-expanded is "true" when dropdown open, "false" when closed', async ({ page }) => {
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'false');

    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightPanel)).toBeVisible();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightPanel)).not.toBeVisible();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'false');
  });

  test('click-outside closes dropdown and resets aria-expanded', async ({ page }) => {
    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(editorSelector).click();
    await expect(page.locator(highlightPanel)).not.toBeVisible();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'false');
  });

  test('Escape closes dropdown and resets aria-expanded', async ({ page }) => {
    await page.locator(highlightBtn).click();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(highlightBtn).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator(highlightPanel)).not.toBeVisible();
    await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'false');
  });

  test('multiple toggle cycles work correctly', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator(highlightBtn).click();
      await expect(page.locator(highlightPanel)).toBeVisible();
      await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'true');

      await page.locator(highlightBtn).click();
      await expect(page.locator(highlightPanel)).not.toBeVisible();
      await expect(page.locator(highlightBtn)).toHaveAttribute('aria-expanded', 'false');
    }
  });
});

// =============================================================================
// Cross-popover interactions
// =============================================================================

test.describe('Cross-popover interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
  });

  test('opening image popover while link popover is open closes link popover', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
    await expect(page.locator(linkBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(imageBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();
    // Link popover should have closed (click-outside triggered)
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('opening emoji picker while link popover is open closes link popover', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');

    await page.locator(emojiBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(emojiPicker)).toBeVisible();
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('opening link popover while image popover is open closes image popover', async ({ page }) => {
    await page.locator(imageBtn).click();
    await expect(page.locator(`${imagePopover}[data-show]`)).toBeVisible();
    await expect(page.locator(imageBtn)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(linkBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
    // Image popover should have closed (click-outside triggered)
    await expect(page.locator(`${imagePopover}[data-show]`)).toHaveCount(0);
    await expect(page.locator(imageBtn)).not.toHaveAttribute('aria-expanded');
  });

  test('opening link popover while emoji picker is open closes emoji picker', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(emojiPicker)).toBeVisible();

    await page.locator(linkBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');
    await expect(page.locator(emojiPicker)).not.toBeVisible();
  });

  test('opening highlight dropdown while link popover is open closes link popover', async ({ page }) => {
    await page.locator(linkBtn).click();
    await expect(page.locator(linkPopover)).toHaveAttribute('data-show', '');

    await page.locator(highlightBtn).click();
    await page.waitForTimeout(200);
    await expect(page.locator(highlightPanel)).toBeVisible();
    await expect(page.locator(linkPopover)).not.toHaveAttribute('data-show');
    await expect(page.locator(linkBtn)).not.toHaveAttribute('aria-expanded');
  });
});
