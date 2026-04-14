/**
 * React-specific E2E tests for useEditorState reactive sync,
 * dark theme toggle, and toolbar layout switch (React re-render).
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const htmlOutput = 'pre.output';
const styledOutput = 'pre.output-styled';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

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

// =============================================================================
// useEditorState — HTML output reactive sync
// =============================================================================

test.describe('useEditorState — reactive HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('HTML output updates after typing', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p>');
    await page.keyboard.press('End');
    await page.keyboard.type(' World');

    await expect(page.locator(htmlOutput)).toContainText('Hello World');
  });

  test('HTML output updates after applying bold via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p>Make bold</p>');
    await selectText(page, 0, 9);

    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<strong>Make bold</strong>');
  });

  test('HTML output updates after applying italic via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p>Make italic</p>');
    await selectText(page, 0, 11);

    await page.locator('.dm-toolbar button[aria-label="Italic"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<em>Make italic</em>');
  });

  test('HTML output updates after applying bold via keyboard shortcut', async ({ page }) => {
    await setContentAndFocus(page, '<p>Shortcut bold</p>');
    await selectText(page, 0, 13);

    await page.keyboard.press(`${modifier}+b`);

    await expect(page.locator(htmlOutput)).toContainText('<strong>Shortcut bold</strong>');
  });

  test('HTML output updates after undo', async ({ page }) => {
    await setContentAndFocus(page, '<p>Original</p>');
    await selectText(page, 0, 8);
    await page.keyboard.press(`${modifier}+b`);

    await expect(page.locator(htmlOutput)).toContainText('<strong>Original</strong>');

    await page.keyboard.press(`${modifier}+z`);

    await expect(page.locator(htmlOutput)).not.toContainText('<strong>');
    await expect(page.locator(htmlOutput)).toContainText('Original');
  });

  test('HTML output updates after redo', async ({ page }) => {
    await setContentAndFocus(page, '<p>Redo test</p>');
    await selectText(page, 0, 9);
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press(`${modifier}+z`);

    await expect(page.locator(htmlOutput)).not.toContainText('<strong>');

    await page.keyboard.press(`${modifier}+Shift+z`);

    await expect(page.locator(htmlOutput)).toContainText('<strong>Redo test</strong>');
  });

  test('HTML output is empty paragraph after deleting all content', async ({ page }) => {
    await setContentAndFocus(page, '<p>Delete me</p>');
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');

    const output = await page.locator(htmlOutput).textContent();
    // After deleting everything, ProseMirror leaves an empty paragraph
    expect(output?.trim()).toBe('<p></p>');
  });

  test('HTML output updates after setContent via editor API', async ({ page }) => {
    await page.evaluate(() => {
      const editor = (window as any).__DEMO_EDITOR__;
      if (editor) editor.setContent('<p>API content</p>', false);
    });
    await page.waitForTimeout(200);

    await expect(page.locator(htmlOutput)).toContainText('API content');
  });

  test('styled HTML output updates in sync with regular output', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>Quote text</p></blockquote>');
    await page.waitForTimeout(200);

    const regularText = await page.locator(htmlOutput).textContent();
    const styledText = await page.locator(styledOutput).textContent();

    // Both should contain the content
    expect(regularText).toContain('Quote text');
    expect(styledText).toContain('Quote text');

    // Styled should have inline styles, regular should not
    expect(styledText).toContain('border-left');
    expect(regularText).not.toContain('border-left');
  });

  test('HTML output updates after multiple rapid changes', async ({ page }) => {
    await setContentAndFocus(page, '<p>Rapid</p>');
    await page.keyboard.press('End');
    await page.keyboard.type(' one');
    await page.keyboard.type(' two');
    await page.keyboard.type(' three');

    await expect(page.locator(htmlOutput)).toContainText('Rapid one two three');
  });

  test('HTML output updates after inserting heading via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p>Heading text</p>');
    await page.locator(`${editorSelector} p`).click();

    // Open heading dropdown and select H1
    await page.locator('.dm-toolbar button[aria-label="Heading"]').click();
    await page.locator('.dm-toolbar-dropdown-item[aria-label="Heading 1"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<h1>Heading text</h1>');
  });
});

// =============================================================================
// Dark theme toggle
// =============================================================================

test.describe('Dark theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('body does not have dm-theme-dark initially', async ({ page }) => {
    const hasDark = await page.evaluate(() => document.body.classList.contains('dm-theme-dark'));
    expect(hasDark).toBe(false);
  });

  test('clicking theme toggle adds dm-theme-dark to body', async ({ page }) => {
    await page.locator('.theme-toggle').click();

    const hasDark = await page.evaluate(() => document.body.classList.contains('dm-theme-dark'));
    expect(hasDark).toBe(true);
  });

  test('clicking theme toggle again removes dm-theme-dark', async ({ page }) => {
    await page.locator('.theme-toggle').click();
    await page.locator('.theme-toggle').click();

    const hasDark = await page.evaluate(() => document.body.classList.contains('dm-theme-dark'));
    expect(hasDark).toBe(false);
  });

  test('editor remains functional after switching to dark theme', async ({ page }) => {
    await page.locator('.theme-toggle').click();

    await setContentAndFocus(page, '<p>Dark mode typing</p>');
    await page.keyboard.press('End');
    await page.keyboard.type(' works');

    await expect(page.locator(editorSelector)).toContainText('Dark mode typing works');
    await expect(page.locator(htmlOutput)).toContainText('Dark mode typing works');
  });

  test('toolbar buttons work after switching to dark theme', async ({ page }) => {
    await page.locator('.theme-toggle').click();

    await setContentAndFocus(page, '<p>Dark bold</p>');
    await selectText(page, 0, 9);
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<strong>Dark bold</strong>');
  });

  test('bubble menu appears after switching to dark theme', async ({ page }) => {
    await page.locator('.theme-toggle').click();

    await setContentAndFocus(page, '<p>Select in dark</p>');
    await selectText(page, 0, 14);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  });

  test('theme toggle button text changes between moon and sun', async ({ page }) => {
    const btn = page.locator('.theme-toggle');

    // Initially shows moon (light mode)
    const initialText = await btn.textContent();
    expect(initialText?.trim()).toBeTruthy();

    await btn.click();

    // After click should show different icon
    const afterText = await btn.textContent();
    expect(afterText?.trim()).toBeTruthy();
    expect(afterText).not.toBe(initialText);
  });
});

// =============================================================================
// Toolbar layout switch (React state re-render)
// =============================================================================

test.describe('Toolbar layout switch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('default toolbar is active initially', async ({ page }) => {
    const defaultBtn = page.locator('.toolbar-mode-toggle button', { hasText: 'Default toolbar' });
    await expect(defaultBtn).toHaveClass(/active/);
  });

  test('switching to custom layout changes toolbar buttons', async ({ page }) => {
    // Count buttons in default mode
    const defaultButtonCount = await page.locator('.dm-toolbar .dm-toolbar-button').count();

    // Switch to custom layout
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    // Count buttons in custom layout mode
    const customButtonCount = await page.locator('.dm-toolbar .dm-toolbar-button').count();

    // Custom layout should have different button count (it groups items into dropdowns)
    expect(customButtonCount).not.toBe(defaultButtonCount);
  });

  test('custom layout has heading1 as direct button', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    // Custom layout has 'heading1' as direct button (not in dropdown)
    const h1Btn = page.locator('.dm-toolbar button[aria-label="Heading 1"]');
    await expect(h1Btn).toBeVisible();
  });

  test('custom layout has Formatting dropdown', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    const formattingDropdown = page.locator('.dm-toolbar button[aria-label="Formatting"]');
    await expect(formattingDropdown).toBeVisible();
  });

  test('custom layout Formatting dropdown contains strike, code, sub, super', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    await page.locator('.dm-toolbar button[aria-label="Formatting"]').click();

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await expect(panel.locator('[aria-label="Strikethrough"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Code"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Subscript"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Superscript"]')).toBeVisible();
  });

  test('editor content is preserved after switching to custom layout', async ({ page }) => {
    await setContentAndFocus(page, '<p>Preserved content</p>');

    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator(editorSelector)).toContainText('Preserved content');
    await expect(page.locator(htmlOutput)).toContainText('Preserved content');
  });

  test('editor content is preserved after switching back to default', async ({ page }) => {
    await setContentAndFocus(page, '<p>Still here</p>');

    // Switch to custom
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    // Switch back to default
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Default toolbar' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator(editorSelector)).toContainText('Still here');
  });

  test('toolbar buttons work after switching to custom layout', async ({ page }) => {
    await setContentAndFocus(page, '<p>Custom bold</p>');

    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    await selectText(page, 0, 11);
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<strong>Custom bold</strong>');
  });

  test('toolbar buttons work after switching back to default layout', async ({ page }) => {
    await setContentAndFocus(page, '<p>Back to default</p>');

    // Switch to custom and back
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Default toolbar' }).click();
    await page.waitForTimeout(300);

    await selectText(page, 0, 15);
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<strong>Back to default</strong>');
  });

  test('custom layout Insert dropdown contains link, image, emoji', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    await page.locator('.dm-toolbar button[aria-label="Insert"]').click();

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await expect(panel.locator('[aria-label="Link"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Insert Image"]')).toBeVisible();
    await expect(panel.locator('[aria-label="Insert Emoji"]')).toBeVisible();
  });

  test('custom layout Lists dropdown has dynamic icon', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    const listsBtn = page.locator('.dm-toolbar button[aria-label="Lists"]');
    await expect(listsBtn).toBeVisible();

    // Should have SVG icon and dropdown caret
    await expect(listsBtn.locator('svg')).toHaveCount(2); // icon + caret
  });

  test('undo/redo buttons visible in custom layout', async ({ page }) => {
    await page.locator('.toolbar-mode-toggle button', { hasText: 'Custom layout' }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('.dm-toolbar button[aria-label="Undo"]')).toBeVisible();
    await expect(page.locator('.dm-toolbar button[aria-label="Redo"]')).toBeVisible();
  });
});

// =============================================================================
// Bubble menu context-aware filtering
// =============================================================================

test.describe('Bubble menu — context-aware filtering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bubble menu shows for text selection in paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p>Plain text here</p>');
    await selectText(page, 0, 10);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
    await expect(page.locator('.dm-bubble-menu button')).not.toHaveCount(0);
  });

  test('bubble menu shows same buttons for text in heading', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Heading text here</h1>');
    // Select inside the heading text
    await page.evaluate((sel) => {
      const h1 = document.querySelector(sel + ' h1');
      if (!h1?.firstChild) return;
      const range = document.createRange();
      range.setStart(h1.firstChild, 0);
      range.setEnd(h1.firstChild, 7);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    }, editorSelector);
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
    // Should have the same buttons as paragraph context (text context)
    await expect(page.locator('.dm-bubble-menu button[title="Bold"]')).toBeAttached();
    await expect(page.locator('.dm-bubble-menu button[title="Italic"]')).toBeAttached();
  });

  test('bubble menu hidden for selection inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre>');
    await page.evaluate((sel) => {
      const code = document.querySelector(sel + ' pre code');
      if (!code?.firstChild) return;
      const range = document.createRange();
      range.setStart(code.firstChild, 0);
      range.setEnd(code.firstChild, 5);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    }, editorSelector);
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).not.toHaveAttribute('data-show');
  });

  test('bubble menu hidden when no text is selected (cursor only)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Just a cursor</p>');
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator('.dm-bubble-menu')).not.toHaveAttribute('data-show');
  });

  test('bubble menu hidden for node selection (e.g. horizontal rule)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p><hr><p>After</p>');
    // Click on the HR to create a node selection
    await page.locator(`${editorSelector} hr`).click();
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).not.toHaveAttribute('data-show');
  });

  test('bubble menu shows for text selection in blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>Quoted text here</p></blockquote>');
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' blockquote p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 6);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    }, editorSelector);
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  });

  test('bubble menu shows for text selection in list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>List item text</p></li></ul>');
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' li p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 9);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    }, editorSelector);
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  });

  test('bubble menu bold works inside heading', async ({ page }) => {
    await setContentAndFocus(page, '<h2>Heading text</h2>');
    await page.evaluate((sel) => {
      const h2 = document.querySelector(sel + ' h2');
      if (!h2?.firstChild) return;
      const range = document.createRange();
      range.setStart(h2.firstChild, 0);
      range.setEnd(h2.firstChild, 7);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    }, editorSelector);
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
    await page.locator('.dm-bubble-menu button[title="Bold"]').click();

    await expect(page.locator(htmlOutput)).toContainText('<strong>Heading</strong>');
  });

  test('bubble menu disappears when selection collapses', async ({ page }) => {
    await setContentAndFocus(page, '<p>Select then click</p>');
    await selectText(page, 0, 6);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');

    // Click to collapse selection
    await page.locator(`${editorSelector} p`).click();
    await page.waitForTimeout(150);

    await expect(page.locator('.dm-bubble-menu')).not.toHaveAttribute('data-show');
  });

  test('bubble menu has exactly 6 buttons and 1 separator in text context', async ({ page }) => {
    // Demo uses: ['bold', 'italic', 'underline', 'strike', 'code', '|', 'link']
    await setContentAndFocus(page, '<p>Count buttons</p>');
    await selectText(page, 0, 13);

    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
    await expect(page.locator('.dm-bubble-menu button')).toHaveCount(6);
    await expect(page.locator('.dm-bubble-menu [role="separator"]')).toHaveCount(1);
  });
});
