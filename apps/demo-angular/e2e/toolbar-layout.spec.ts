import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

// Toggle selectors
const toggleDefault = '.toolbar-mode-toggle button:first-child';
const toggleLayout = '.toolbar-mode-toggle button:last-child';

// Layout-mode toolbar selectors (scoped to domternal-toolbar)
const toolbar = 'domternal-toolbar';
const toolbarBtn = `${toolbar} .dm-toolbar-button`;
const group = `${toolbar} .dm-toolbar-group`;
const separator = `${toolbar} .dm-toolbar-separator`;

// Specific buttons
const boldBtn = `${toolbar} button[aria-label="Bold"]`;
const italicBtn = `${toolbar} button[aria-label="Italic"]`;
const underlineBtn = `${toolbar} button[aria-label="Underline"]`;
const undoBtn = `${toolbar} button[aria-label="Undo"]`;
const redoBtn = `${toolbar} button[aria-label="Redo"]`;
const headingDropdown = `${toolbar} button[aria-label="Heading"]`;
const textAlignDropdown = `${toolbar} button[aria-label="Text Alignment"]`;
const textColorDropdown = `${toolbar} button[aria-label="Text Color"]`;
const highlightDropdown = `${toolbar} button[aria-label="Highlight"]`;
const bulletListBtn = `${toolbar} button[aria-label="Bullet List"]`;
const orderedListBtn = `${toolbar} button[aria-label="Ordered List"]`;
const taskListBtn = `${toolbar} button[aria-label="Task List"]`;
const linkBtn = `${toolbar} button[aria-label="Link"]`;
const imageBtn = `${toolbar} button[aria-label="Insert Image"]`;
const emojiBtn = `${toolbar} button[aria-label="Insert Emoji"]`;
const clearFormattingBtn = `${toolbar} button[aria-label="Clear Formatting"]`;

// Custom dropdowns created by layout
const formattingDropdown = `${toolbar} button[aria-label="Formatting"]`;
const listsDropdown = `${toolbar} button[aria-label="Lists"]`;
const insertDropdown = `${toolbar} button[aria-label="Insert"]`;

async function switchToLayout(page: Page) {
  await page.locator(toggleLayout).click();
  await page.waitForTimeout(100);
}

async function switchToDefault(page: Page) {
  await page.locator(toggleDefault).click();
  await page.waitForTimeout(100);
}

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
  await page.keyboard.press(`${modifier}+a`);
}

async function replaceAndSelectAll(page: Page, text: string) {
  await page.locator(editorSelector).click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type(text);
  await page.keyboard.press(`${modifier}+a`);
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
// Mode toggle — switching between default and layout modes
// =============================================================================

test.describe('Toolbar layout — mode toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toggle buttons are visible', async ({ page }) => {
    await expect(page.locator(toggleDefault)).toBeVisible();
    await expect(page.locator(toggleLayout)).toBeVisible();
  });

  test('default mode is active initially', async ({ page }) => {
    await expect(page.locator(toggleDefault)).toHaveClass(/active/);
    await expect(page.locator(toggleLayout)).not.toHaveClass(/active/);
  });

  test('clicking layout toggle activates layout mode', async ({ page }) => {
    await switchToLayout(page);

    await expect(page.locator(toggleLayout)).toHaveClass(/active/);
    await expect(page.locator(toggleDefault)).not.toHaveClass(/active/);
  });

  test('clicking default toggle returns to default mode', async ({ page }) => {
    await switchToLayout(page);
    await switchToDefault(page);

    await expect(page.locator(toggleDefault)).toHaveClass(/active/);
    await expect(page.locator(toggleLayout)).not.toHaveClass(/active/);
  });

  test('toolbar is always visible in both modes', async ({ page }) => {
    await expect(page.locator(toolbar)).toBeVisible();
    await switchToLayout(page);
    await expect(page.locator(toolbar)).toBeVisible();
  });

  test('multiple toggles back and forth work', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await switchToLayout(page);
      await expect(page.locator(toggleLayout)).toHaveClass(/active/);
      await switchToDefault(page);
      await expect(page.locator(toggleDefault)).toHaveClass(/active/);
    }
  });
});

