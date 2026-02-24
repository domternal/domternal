import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const emojiBtn = 'domternal-toolbar button[aria-label="Insert Emoji"]';
const pickerSelector = '.dm-emoji-picker';
const searchInput = '.dm-emoji-picker-search input';
const tabSelector = '.dm-emoji-picker-tab';
const swatchSelector = '.dm-emoji-swatch';
const categoryLabel = '.dm-emoji-picker-category-label';
const emptyMsg = '.dm-emoji-picker-empty';
const suggestionSelector = '.dm-emoji-suggestion';
const suggestionItem = '.dm-emoji-suggestion-item';

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

async function clearAndType(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

// =============================================================================
// Toolbar Emoji Picker Panel
// =============================================================================

test.describe('Emoji Picker — panel basics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('panel opens on toolbar button click', async ({ page }) => {
    await expect(page.locator(pickerSelector)).not.toBeVisible();
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
  });

  test('panel closes on second toolbar button click (toggle)', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).not.toBeVisible();
  });

  test('panel closes on click outside', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    // Click on the page body away from the picker
    await page.locator('h1').click();
    await expect(page.locator(pickerSelector)).not.toBeVisible();
  });

  test('panel closes on Escape key', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(pickerSelector)).not.toBeVisible();
  });

  test('search input is focused when panel opens', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(searchInput)).toBeFocused();
  });

  test('panel has category tabs', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.locator(tabSelector).first().waitFor({ state: 'visible' });
    const tabs = page.locator(tabSelector);
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(5); // At least 5 categories
  });

  test('panel has category labels in grid', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.locator(`${categoryLabel}[data-category]`).first().waitFor({ state: 'visible' });
    const labels = page.locator(`${categoryLabel}[data-category]`);
    const count = await labels.count();
    expect(count).toBeGreaterThanOrEqual(5);
  });

  test('panel has emoji swatches', async ({ page }) => {
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.locator(swatchSelector).first().waitFor({ state: 'visible' });
    const swatches = page.locator(swatchSelector);
    const count = await swatches.count();
    expect(count).toBeGreaterThan(50); // Should have many emoji
  });
});

// =============================================================================
// Search
// =============================================================================

test.describe('Emoji Picker — search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
  });

  test('search filters emoji', async ({ page }) => {
    await page.locator(searchInput).fill('heart');
    await page.waitForTimeout(100);
    const swatches = page.locator(swatchSelector);
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(50); // Filtered down from full list
  });

  test('search hides category labels', async ({ page }) => {
    await page.locator(searchInput).fill('heart');
    await page.waitForTimeout(100);
    const labels = page.locator(`${categoryLabel}[data-category]`);
    await expect(labels).toHaveCount(0);
  });

  test('empty search shows no emoji found', async ({ page }) => {
    await page.locator(searchInput).fill('zzzznonexistent');
    await page.waitForTimeout(100);
    await expect(page.locator(emptyMsg)).toBeVisible();
    await expect(page.locator(emptyMsg)).toHaveText('No emoji found');
  });

  test('clearing search restores full grid', async ({ page }) => {
    await page.locator(searchInput).fill('heart');
    await page.waitForTimeout(100);
    const filteredCount = await page.locator(swatchSelector).count();

    await page.locator(searchInput).fill('');
    await page.waitForTimeout(100);
    const fullCount = await page.locator(swatchSelector).count();

    expect(fullCount).toBeGreaterThan(filteredCount);
  });
});

// =============================================================================
// Category tabs
// =============================================================================

test.describe('Emoji Picker — category tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
  });

  test('first tab is active by default', async ({ page }) => {
    const firstTab = page.locator(tabSelector).first();
    await expect(firstTab).toHaveClass(/dm-emoji-picker-tab--active/);
  });

  test('clicking a tab activates it', async ({ page }) => {
    const tabs = page.locator(tabSelector);
    const secondTab = tabs.nth(1);
    await secondTab.click();
    await expect(secondTab).toHaveClass(/dm-emoji-picker-tab--active/);
  });

  test('clicking tab clears search', async ({ page }) => {
    await page.locator(searchInput).fill('heart');
    await page.waitForTimeout(100);

    const secondTab = page.locator(tabSelector).nth(1);
    await secondTab.click();
    await page.waitForTimeout(200);

    const searchValue = await page.locator(searchInput).inputValue();
    expect(searchValue).toBe('');
  });
});

// =============================================================================
// Emoji insertion
// =============================================================================

