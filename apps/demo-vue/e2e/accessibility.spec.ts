import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const toolbar = '.dm-toolbar';
const toolbarButton = `${toolbar} .dm-toolbar-button`;
const bubbleMenu = '.dm-bubble-menu';
const emojiBtn = `${toolbar} button[aria-label="Insert Emoji"]`;
const pickerSelector = '.dm-emoji-picker';
const searchInput = '.dm-emoji-picker-search input';
const tabSelector = '.dm-emoji-picker-tab';
const swatchSelector = '.dm-emoji-swatch';

async function setContent(page: Page, html: string) {
  await page.evaluate((h) => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function selectAll(page: Page) {
  await page.evaluate(() => {
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) editor.commands.selectAll();
    const el = document.querySelector('.dm-editor .ProseMirror');
    if (el instanceof HTMLElement) el.focus();
  });
  await page.waitForTimeout(150);
}

// =============================================================================
// Editor element ARIA
// =============================================================================

test.describe('Editor — ARIA attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('editor has role="textbox"', async ({ page }) => {
    await expect(page.locator(editorSelector)).toHaveAttribute('role', 'textbox');
  });

  test('editor has aria-multiline="true"', async ({ page }) => {
    await expect(page.locator(editorSelector)).toHaveAttribute('aria-multiline', 'true');
  });

  test('editor has aria-label', async ({ page }) => {
    const label = await page.locator(editorSelector).getAttribute('aria-label');
    expect(label).toBeTruthy();
  });

  test('editor has contenteditable="true"', async ({ page }) => {
    await expect(page.locator(editorSelector)).toHaveAttribute('contenteditable', 'true');
  });

  test('editor does not have aria-readonly when editable', async ({ page }) => {
    const readonly = await page.locator(editorSelector).getAttribute('aria-readonly');
    expect(readonly).toBeNull();
  });
});

// =============================================================================
// Toolbar dropdown ArrowDown/ArrowUp keyboard navigation
// =============================================================================

test.describe('Toolbar — dropdown ArrowDown/ArrowUp', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('ArrowDown on dropdown trigger opens dropdown, second ArrowDown focuses first item', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible({ timeout: 2000 });

    // First ArrowDown opens the dropdown; second ArrowDown focuses the first item
    // (React's render cycle requires a separate key press to navigate into the panel)
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('role'));
    expect(focused).toBe('menuitem');
  });

  test('ArrowDown cycles through dropdown items', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const firstLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

    await page.keyboard.press('ArrowDown');
    const secondLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(secondLabel).not.toBe(firstLabel);
  });

  test('ArrowUp moves to previous dropdown item', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const thirdLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

    await page.keyboard.press('ArrowUp');
    const secondLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

    expect(secondLabel).not.toBe(thirdLabel);
  });

  test('ArrowUp wraps from first to last item', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // First item is focused, ArrowUp should wrap to last
    await page.keyboard.press('ArrowUp');

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    const items = panel.locator('[role="menuitem"]');
    const lastLabel = await items.last().getAttribute('aria-label');
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focusedLabel).toBe(lastLabel);
  });

  test('Escape closes dropdown and returns focus to trigger', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    await page.keyboard.press('Escape');

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).not.toBeVisible();

    const focusedRole = await page.evaluate(() =>
      document.activeElement?.closest('.dm-toolbar-button') ? 'toolbar-button' : 'other'
    );
    expect(focusedRole).toBe('toolbar-button');
  });

  test('dropdown menu items have role="menuitem"', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.click();
    await page.waitForTimeout(100);

    const items = page.locator('.dm-toolbar-dropdown-panel [role="menuitem"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });

  test('dropdown menu items have tabindex="-1"', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.click();
    await page.waitForTimeout(100);

    const items = page.locator('.dm-toolbar-dropdown-panel [role="menuitem"]');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      await expect(items.nth(i)).toHaveAttribute('tabindex', '-1');
    }
  });

  test('dropdown panel has role="menu"', async ({ page }) => {
    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.click();
    await page.waitForTimeout(100);

    await expect(page.locator('.dm-toolbar-dropdown-panel')).toHaveAttribute('role', 'menu');
  });

  test('ArrowDown on non-dropdown button does nothing', async ({ page }) => {
    const boldBtn = page.locator(`${toolbar} button[aria-label="Bold"]`);
    await boldBtn.focus();
    const labelBefore = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

    await page.keyboard.press('ArrowDown');

    const labelAfter = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(labelAfter).toBe(labelBefore);
  });
});