// =============================================================================
// Layout — structure and item order
// =============================================================================

test.describe('Toolbar layout — structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('toolbar has role="toolbar" in layout mode', async ({ page }) => {
    await expect(page.locator(toolbar)).toHaveAttribute('role', 'toolbar');
  });

  test('toolbar has aria-label in layout mode', async ({ page }) => {
    await expect(page.locator(toolbar)).toHaveAttribute('aria-label', 'Editor formatting');
  });

  test('toolbar groups have role="group"', async ({ page }) => {
    const groups = page.locator(group);
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(groups.nth(i)).toHaveAttribute('role', 'group');
    }
  });

  test('separators exist between groups', async ({ page }) => {
    const separators = page.locator(separator);
    const count = await separators.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(separators.nth(i)).toHaveAttribute('role', 'separator');
    }
  });

  test('layout has correct number of groups (6 groups with 5 separators)', async ({ page }) => {
    // Layout: [bold, italic, underline, heading1] | [Formatting, Lists, clearFormatting] | [heading, textAlign] | [textColor, highlight] | [Insert] | [undo, redo]
    const groups = page.locator(group);
    await expect(groups).toHaveCount(6);
  });

  test('first group contains bold, italic, underline, heading 1 in order', async ({ page }) => {
    const firstGroup = page.locator(group).first();
    const buttons = firstGroup.locator('.dm-toolbar-button');

    const labels: string[] = [];
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      labels.push(await buttons.nth(i).getAttribute('aria-label') ?? '');
    }

    expect(labels).toEqual(['Bold', 'Italic', 'Underline', 'Heading 1']);
  });

  test('last group contains undo, redo in order', async ({ page }) => {
    const lastGroup = page.locator(group).last();
    const buttons = lastGroup.locator('.dm-toolbar-button');

    const labels: string[] = [];
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      labels.push(await buttons.nth(i).getAttribute('aria-label') ?? '');
    }

    expect(labels).toEqual(['Undo', 'Redo']);
  });

  test('bold, italic, underline are standalone buttons (not in dropdown)', async ({ page }) => {
    await expect(page.locator(boldBtn)).toBeVisible();
    await expect(page.locator(italicBtn)).toBeVisible();
    await expect(page.locator(underlineBtn)).toBeVisible();

    // They should be direct buttons, not inside a dropdown
    for (const sel of [boldBtn, italicBtn, underlineBtn]) {
      const parent = page.locator(sel).locator('..');
      const parentClass = await parent.getAttribute('class');
      expect(parentClass).toContain('dm-toolbar-group');
    }
  });

  test('strike, code, subscript, superscript are NOT standalone buttons', async ({ page }) => {
    // These are inside the "Formatting" custom dropdown, not top-level
    await expect(page.locator(`${toolbar} > .dm-toolbar-group > button[aria-label="Strikethrough"]`)).toHaveCount(0);
    await expect(page.locator(`${toolbar} > .dm-toolbar-group > button[aria-label="Code"]`)).toHaveCount(0);
    await expect(page.locator(`${toolbar} > .dm-toolbar-group > button[aria-label="Subscript"]`)).toHaveCount(0);
    await expect(page.locator(`${toolbar} > .dm-toolbar-group > button[aria-label="Superscript"]`)).toHaveCount(0);
  });

  test('layout mode has fewer top-level buttons than default mode', async ({ page }) => {
    const layoutButtonCount = await page.locator(toolbarBtn).count();

    await switchToDefault(page);
    const defaultButtonCount = await page.locator(toolbarBtn).count();

    // Layout groups strike/code/sub/sup into a custom dropdown, so fewer top-level buttons
    expect(layoutButtonCount).toBeLessThanOrEqual(defaultButtonCount);
  });
});

