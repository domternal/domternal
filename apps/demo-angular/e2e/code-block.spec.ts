import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';

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

/** Place cursor at the very end of the code block text using native DOM selection. */
async function focusCodeBlockEnd(page: Page) {
  await page.evaluate((sel) => {
    const code = document.querySelector(sel + ' pre code');
    if (!code) return;
    // Walk to last text node (code may contain highlight <span>s)
    let node: Node = code;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, editorSelector);
}

/** Get text content (no HTML tags) of the editor. */
async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const CODE_THEN_PARA = '<pre><code>const x = 1;</code></pre><p>after</p>';
const CODE_ONLY = '<pre><code>const x = 1;</code></pre>';
const PARA_THEN_CODE = '<p>before</p><pre><code>const x = 1;</code></pre>';
const EMPTY_CODE = '<pre><code></code></pre>';
const MULTILINE_CODE = '<pre><code>line 1\nline 2\nline 3</code></pre>';

// ─── Tests ─────────────────────────────────────────────────────────────

test.describe('Code block — keyboard behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // ── Triple Enter ────────────────────────────────────────────────────

  test('triple Enter at end of code block exits and creates paragraph below', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_THEN_PARA);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');
    expect(text).toContain('after');

    // New paragraph should be created
    const html = await getEditorHTML(page);
    expect(html).toContain('<pre>');
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBeGreaterThanOrEqual(2);
  });

  test('triple Enter in middle of code block does NOT exit', async ({
    page,
  }) => {
    await setContentAndFocus(page, MULTILINE_CODE);
    // Click into code block then go to end of first line
    await page.locator(`${editorSelector} pre`).click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('ArrowLeft');  // go to start
    await page.keyboard.press('End');        // end of first line

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const text = await getEditorText(page);
    expect(text).toContain('line 1');
    expect(text).toContain('line 2');
    expect(text).toContain('line 3');

    // No paragraph should have been created — still all in code block
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBe(0);
  });

  test('triple Enter on code block as last node exits without error', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_ONLY);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');

    const html = await getEditorHTML(page);
    expect(html).toContain('<pre>');
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBeGreaterThanOrEqual(1);
  });

  test('triple Enter on empty code block exits', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_CODE);
    await page.locator(`${editorSelector} pre`).click();

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBeGreaterThanOrEqual(1);
  });

  // ── ArrowDown ───────────────────────────────────────────────────────

  test('ArrowDown at end of last code block creates paragraph below', async ({
    page,
  }) => {
    await setContentAndFocus(page, PARA_THEN_CODE);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('ArrowDown');

    const text = await getEditorText(page);
    expect(text).toContain('before');
    expect(text).toContain('const x = 1;');

    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBeGreaterThanOrEqual(2);
  });

  test('ArrowDown at end of code block with content below does NOT create paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_THEN_PARA);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('ArrowDown');

    // Should just move cursor down, not create new paragraph
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBe(1);
  });

  test('ArrowDown in middle of multiline code block does NOT exit', async ({
    page,
  }) => {
    await setContentAndFocus(page, MULTILINE_CODE);
    await page.locator(`${editorSelector} pre`).click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('End');

    await page.keyboard.press('ArrowDown');

    const text = await getEditorText(page);
    expect(text).toContain('line 1');
    expect(text).toContain('line 2');
    expect(text).toContain('line 3');
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBe(0);
  });

  test('ArrowDown on code block as only node creates paragraph without error', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_ONLY);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('ArrowDown');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');
    const paragraphs = await page.locator(`${editorSelector} p`).count();
    expect(paragraphs).toBeGreaterThanOrEqual(1);
  });

  // ── Normal typing preserved ─────────────────────────────────────────

  test('single Enter in code block creates newline, not exit', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_THEN_PARA);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.type('const y = 2;');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');
    expect(text).toContain('const y = 2;');
    const html = await getEditorHTML(page);
    expect(html).toContain('<pre>');
  });

  test('two Enters in code block create newlines, not exit', async ({
    page,
  }) => {
    await setContentAndFocus(page, CODE_THEN_PARA);
    await focusCodeBlockEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('still in code');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');
    expect(text).toContain('still in code');
    const html = await getEditorHTML(page);
    expect(html).toContain('<pre>');
  });
});