// =============================================================================
// Emoji picker ARIA & keyboard navigation
// =============================================================================

test.describe('Emoji picker — ARIA attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await page.locator(editorSelector).click();
    await page.locator(emojiBtn).click();
    await page.waitForSelector(pickerSelector);
  });

  test('search input has aria-label', async ({ page }) => {
    await expect(page.locator(searchInput)).toHaveAttribute('aria-label', 'Search emoji');
  });

  test('tab container has role="tablist"', async ({ page }) => {
    await expect(page.locator('.dm-emoji-picker-tabs')).toHaveAttribute('role', 'tablist');
  });

  test('category tabs have role="tab"', async ({ page }) => {
    const tabs = page.locator(tabSelector);
    const count = await tabs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(tabs.nth(i)).toHaveAttribute('role', 'tab');
    }
  });

  test('active category tab has aria-selected="true"', async ({ page }) => {
    const activeTabs = page.locator(`${tabSelector}.dm-emoji-picker-tab--active`);
    await expect(activeTabs).toHaveCount(1);
    await expect(activeTabs.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('inactive category tabs have aria-selected="false"', async ({ page }) => {
    const tabs = page.locator(tabSelector);
    const count = await tabs.count();
    let inactiveCount = 0;
    for (let i = 0; i < count; i++) {
      const isActive = await tabs.nth(i).evaluate((el) => el.classList.contains('dm-emoji-picker-tab--active'));
      if (!isActive) {
        await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'false');
        inactiveCount++;
      }
    }
    expect(inactiveCount).toBeGreaterThan(0);
  });

  test('clicking a tab updates aria-selected', async ({ page }) => {
    const tabs = page.locator(tabSelector);
    const secondTab = tabs.nth(1);
    await secondTab.click();
    await page.waitForTimeout(100);

    await expect(secondTab).toHaveAttribute('aria-selected', 'true');
  });

  test('emoji swatches have aria-label', async ({ page }) => {
    const swatches = page.locator(swatchSelector);
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(5, count); i++) {
      const label = await swatches.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });

  test('emoji swatches have tabindex="-1"', async ({ page }) => {
    const swatches = page.locator(swatchSelector);
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(5, count); i++) {
      await expect(swatches.nth(i)).toHaveAttribute('tabindex', '-1');
    }
  });

  test('category tabs have aria-label', async ({ page }) => {
    const tabs = page.locator(tabSelector);
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const label = await tabs.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
    }
  });
});