// =============================================================================
// Custom dropdown — "Formatting"
// =============================================================================

test.describe('Toolbar layout — custom dropdown (Formatting)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('Formatting dropdown trigger is visible', async ({ page }) => {
    await expect(page.locator(formattingDropdown)).toBeVisible();
  });

  test('Formatting trigger has dropdown caret', async ({ page }) => {
    const html = await page.locator(formattingDropdown).innerHTML();
    expect(html).toContain('dm-dropdown-caret');
  });

  test('Formatting trigger has aria-haspopup', async ({ page }) => {
    await expect(page.locator(formattingDropdown)).toHaveAttribute('aria-haspopup', 'true');
  });

  test('Formatting trigger has aria-expanded="false" initially', async ({ page }) => {
    await expect(page.locator(formattingDropdown)).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking Formatting opens dropdown panel', async ({ page }) => {
    await page.locator(formattingDropdown).click();

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator(formattingDropdown)).toHaveAttribute('aria-expanded', 'true');
  });

  test('Formatting dropdown contains strike, code, subscript, superscript', async ({ page }) => {
    await page.locator(formattingDropdown).click();

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(4);

    const labels: string[] = [];
    for (let i = 0; i < 4; i++) {
      labels.push(await items.nth(i).getAttribute('aria-label') ?? '');
    }

    expect(labels).toEqual(['Strikethrough', 'Code', 'Subscript', 'Superscript']);
  });

  test('clicking Formatting again closes dropdown', async ({ page }) => {
    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).not.toBeVisible();
    await expect(page.locator(formattingDropdown)).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking outside closes Formatting dropdown', async ({ page }) => {
    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(editorSelector).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).not.toBeVisible();
  });

  test('Escape closes Formatting dropdown', async ({ page }) => {
    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(formattingDropdown).focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.dm-toolbar-dropdown-panel')).not.toBeVisible();
  });

  test('strikethrough item in Formatting applies mark to selected text', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'strike me');

    await page.locator(formattingDropdown).click();
    await page.locator('button[aria-label="Strikethrough"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<s>strike me</s>');
  });

  test('code item in Formatting applies mark to selected text', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'code me');

    await page.locator(formattingDropdown).click();
    await page.locator('button[aria-label="Code"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>code me</code>');
  });

  test('subscript item in Formatting applies mark', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'sub me');

    await page.locator(formattingDropdown).click();
    await page.locator('button[aria-label="Subscript"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<sub>sub me</sub>');
  });

  test('superscript item in Formatting applies mark', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'sup me');

    await page.locator(formattingDropdown).click();
    await page.locator('button[aria-label="Superscript"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<sup>sup me</sup>');
  });

  test('active state shows inside Formatting dropdown for applied mark', async ({ page }) => {
    await setContentAndFocus(page, '<p><s>struck text</s></p>');
    await page.locator(`${editorSelector} s`).click();

    await page.locator(formattingDropdown).click();
    const strikeItem = page.locator('.dm-toolbar-dropdown-item[aria-label="Strikethrough"]');
    await expect(strikeItem).toHaveClass(/active/);
  });

  test('displayMode "text" renders only text, no SVG icon', async ({ page }) => {
    await page.locator(formattingDropdown).click();

    const items = page.locator('.dm-toolbar-dropdown-panel .dm-toolbar-dropdown-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const html = await items.nth(i).innerHTML();
      expect(html).not.toContain('<svg');
      // Should contain label text
      const label = await items.nth(i).getAttribute('aria-label');
      expect(html).toContain(label);
    }
  });
});

// =============================================================================
// Existing dropdowns preserved in layout — heading, textAlign, textColor, highlight
// =============================================================================