test.describe('Emoji Picker — insertion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking emoji inserts it into editor', async ({ page }) => {
    await page.locator(editorSelector).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('Hello ');

    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();

    // Click the first emoji swatch
    const firstSwatch = page.locator(swatchSelector).first();
    const emojiText = await firstSwatch.textContent();
    await firstSwatch.click();

    // Panel should close
    await expect(page.locator(pickerSelector)).not.toBeVisible();

    // Editor should contain the emoji
    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="emoji"');
  });

  test('emoji inserts as inline node with data-name attribute', async ({ page }) => {
    await clearAndType(page, 'Test ');

    await page.locator(emojiBtn).click();
    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.click();

    const html = await getEditorHTML(page);
    expect(html).toContain('data-name=');
    expect(html).toContain('data-type="emoji"');
  });

  test('frequently used section appears after inserting emoji', async ({ page }) => {
    await clearAndType(page, 'Test ');

    // Insert an emoji
    await page.locator(emojiBtn).click();
    await page.locator(swatchSelector).first().click();
    await expect(page.locator(pickerSelector)).not.toBeVisible();

    // Re-open picker
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();

    // Should now have "Frequently Used" label
    const freqLabel = page.locator(categoryLabel).filter({ hasText: 'Frequently Used' });
    await expect(freqLabel).toBeVisible();
  });
});

// =============================================================================
// Inline Suggestion (: autocomplete)
// =============================================================================

test.describe('Emoji Suggestion — inline autocomplete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('typing :sm shows suggestion dropdown', async ({ page }) => {
    await clearAndType(page, ':sm');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
  });

  test('suggestion shows matching emoji items', async ({ page }) => {
    await clearAndType(page, ':grin');
    await page.waitForTimeout(200);
    const items = page.locator(suggestionItem);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);
  });

  test('first item is selected by default', async ({ page }) => {
    await clearAndType(page, ':smile');
    await page.waitForTimeout(200);
    const firstItem = page.locator(suggestionItem).first();
    await expect(firstItem).toHaveClass(/dm-emoji-suggestion-item--selected/);
  });

  test('ArrowDown moves selection', async ({ page }) => {
    await clearAndType(page, ':smile');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);

    const firstItem = page.locator(suggestionItem).first();
    const secondItem = page.locator(suggestionItem).nth(1);
    await expect(firstItem).not.toHaveClass(/dm-emoji-suggestion-item--selected/);
    await expect(secondItem).toHaveClass(/dm-emoji-suggestion-item--selected/);
  });

  test('ArrowUp moves selection back', async ({ page }) => {
    await clearAndType(page, ':smile');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(50);

    const firstItem = page.locator(suggestionItem).first();
    await expect(firstItem).toHaveClass(/dm-emoji-suggestion-item--selected/);
  });

  test('Enter inserts selected emoji', async ({ page }) => {
    await clearAndType(page, ':grin');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Suggestion should close
    await expect(page.locator(suggestionSelector)).not.toBeVisible();

    // Editor should contain emoji node
    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="emoji"');
  });

  test('clicking suggestion item inserts emoji', async ({ page }) => {
    await clearAndType(page, ':heart');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();

    // Use dispatchEvent to avoid Playwright's click triggering focus changes
    // that interfere with ProseMirror's suggestion state
    await page.locator(suggestionItem).first().dispatchEvent('click');
    await page.waitForTimeout(200);

    await expect(page.locator(suggestionSelector)).not.toBeVisible();
    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="emoji"');
  });

  test('Escape closes suggestion', async ({ page }) => {
    await clearAndType(page, ':smile');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });

  test('backspacing past trigger closes suggestion', async ({ page }) => {
    await clearAndType(page, ':sm');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).not.toBeVisible();
  });

  test('suggestion shows emoji character and name', async ({ page }) => {
    await clearAndType(page, ':grinning');
    await page.waitForTimeout(200);
    const firstItem = page.locator(suggestionItem).first();
    const text = await firstItem.textContent();
    // Should have emoji char and name
    expect(text).toBeTruthy();
    expect(text!.length).toBeGreaterThan(2); // emoji + space + name
  });

  test('suggestion shows immediately on trigger char :', async ({ page }) => {
    await clearAndType(page, ':');
    await page.waitForTimeout(200);
    await expect(page.locator(suggestionSelector)).toBeVisible();
    const items = page.locator(suggestionItem);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(10);
  });
});

// =============================================================================
// Edge cases
// =============================================================================

test.describe('Emoji Picker — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('panel positions near toolbar button', async ({ page }) => {
    const btnBox = await page.locator(emojiBtn).boundingBox();
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();

    const pickerBox = await page.locator(pickerSelector).boundingBox();
    expect(pickerBox).toBeTruthy();
    expect(btnBox).toBeTruthy();
    // Picker should be below the button (top > button bottom - some tolerance)
    expect(pickerBox!.y).toBeGreaterThanOrEqual(btnBox!.y);
  });

  test('multiple open/close cycles work', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator(emojiBtn).click();
      await expect(page.locator(pickerSelector)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator(pickerSelector)).not.toBeVisible();
    }
  });

  test('opening picker does not lose editor content', async ({ page }) => {
    const htmlBefore = await getEditorHTML(page);
    await page.locator(emojiBtn).click();
    await expect(page.locator(pickerSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    const htmlAfter = await getEditorHTML(page);
    expect(htmlAfter).toBe(htmlBefore);
  });
});