test.describe('Emoji picker — grid keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await page.locator(editorSelector).click();
    await page.locator(emojiBtn).click();
    await page.waitForSelector(pickerSelector);
  });

  test('ArrowRight moves focus to next emoji', async ({ page }) => {
    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.focus();
    const firstName = await firstSwatch.getAttribute('aria-label');

    await page.keyboard.press('ArrowRight');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focusedLabel).not.toBe(firstName);
    expect(focusedLabel).toBeTruthy();
  });

  test('ArrowLeft moves focus to previous emoji', async ({ page }) => {
    const secondSwatch = page.locator(swatchSelector).nth(1);
    await secondSwatch.focus();

    await page.keyboard.press('ArrowLeft');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstLabel = await page.locator(swatchSelector).first().getAttribute('aria-label');
    expect(focusedLabel).toBe(firstLabel);
  });

  test('ArrowDown moves focus down one row (8 columns)', async ({ page }) => {
    const swatches = page.locator(swatchSelector);
    await swatches.first().focus();

    await page.keyboard.press('ArrowDown');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const ninthLabel = await swatches.nth(8).getAttribute('aria-label');
    expect(focusedLabel).toBe(ninthLabel);
  });

  test('ArrowUp moves focus up one row', async ({ page }) => {
    const swatches = page.locator(swatchSelector);
    await swatches.nth(8).focus();

    await page.keyboard.press('ArrowUp');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstLabel = await swatches.first().getAttribute('aria-label');
    expect(focusedLabel).toBe(firstLabel);
  });

  test('ArrowLeft at first emoji stays at first', async ({ page }) => {
    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.focus();
    const firstName = await firstSwatch.getAttribute('aria-label');

    await page.keyboard.press('ArrowLeft');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focusedLabel).toBe(firstName);
  });

  test('Enter selects the focused emoji', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await setContent(page, '<p>Test</p>');
    await page.locator(editorSelector).click();
    await page.locator(emojiBtn).click();
    await page.waitForSelector(pickerSelector);

    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.focus();

    await page.keyboard.press('Enter');

    await expect(page.locator(pickerSelector)).not.toBeVisible();
    const html = await editor.innerHTML();
    expect(html).toContain('emoji');
  });

  test('Space selects the focused emoji', async ({ page }) => {
    await setContent(page, '<p>Test</p>');
    await page.locator(editorSelector).click();
    await page.locator(emojiBtn).click();
    await page.waitForSelector(pickerSelector);

    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.focus();

    await page.keyboard.press(' ');

    await expect(page.locator(pickerSelector)).not.toBeVisible();
  });

  test('search results also have tabindex="-1"', async ({ page }) => {
    await page.locator(searchInput).fill('smile');
    await page.waitForTimeout(200);

    const swatches = page.locator(swatchSelector);
    const count = await swatches.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(5, count); i++) {
      await expect(swatches.nth(i)).toHaveAttribute('tabindex', '-1');
    }
  });

  test('arrow keys work in search results grid', async ({ page }) => {
    await page.locator(searchInput).fill('heart');
    await page.waitForTimeout(200);

    const firstSwatch = page.locator(swatchSelector).first();
    await firstSwatch.focus();
    const firstName = await firstSwatch.getAttribute('aria-label');

    await page.keyboard.press('ArrowRight');

    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focusedLabel).not.toBe(firstName);
  });
});

// =============================================================================
// Task item checkbox ARIA
// =============================================================================

test.describe('Task item — checkbox ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('task checkbox has aria-label', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task 1</p></li></ul>');
    await page.waitForTimeout(100);

    const checkbox = page.locator(`${editorSelector} input[type="checkbox"]`);
    await expect(checkbox).toHaveAttribute('aria-label', 'Task status');
  });

  test('checked task checkbox has aria-label', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>');
    await page.waitForTimeout(100);

    const checkbox = page.locator(`${editorSelector} input[type="checkbox"]`);
    await expect(checkbox).toHaveAttribute('aria-label', 'Task status');
  });
});

// =============================================================================
// Link popover ARIA
// =============================================================================

test.describe('Link popover — ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('link popover input has aria-label', async ({ page }) => {
    await setContent(page, '<p><a href="https://example.com">link</a></p>');
    await page.locator(`${editorSelector} a`).click();
    await page.waitForTimeout(300);

    const input = page.locator('.dm-link-popover-input');
    await expect(input).toHaveAttribute('aria-label', 'URL');
  });

  test('link popover buttons have aria-label', async ({ page }) => {
    await setContent(page, '<p><a href="https://example.com">link</a></p>');
    await page.locator(`${editorSelector} a`).click();
    await page.waitForTimeout(300);

    await expect(page.locator('.dm-link-popover-apply')).toHaveAttribute('aria-label', 'Apply link');
    await expect(page.locator('.dm-link-popover-remove')).toHaveAttribute('aria-label', 'Remove link');
  });
});

// =============================================================================
// Editor aria-readonly
// =============================================================================

test.describe('Editor — aria-readonly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('aria-readonly="true" when editor is set to non-editable', async ({ page }) => {
    await page.evaluate(() => {
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.setEditable(false);
    });
    await page.waitForTimeout(100);

    await expect(page.locator(editorSelector)).toHaveAttribute('aria-readonly', 'true');
  });

  test('aria-readonly removed when editor is set back to editable', async ({ page }) => {
    await page.evaluate(() => {
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.setEditable(false);
    });
    await page.waitForTimeout(100);
    await expect(page.locator(editorSelector)).toHaveAttribute('aria-readonly', 'true');

    await page.evaluate(() => {
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.setEditable(true);
    });
    await page.waitForTimeout(100);

    const readonly = await page.locator(editorSelector).getAttribute('aria-readonly');
    expect(readonly).toBeNull();
  });
});

// =============================================================================
// Image popover ARIA
// =============================================================================