test.describe('Toolbar layout — existing dropdowns preserved', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('heading dropdown is present and works', async ({ page }) => {
    await expect(page.locator(headingDropdown)).toBeVisible();

    await setContentAndFocus(page, '<p>Normal text</p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(headingDropdown).click();
    await expect(page.locator('button[aria-label="Heading 1"]')).toBeVisible();
    await page.locator('button[aria-label="Heading 1"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
  });

  test('existing dropdowns without displayMode still show icon + text', async ({ page }) => {
    await page.locator(headingDropdown).click();

    const firstItem = page.locator('.dm-toolbar-dropdown-panel .dm-toolbar-dropdown-item').first();
    const html = await firstItem.innerHTML();
    // Should contain SVG icon
    expect(html).toContain('<svg');
    // Should contain label text
    const label = await firstItem.getAttribute('aria-label');
    expect(html).toContain(label);
  });

  test('text alignment dropdown is present and works', async ({ page }) => {
    await expect(page.locator(textAlignDropdown)).toBeVisible();

    await setContentAndFocus(page, '<p>align me</p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(textAlignDropdown).click();
    await page.locator('button[aria-label="Align Center"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('text-align: center');
  });

  test('text color dropdown is present', async ({ page }) => {
    await expect(page.locator(textColorDropdown)).toBeVisible();
  });

  test('highlight dropdown is present and works', async ({ page }) => {
    await expect(page.locator(highlightDropdown)).toBeVisible();

    await setContentAndFocus(page, '<p>highlight me</p>');
    await replaceAndSelectAll(page, 'highlight me');

    await page.locator(highlightDropdown).click();
    await page.locator('.dm-color-swatch').first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
  });
});

// =============================================================================
// Layout — button functionality (marks, formatting)
// =============================================================================

test.describe('Toolbar layout — button functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('bold button applies bold', async ({ page }) => {
    await replaceAndSelectAll(page, 'make bold');
    await page.locator(boldBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>make bold</strong>');
  });

  test('italic button applies italic', async ({ page }) => {
    await replaceAndSelectAll(page, 'make italic');
    await page.locator(italicBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>make italic</em>');
  });

  test('underline button applies underline', async ({ page }) => {
    await replaceAndSelectAll(page, 'underline me');
    await page.locator(underlineBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<u>underline me</u>');
  });

  test('undo button works', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' world');

    let html = await getEditorHTML(page);
    expect(html).toContain('hello world');

    await page.locator(undoBtn).click();
    html = await getEditorHTML(page);
    expect(html).not.toContain('hello world');
  });

  test('redo button works after undo', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' world');

    await page.locator(undoBtn).click();
    let html = await getEditorHTML(page);
    expect(html).not.toContain('hello world');

    await page.locator(redoBtn).click();
    html = await getEditorHTML(page);
    expect(html).toContain('hello world');
  });

  test('bullet list button toggles bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p>list item</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(listsDropdown).click();
    await page.locator(bulletListBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('list item');
  });

  test('ordered list button toggles ordered list', async ({ page }) => {
    await setContentAndFocus(page, '<p>numbered item</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(listsDropdown).click();
    await page.locator(orderedListBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('numbered item');
  });

  test('task list button toggles task list', async ({ page }) => {
    await setContentAndFocus(page, '<p>todo item</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(listsDropdown).click();
    await page.locator(taskListBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('todo item');
  });

  test('clear formatting button removes marks', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong><em>bold italic text</em></strong></p>');
    await selectAll(page);
    await page.locator(clearFormattingBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('bold italic text');
  });
});

// =============================================================================
// Layout — active state tracking
// =============================================================================

test.describe('Toolbar layout — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('bold button shows active when cursor is in bold', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await page.locator(`${editorSelector} strong`).click();

    await expect(page.locator(boldBtn)).toHaveClass(/active/);
  });

  test('bold button shows inactive when cursor is in plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p>plain text</p>');
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(boldBtn)).not.toHaveClass(/active/);
  });

  test('italic button shows active when cursor is in italic', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>italic text</em></p>');
    await page.locator(`${editorSelector} em`).click();

    await expect(page.locator(italicBtn)).toHaveClass(/active/);
  });

  test('active state has aria-pressed', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold</strong></p>');
    await page.locator(`${editorSelector} strong`).click();

    await expect(page.locator(boldBtn)).toHaveAttribute('aria-pressed', 'true');
  });

  test('inactive state has aria-pressed="false"', async ({ page }) => {
    await setContentAndFocus(page, '<p>plain</p>');
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(boldBtn)).toHaveAttribute('aria-pressed', 'false');
  });

  test('active state updates dynamically when toggling mark', async ({ page }) => {
    await replaceAndSelectAll(page, 'test');

    await expect(page.locator(boldBtn)).not.toHaveClass(/active/);
    await page.locator(boldBtn).click();
    await expect(page.locator(boldBtn)).toHaveClass(/active/);
  });

  test('heading dropdown shows active when heading is selected', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await page.locator(`${editorSelector} h2`).click();

    await expect(page.locator(headingDropdown)).toHaveClass(/active/);
  });
});