// ─── Toolbar disabled state in code block ─────────────────────────────

test.describe('Code block — toolbar disabled state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre><p>normal text</p>');
    await focusCodeBlockEnd(page);
    await page.waitForTimeout(200);
  });

  // Helper to get dropdown trigger button by aria-label
  const dropdownTrigger = (page: Page, label: string) =>
    page.locator(`button.dm-toolbar-dropdown-trigger[aria-label="${label}"]`);

  // Helper to get regular toolbar button by aria-label
  const toolbarButton = (page: Page, label: string) =>
    page.locator(`button.dm-toolbar-button[aria-label="${label}"]`);

  test('fontFamily dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Font Family')).toBeDisabled();
  });

  test('fontSize dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Font Size')).toBeDisabled();
  });

  test('textColor dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Text Color')).toBeDisabled();
  });

  test('highlight dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Highlight')).toBeDisabled();
  });

  test('textAlign dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Text Alignment')).toBeDisabled();
  });

  test('lineHeight dropdown is disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Line Height')).toBeDisabled();
  });

  test('heading dropdown is NOT disabled in code block', async ({ page }) => {
    await expect(dropdownTrigger(page, 'Heading')).toBeEnabled();
  });

  test('bold and italic buttons are disabled in code block', async ({ page }) => {
    await expect(toolbarButton(page, 'Bold')).toBeDisabled();
    await expect(toolbarButton(page, 'Italic')).toBeDisabled();
  });

  test('link button is disabled in code block', async ({ page }) => {
    await expect(toolbarButton(page, 'Link')).toBeDisabled();
  });

  test('insert emoji button is disabled in code block', async ({ page }) => {
    await expect(toolbarButton(page, 'Insert Emoji')).toBeDisabled();
  });

  test('insert image button is disabled in code block', async ({ page }) => {
    await expect(toolbarButton(page, 'Insert Image')).toBeDisabled();
  });

  test('insert table button is disabled in code block', async ({ page }) => {
    await expect(toolbarButton(page, 'Insert Table')).toBeDisabled();
  });

  test('dropdowns re-enable when cursor moves to normal paragraph', async ({ page }) => {
    // Verify disabled in code block
    await expect(dropdownTrigger(page, 'Font Family')).toBeDisabled();
    await expect(dropdownTrigger(page, 'Font Size')).toBeDisabled();

    // Click into normal paragraph
    await page.locator(`${editorSelector} p`).click();
    await page.waitForTimeout(200);

    // Should be enabled now
    await expect(dropdownTrigger(page, 'Font Family')).toBeEnabled();
    await expect(dropdownTrigger(page, 'Font Size')).toBeEnabled();
    await expect(dropdownTrigger(page, 'Text Color')).toBeEnabled();
    await expect(dropdownTrigger(page, 'Highlight')).toBeEnabled();
    await expect(dropdownTrigger(page, 'Text Alignment')).toBeEnabled();
    await expect(dropdownTrigger(page, 'Line Height')).toBeEnabled();
  });

  test('insert buttons re-enable when cursor moves to normal paragraph', async ({ page }) => {
    // Verify disabled in code block
    await expect(toolbarButton(page, 'Insert Emoji')).toBeDisabled();
    await expect(toolbarButton(page, 'Insert Image')).toBeDisabled();
    await expect(toolbarButton(page, 'Insert Table')).toBeDisabled();

    // Click into normal paragraph
    await page.locator(`${editorSelector} p`).click();
    await page.waitForTimeout(200);

    // Should be enabled now
    await expect(toolbarButton(page, 'Insert Emoji')).toBeEnabled();
    await expect(toolbarButton(page, 'Insert Image')).toBeEnabled();
    await expect(toolbarButton(page, 'Insert Table')).toBeEnabled();
  });
});