test.describe('Image popover — ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('image popover input has aria-label', async ({ page }) => {
    await setContent(page, '<p>text</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(`${toolbar} button[aria-label="Insert Image"]`).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await expect(page.locator('.dm-image-popover-input')).toHaveAttribute('aria-label', 'Image URL');
  });

  test('image popover buttons have aria-label', async ({ page }) => {
    await setContent(page, '<p>text</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(`${toolbar} button[aria-label="Insert Image"]`).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await expect(page.locator('.dm-image-popover-apply')).toHaveAttribute('aria-label', 'Insert image');
    await expect(page.locator('.dm-image-popover-browse')).toHaveAttribute('aria-label', 'Browse files');
  });
});

// =============================================================================
// Table cell toolbar ARIA
// =============================================================================

test.describe('Table cell toolbar — ARIA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContent(page, '<table><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table>');
  });

  test('cell toolbar has role="toolbar" when visible', async ({ page }) => {
    await page.evaluate(() => {
      const editor = (window as any).__DEMO_EDITOR__;
      if (editor) editor.commands.selectAll();
    });
    await page.waitForTimeout(300);

    const cellToolbar = page.locator('.dm-table-cell-toolbar');
    if (await cellToolbar.isVisible()) {
      await expect(cellToolbar).toHaveAttribute('role', 'toolbar');
      await expect(cellToolbar).toHaveAttribute('aria-label', 'Cell formatting');
    }
  });
});

// =============================================================================
// Emoji suggestion ARIA
// =============================================================================

test.describe('Emoji suggestion — ARIA', () => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const suggestionSelector = '.dm-emoji-suggestion';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('suggestion container has role="listbox"', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(':sm');

    const suggestion = page.locator(suggestionSelector);
    await expect(suggestion).toBeVisible({ timeout: 3000 });
    await expect(suggestion).toHaveAttribute('role', 'listbox');
  });

  test('suggestion container has aria-label', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(':sm');

    const suggestion = page.locator(suggestionSelector);
    await expect(suggestion).toBeVisible({ timeout: 3000 });
    await expect(suggestion).toHaveAttribute('aria-label', 'Emoji suggestions');
  });

  test('suggestion items have role="option"', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type(':sm');

    const suggestion = page.locator(suggestionSelector);
    await expect(suggestion).toBeVisible({ timeout: 3000 });
    const items = page.locator(`${suggestionSelector} [role="option"]`);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
  });
});

// =============================================================================
// Mention suggestion ARIA
// =============================================================================

test.describe('Mention suggestion — ARIA', () => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const suggestionSelector = '.dm-mention-suggestion';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('mention suggestion has role="listbox" and aria-label', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('@');

    const suggestion = page.locator(suggestionSelector);
    await expect(suggestion).toBeVisible({ timeout: 3000 });
    await expect(suggestion).toHaveAttribute('role', 'listbox');
    await expect(suggestion).toHaveAttribute('aria-label', 'Mention suggestions');
  });
});

// =============================================================================
// Focus-visible (keyboard vs mouse)
// =============================================================================

test.describe('Focus-visible — keyboard focus indicators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button shows outline on keyboard focus', async ({ page }) => {
    const btn = page.locator(toolbarButton).first();
    await btn.focus();

    const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('toolbar button does not show outline on mouse click', async ({ page }) => {
    const btn = page.locator(toolbarButton).first();
    await btn.click();

    const outline = await btn.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('none');
  });
});

// =============================================================================
// prefers-reduced-motion
// =============================================================================

test.describe('prefers-reduced-motion', () => {
  test('animations are disabled when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector(editorSelector);

    const trigger = page.locator(`${toolbar} button[aria-label="Highlight"]`);
    await trigger.click();
    await page.waitForTimeout(100);

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    const animation = await panel.evaluate((el) => getComputedStyle(el).animationDuration);
    // animation: none sets duration to 0s
    expect(animation).toBe('0s');
  });

  test('transitions are disabled when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector(editorSelector);

    const btn = page.locator(toolbarButton).first();
    const durations = await btn.evaluate((el) => {
      const d = getComputedStyle(el).transitionDuration;
      return d.split(',').map((v) => v.trim());
    });
    // All transition durations should be 0s
    for (const d of durations) {
      expect(d).toBe('0s');
    }
  });
});