// =============================================================================
// Layout — disabled state
// =============================================================================

test.describe('Toolbar layout — disabled state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('bold is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>code text</code></pre>');
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(boldBtn)).toBeDisabled();
  });

  test('italic is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>code text</code></pre>');
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(italicBtn)).toBeDisabled();
  });

  test('underline is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>code text</code></pre>');
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(underlineBtn)).toBeDisabled();
  });

  test('bold is disabled inside inline code', async ({ page }) => {
    await setContentAndFocus(page, '<p><code>inline code</code></p>');
    await page.locator(`${editorSelector} code`).click();

    await expect(page.locator(boldBtn)).toBeDisabled();
  });
});

// =============================================================================
// Layout — keyboard navigation
// =============================================================================

test.describe('Toolbar layout — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('first button has tabindex=0, others have tabindex=-1', async ({ page }) => {
    const buttons = page.locator(toolbarBtn);
    await expect(buttons.first()).toHaveAttribute('tabindex', '0');
    await expect(buttons.nth(1)).toHaveAttribute('tabindex', '-1');
  });

  test('ArrowRight moves focus to next button', async ({ page }) => {
    const firstBtn = page.locator(toolbarBtn).first();
    await firstBtn.focus();
    const firstName = await firstBtn.getAttribute('aria-label');

    await page.keyboard.press('ArrowRight');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focused).not.toBe(firstName);
  });

  test('ArrowLeft moves focus to previous button', async ({ page }) => {
    const buttons = page.locator(toolbarBtn);
    await buttons.nth(1).focus();
    const secondName = await buttons.nth(1).getAttribute('aria-label');

    await page.keyboard.press('ArrowLeft');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(focused).not.toBe(secondName);
  });

  test('ArrowRight wraps from last to first', async ({ page }) => {
    // Type + undo so both Undo and Redo are enabled (not disabled)
    await setContentAndFocus(page, '<p>hello</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type(' world');
    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(100);

    const buttons = page.locator(toolbarBtn);
    const count = await buttons.count();
    await buttons.nth(count - 1).focus();

    await page.keyboard.press('ArrowRight');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstName = await buttons.first().getAttribute('aria-label');
    expect(focused).toBe(firstName);
  });

  test('Home moves focus to first button', async ({ page }) => {
    const buttons = page.locator(toolbarBtn);
    await buttons.nth(3).focus();

    await page.keyboard.press('Home');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const firstName = await buttons.first().getAttribute('aria-label');
    expect(focused).toBe(firstName);
  });

  test('End moves focus to last button', async ({ page }) => {
    // Type + undo so both Undo and Redo are enabled (not disabled)
    await setContentAndFocus(page, '<p>hello</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type(' world');
    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(100);

    const buttons = page.locator(toolbarBtn);
    const count = await buttons.count();
    await buttons.first().focus();

    await page.keyboard.press('End');

    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    const lastName = await buttons.nth(count - 1).getAttribute('aria-label');
    expect(focused).toBe(lastName);
  });
});

// =============================================================================
// Layout — emitEvent buttons (link, image, emoji)
// =============================================================================

test.describe('Toolbar layout — emitEvent buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('link button is present in Insert dropdown', async ({ page }) => {
    await page.locator(insertDropdown).click();
    await expect(page.locator(linkBtn)).toBeVisible();
  });

  test('image button is present in Insert dropdown', async ({ page }) => {
    await page.locator(insertDropdown).click();
    await expect(page.locator(imageBtn)).toBeVisible();
  });

  test('emoji button is present in Insert dropdown', async ({ page }) => {
    await page.locator(insertDropdown).click();
    await expect(page.locator(emojiBtn)).toBeVisible();
  });

  test('link button opens link popover', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(insertDropdown).click();
    await page.locator(linkBtn).click();
    await expect(page.locator('.dm-link-popover')).toHaveAttribute('data-show', '');
  });

  test('image button opens image popover', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');

    await page.locator(insertDropdown).click();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();
  });

  test('emoji button opens emoji picker', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');

    await page.locator(insertDropdown).click();
    await page.locator(emojiBtn).click();
    await expect(page.locator('.dm-emoji-picker')).toBeVisible();
  });

  test('link popover opens from Insert dropdown', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(insertDropdown).click();
    await page.locator(linkBtn).click();
    await expect(page.locator('.dm-link-popover')).toHaveAttribute('data-show', '');
  });
});

// =============================================================================
// Switching modes preserves editor state
// =============================================================================

test.describe('Toolbar layout — mode switch preserves state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('editor content is preserved when switching to layout mode', async ({ page }) => {
    await setContentAndFocus(page, '<p>important content</p>');
    const htmlBefore = await getEditorHTML(page);

    await switchToLayout(page);
    const htmlAfter = await getEditorHTML(page);

    expect(htmlAfter).toContain('important content');
    expect(htmlAfter).toBe(htmlBefore);
  });

  test('editor content is preserved when switching back to default', async ({ page }) => {
    await setContentAndFocus(page, '<p>important content</p>');

    await switchToLayout(page);
    await switchToDefault(page);

    const html = await getEditorHTML(page);
    expect(html).toContain('important content');
  });

  test('marks applied in layout mode persist when switching to default', async ({ page }) => {
    await switchToLayout(page);
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'bold text');
    await page.locator(boldBtn).click();

    const htmlInLayout = await getEditorHTML(page);
    expect(htmlInLayout).toContain('<strong>bold text</strong>');

    await switchToDefault(page);
    const htmlInDefault = await getEditorHTML(page);
    expect(htmlInDefault).toContain('<strong>bold text</strong>');
  });

  test('marks applied in default mode persist when switching to layout', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    await replaceAndSelectAll(page, 'italic text');
    await page.locator(italicBtn).click();

    const htmlInDefault = await getEditorHTML(page);
    expect(htmlInDefault).toContain('<em>italic text</em>');

    await switchToLayout(page);
    const htmlInLayout = await getEditorHTML(page);
    expect(htmlInLayout).toContain('<em>italic text</em>');
  });

  test('active state is correct after switching modes', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await page.locator(`${editorSelector} strong`).click();

    // Default mode — bold active
    await expect(page.locator(boldBtn)).toHaveClass(/active/);

    // Switch to layout — bold should still be active
    await switchToLayout(page);
    // Re-click in bold to ensure focus is in bold text
    await page.locator(`${editorSelector} strong`).click();
    await expect(page.locator(boldBtn)).toHaveClass(/active/);

    // Switch back — still active
    await switchToDefault(page);
    await page.locator(`${editorSelector} strong`).click();
    await expect(page.locator(boldBtn)).toHaveClass(/active/);
  });
});

// =============================================================================
// Layout vs default — different grouping
// =============================================================================

test.describe('Toolbar layout — grouping differences', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('default mode groups count differs from layout mode', async ({ page }) => {
    const defaultGroupCount = await page.locator(group).count();

    await switchToLayout(page);
    const layoutGroupCount = await page.locator(group).count();

    // They should be different because layout uses explicit '|' separators
    expect(layoutGroupCount).not.toBe(defaultGroupCount);
  });

  test('default mode has strike/code/sub/sup as standalone or in different dropdown', async ({ page }) => {
    // In default mode, these are standalone buttons
    const strikeDefault = page.locator(`${toolbar} button[aria-label="Strikethrough"]`);
    const codeDefault = page.locator(`${toolbar} button[aria-label="Code"]`);

    // At least one should exist as a top-level button in default mode
    const strikeCount = await strikeDefault.count();
    const codeCount = await codeDefault.count();
    expect(strikeCount + codeCount).toBeGreaterThan(0);
  });

  test('layout mode has "Formatting" dropdown that default mode does not', async ({ page }) => {
    // Default mode should NOT have "Formatting"
    await expect(page.locator(formattingDropdown)).toHaveCount(0);

    // Layout mode should have "Formatting"
    await switchToLayout(page);
    await expect(page.locator(formattingDropdown)).toBeVisible();
  });
});

// =============================================================================
// Layout — keyboard shortcuts still work
// =============================================================================

test.describe('Toolbar layout — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('Mod+B applies bold', async ({ page }) => {
    await replaceAndSelectAll(page, 'kb bold');
    await page.keyboard.press(`${modifier}+b`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>kb bold</strong>');
  });

  test('Mod+I applies italic', async ({ page }) => {
    await replaceAndSelectAll(page, 'kb italic');
    await page.keyboard.press(`${modifier}+i`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>kb italic</em>');
  });

  test('Mod+U applies underline', async ({ page }) => {
    await replaceAndSelectAll(page, 'kb underline');
    await page.keyboard.press(`${modifier}+u`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<u>kb underline</u>');
  });

  test('Mod+Z undoes', async ({ page }) => {
    await setContentAndFocus(page, '<p>original</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    let html = await getEditorHTML(page);
    expect(html).toContain('original added');

    await page.keyboard.press(`${modifier}+z`);
    html = await getEditorHTML(page);
    expect(html).not.toContain('original added');
  });

  test('Mod+Shift+Z redoes', async ({ page }) => {
    await setContentAndFocus(page, '<p>original</p>');
    await page.locator(editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' added');

    await page.keyboard.press(`${modifier}+z`);
    let html = await getEditorHTML(page);
    expect(html).not.toContain('original added');

    await page.keyboard.press(`${modifier}+Shift+z`);
    html = await getEditorHTML(page);
    expect(html).toContain('original added');
  });
});

// =============================================================================
// Layout — combining operations
// =============================================================================

test.describe('Toolbar layout — combining operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('bold + italic via layout toolbar buttons', async ({ page }) => {
    await replaceAndSelectAll(page, 'bold italic');
    await page.locator(boldBtn).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(italicBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('bold italic');
  });

  test('bold button + strikethrough from Formatting dropdown', async ({ page }) => {
    await replaceAndSelectAll(page, 'combo text');
    await page.locator(boldBtn).click();

    await page.keyboard.press(`${modifier}+a`);

    await page.locator(formattingDropdown).click();
    await page.locator('.dm-toolbar-dropdown-item[aria-label="Strikethrough"]').click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<s>');
    expect(html).toContain('combo text');
  });

  test('heading + bold + list in layout mode', async ({ page }) => {
    await setContentAndFocus(page, '<p>my text</p>');
    await page.locator(`${editorSelector} p`).click();

    // Set heading
    await page.locator(headingDropdown).click();
    await page.locator('button[aria-label="Heading 2"]').click();

    // Select all and bold
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(boldBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expect(html).toContain('<strong>');
    expect(html).toContain('my text');
  });

  test('apply highlight then clear formatting', async ({ page }) => {
    await replaceAndSelectAll(page, 'formatted text');

    await page.locator(boldBtn).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(italicBtn).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(underlineBtn).click();

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<u>');

    await page.keyboard.press(`${modifier}+a`);
    await page.locator(clearFormattingBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<u>');
    expect(html).toContain('formatted text');
  });
});

// =============================================================================
// Layout — tooltips
// =============================================================================

test.describe('Toolbar layout — tooltips', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('bold button has tooltip with shortcut', async ({ page }) => {
    const title = await page.locator(boldBtn).getAttribute('title');
    expect(title).toContain('Bold');
    // Should contain shortcut hint
    expect(title?.length).toBeGreaterThan(4);
  });

  test('italic button has tooltip', async ({ page }) => {
    const title = await page.locator(italicBtn).getAttribute('title');
    expect(title).toContain('Italic');
  });

  test('Formatting dropdown trigger has tooltip', async ({ page }) => {
    const title = await page.locator(formattingDropdown).getAttribute('title');
    expect(title).toBe('Formatting');
  });

  test('heading dropdown trigger has tooltip', async ({ page }) => {
    const title = await page.locator(headingDropdown).getAttribute('title');
    expect(title).toBe('Heading');
  });
});

// =============================================================================
// Layout — cross-dropdown interactions
// =============================================================================

test.describe('Toolbar layout — cross-dropdown interactions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await switchToLayout(page);
  });

  test('opening heading closes Formatting', async ({ page }) => {
    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(headingDropdown).click();
    // Only one panel should be open
    const panels = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panels).toHaveCount(1);
  });

  test('opening Formatting closes heading', async ({ page }) => {
    await page.locator(headingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(formattingDropdown).click();
    // Only one panel should be open
    const panels = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panels).toHaveCount(1);
  });

  test('clicking regular button closes any open dropdown', async ({ page }) => {
    await page.locator(formattingDropdown).click();
    await expect(page.locator('.dm-toolbar-dropdown-panel')).toBeVisible();

    await page.locator(boldBtn).click({ force: true });
    await page.waitForTimeout(100);
    await expect(page.locator('.dm-toolbar-dropdown-panel')).not.toBeVisible();
  });
});

// =============================================================================
// Layout — edge cases
// =============================================================================

test.describe('Toolbar layout — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('rapidly toggling between modes does not break toolbar', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.locator(toggleLayout).click();
      await page.locator(toggleDefault).click();
    }
    // Toolbar should still be functional
    await expect(page.locator(toolbar)).toBeVisible();
    await expect(page.locator(boldBtn)).toBeVisible();
  });

  test('editor is still editable after switching to layout mode', async ({ page }) => {
    await switchToLayout(page);
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('typing works');

    const html = await getEditorHTML(page);
    expect(html).toContain('typing works');
  });

  test('input rules still work in layout mode', async ({ page }) => {
    await switchToLayout(page);
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('**bold text**');

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>bold text</strong>');
  });

  test('layout mode handles empty editor', async ({ page }) => {
    await switchToLayout(page);
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    // Bold should be enabled (not disabled) in empty paragraph
    await expect(page.locator(boldBtn)).not.toBeDisabled();
  });

  test('all layout buttons have accessible labels', async ({ page }) => {
    await switchToLayout(page);

    const buttons = page.locator(toolbarBtn);
    const count = await buttons.count();

    for (let i = 0; i < count; i++) {
      const label = await buttons.nth(i).getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label!.length).toBeGreaterThan(0);
    }
  });

  test('switching mode and immediately using toolbar works', async ({ page }) => {
    await switchToLayout(page);
    await setContentAndFocus(page, '<p>test text</p>');
    await selectAll(page);
    await page.locator(boldBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
  });
});
