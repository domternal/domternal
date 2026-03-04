import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const clearBtn = 'domternal-toolbar button[aria-label="Clear Formatting"]';

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Clear editor and type fresh content */
async function clearAndType(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text);
}

/** Select all text in the editor */
async function selectAll(page: Page) {
  await page.keyboard.press(`${modifier}+a`);
}

/** Place a collapsed cursor at offset within the first matching element */
async function placeCursor(page: Page, selector: string, offset: number) {
  await page.evaluate(
    ({ edSel, childSel, off }) => {
      const pm = document.querySelector(edSel);
      if (!pm) return;
      const el = pm.querySelector(childSel);
      const textNode = el?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, off);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      if (pm instanceof HTMLElement) pm.focus();
    },
    { edSel: editorSelector, childSel: selector, off: offset },
  );
  await page.waitForTimeout(100);
}

// ─── Toolbar Button ─────────────────────────────────────────────────────

test.describe('Clear Formatting — toolbar button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('button is visible in toolbar with textT icon', async ({ page }) => {
    const btn = page.locator(clearBtn);
    await expect(btn).toBeVisible();
    // Should have an SVG icon
    await expect(btn.locator('svg')).toBeAttached();
  });

  test('button is disabled when no text is selected (collapsed cursor)', async ({ page }) => {
    await clearAndType(page, 'Hello');
    // Cursor is at end after typing — collapsed selection
    const btn = page.locator(clearBtn);
    await expect(btn).toBeDisabled();
  });

  test('button is enabled when text is selected', async ({ page }) => {
    await clearAndType(page, 'Hello');
    await selectAll(page);
    const btn = page.locator(clearBtn);
    await expect(btn).toBeEnabled();
  });

  test('button is disabled on empty document', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);
    const btn = page.locator(clearBtn);
    await expect(btn).toBeDisabled();
  });
});

// ─── Individual Marks ───────────────────────────────────────────────────

test.describe('Clear Formatting — removes individual marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('removes bold', async ({ page }) => {
    await clearAndType(page, 'Bold text');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('Bold text');
  });

  test('removes italic', async ({ page }) => {
    await clearAndType(page, 'Italic text');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+i`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<em>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<em>');
    expect(html).toContain('Italic text');
  });

  test('removes underline', async ({ page }) => {
    await clearAndType(page, 'Underlined');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+u`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<u>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<u>');
    expect(html).toContain('Underlined');
  });

  test('removes strikethrough', async ({ page }) => {
    await clearAndType(page, 'Struck');
    await selectAll(page);
    await page.locator('domternal-toolbar button[aria-label="Strikethrough"]').click();

    let html = await getEditorHTML(page);
    expect(html).toContain('<s>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<s>');
    expect(html).toContain('Struck');
  });

  test('removes inline code', async ({ page }) => {
    await clearAndType(page, 'codeword');
    await selectAll(page);
    await page.locator('domternal-toolbar button[aria-label="Code"]').click();

    let html = await getEditorHTML(page);
    expect(html).toContain('<code>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<code>');
    expect(html).toContain('codeword');
  });

  test('removes highlight', async ({ page }) => {
    await clearAndType(page, 'Highlighted');
    await selectAll(page);

    // Highlight is a dropdown — click trigger then pick a color swatch
    await page.locator('domternal-toolbar button[aria-label="Highlight"]').click();
    const swatch = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-swatch').first();
    await swatch.click();

    let html = await getEditorHTML(page);
    // Highlight via color swatch renders as <span style="background-color: ...">
    expect(html).toContain('background-color');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('background-color');
    expect(html).toContain('Highlighted');
  });

  test('removes subscript', async ({ page }) => {
    await clearAndType(page, 'H2O');
    await selectAll(page);
    await page.locator('domternal-toolbar button[aria-label="Subscript"]').click();

    let html = await getEditorHTML(page);
    expect(html).toContain('<sub>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<sub>');
    expect(html).toContain('H2O');
  });

  test('removes superscript', async ({ page }) => {
    await clearAndType(page, 'x2');
    await selectAll(page);
    await page.locator('domternal-toolbar button[aria-label="Superscript"]').click();

    let html = await getEditorHTML(page);
    expect(html).toContain('<sup>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<sup>');
    expect(html).toContain('x2');
  });

  test('removes text color (textStyle span)', async ({ page }) => {
    await clearAndType(page, 'Colored');
    await selectAll(page);

    // Apply text color via toolbar color picker
    const colorTrigger = page.locator('domternal-toolbar button[aria-label="Text Color"]');
    await colorTrigger.click();
    await page.locator('domternal-toolbar button[aria-label="#e03131"]').click();

    let html = await getEditorHTML(page);
    expect(html).toContain('color');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('color:');
    expect(html).toContain('Colored');
  });
});

// ─── Multiple Marks ─────────────────────────────────────────────────────

test.describe('Clear Formatting — multiple marks at once', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('removes bold + italic simultaneously', async ({ page }) => {
    await clearAndType(page, 'Both');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press(`${modifier}+i`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('Both');
  });

  test('removes bold + italic + underline simultaneously', async ({ page }) => {
    await clearAndType(page, 'Triple');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press(`${modifier}+i`);
    await page.keyboard.press(`${modifier}+u`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<u>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<u>');
    expect(html).toContain('Triple');
  });

  test('removes all inline marks at once (bold+italic+underline+strike+highlight)', async ({ page }) => {
    // Use innerHTML to set content with all marks pre-applied
    const editor = page.locator(editorSelector);
    await editor.evaluate((el, html) => {
      el.innerHTML = html;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '<p><mark data-color="#ffec99" style="background-color: #ffec99"><s><u><em><strong>Everything</strong></em></u></s></mark></p>');
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');

    await editor.click();
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<u>');
    expect(html).not.toContain('<s>');
    expect(html).not.toContain('<mark');
    expect(html).toContain('Everything');
  });
});

// ─── Partial Selection ──────────────────────────────────────────────────

test.describe('Clear Formatting — partial selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('only removes marks from selected portion, keeps rest', async ({ page }) => {
    await clearAndType(page, 'Hello World');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    // Select just "World" (offset 6-11)
    await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      if (!pm) return;
      const strong = pm.querySelector('strong');
      const textNode = strong?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 6);
      range.setEnd(textNode, 11);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      if (pm instanceof HTMLElement) pm.focus();
    }, editorSelector);
    await page.waitForTimeout(100);

    await page.locator(clearBtn).click();

    const html = await getEditorHTML(page);
    // "Hello " should still be bold
    expect(html).toContain('<strong>');
    // "World" should be plain
    expect(html).toContain('World');
    // Verify structure: bold "Hello " followed by plain "World"
    expect(html).toMatch(/<strong>Hello <\/strong>World/);
  });

  test('clears only selected word in multi-word bold text', async ({ page }) => {
    await clearAndType(page, 'Foo Bar Baz');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    // Select just "Bar" (offset 4-7)
    await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      if (!pm) return;
      const strong = pm.querySelector('strong');
      const textNode = strong?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 7);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      if (pm instanceof HTMLElement) pm.focus();
    }, editorSelector);
    await page.waitForTimeout(100);

    await page.locator(clearBtn).click();

    const html = await getEditorHTML(page);
    // "Foo " and " Baz" should still be bold, "Bar" plain
    expect(html).toContain('<strong>Foo </strong>');
    expect(html).toContain('Bar');
    expect(html).toContain('<strong> Baz</strong>');
  });
});

// ─── Block-level preservation ───────────────────────────────────────────

test.describe('Clear Formatting — preserves block structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves heading level (only removes marks within heading)', async ({ page }) => {
    await clearAndType(page, 'Title');
    await selectAll(page);
    // Convert to H1 via heading dropdown
    await page.locator('domternal-toolbar button[aria-label="Heading"]').click();
    await page.locator('domternal-toolbar button[aria-label="Heading 1"]').click();
    // Make it bold
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>');

    // Clear formatting should remove bold but keep h1
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('Title');
  });

  test('preserves blockquote (only removes marks inside)', async ({ page }) => {
    await clearAndType(page, 'Quoted');
    await selectAll(page);
    // Wrap in blockquote
    await page.locator('domternal-toolbar button[aria-label="Blockquote"]').click();
    // Make it italic
    await selectAll(page);
    await page.keyboard.press(`${modifier}+i`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<em>');

    // Clear formatting
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('Quoted');
  });

  test('preserves list structure (only removes marks on list items)', async ({ page }) => {
    await clearAndType(page, 'Item 1');
    await selectAll(page);
    // Make bullet list
    await page.locator('domternal-toolbar button[aria-label="Bullet List"]').click();
    // Bold the list item text
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>');

    // Clear formatting
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<strong>');
    expect(html).toContain('Item 1');
  });
});

// ─── Undo interaction ───────────────────────────────────────────────────

test.describe('Clear Formatting — undo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Ctrl+Z restores marks after clear formatting', async ({ page }) => {
    await clearAndType(page, 'Undo me');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');

    // Clear formatting
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');

    // Undo should restore bold
    await page.keyboard.press(`${modifier}+z`);

    html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('Undo me');
  });
});

// ─── Multi-paragraph ────────────────────────────────────────────────────

test.describe('Clear Formatting — across paragraphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clears marks across multiple paragraphs', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('First');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');

    // Select all and bold
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');

    // Clear formatting across both paragraphs
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });

  test('clears different marks on different paragraphs', async ({ page }) => {
    // Set content with bold in first paragraph and italic in second
    const editor = page.locator(editorSelector);
    await editor.evaluate((el, html) => {
      el.innerHTML = html;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, '<p><strong>Bold paragraph</strong></p><p><em>Italic paragraph</em></p>');
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');

    // Select all and clear
    await editor.click();
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).toContain('Bold paragraph');
    expect(html).toContain('Italic paragraph');
  });
});

// ─── Link preservation (isFormatting: false) ────────────────────────────

/**
 * Set editor content via Angular's ng.getComponent (dev mode) + editor.commands.setContent.
 * This goes through ProseMirror's DOMParser which correctly handles link marks.
 */
async function setEditorContent(page: Page, html: string) {
  await page.evaluate(({ content }) => {
    const ng = (window as unknown as Record<string, unknown>)['ng'] as { getComponent?: (el: Element) => Record<string, unknown> | null } | undefined;
    const host = document.querySelector('domternal-editor');
    if (!ng?.getComponent || !host) return;
    const comp = ng.getComponent(host);
    const editor = comp?.['editor'] as { commands: Record<string, (...args: unknown[]) => boolean> } | null;
    if (!editor) return;
    editor.commands['setContent'](content);
  }, { content: html });
  await page.waitForTimeout(100);
}

test.describe('Clear Formatting — preserves links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves link after clearing bold on linked text', async ({ page }) => {
    await setEditorContent(page, '<a href="https://example.com"><strong>Bold Link</strong></a>');

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('href="https://example.com"');

    await page.locator(editorSelector).click();
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('Bold Link');
  });

  test('preserves link while removing italic', async ({ page }) => {
    await setEditorContent(page, '<a href="https://test.com"><em>Styled Link</em></a>');

    let html = await getEditorHTML(page);
    expect(html).toContain('<em>');
    expect(html).toContain('href="https://test.com"');

    await page.locator(editorSelector).click();
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<em>');
    expect(html).toContain('href="https://test.com"');
    expect(html).toContain('Styled Link');
  });

  test('preserves link on text with multiple marks', async ({ page }) => {
    await setEditorContent(page, '<a href="https://example.com"><u><em><strong>Fancy Link</strong></em></u></a>');

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('href=');

    await page.locator(editorSelector).click();
    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('<u>');
    expect(html).toContain('href=');
    expect(html).toContain('Fancy Link');
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────

test.describe('Clear Formatting — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('does nothing on plain unformatted text (text preserved)', async ({ page }) => {
    await clearAndType(page, 'Plain text');
    await selectAll(page);
    await page.locator(clearBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('Plain text');
  });

  test('button disabled with cursor inside bold text (no selection range)', async ({ page }) => {
    await clearAndType(page, 'Hello');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    // Place cursor inside bold text (collapsed)
    await placeCursor(page, 'strong', 3);

    const btn = page.locator(clearBtn);
    await expect(btn).toBeDisabled();
  });

  test('text content is preserved after clearing all formatting', async ({ page }) => {
    await clearAndType(page, 'Preserve me');
    await selectAll(page);
    // Apply multiple marks
    await page.keyboard.press(`${modifier}+b`);
    await page.keyboard.press(`${modifier}+i`);
    await page.keyboard.press(`${modifier}+u`);

    // Clear
    await selectAll(page);
    await page.locator(clearBtn).click();

    // Check text content (not innerHTML) to verify text preserved
    const text = await page.locator(editorSelector).textContent();
    expect(text).toContain('Preserve me');
  });

  test('can apply new formatting after clear', async ({ page }) => {
    await clearAndType(page, 'Reformat me');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    // Clear
    await selectAll(page);
    await page.locator(clearBtn).click();

    let html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');

    // Apply italic after clearing
    await selectAll(page);
    await page.keyboard.press(`${modifier}+i`);

    html = await getEditorHTML(page);
    expect(html).toContain('<em>');
    expect(html).not.toContain('<strong>');
  });

  test('clear formatting on single character', async ({ page }) => {
    await clearAndType(page, 'A');
    await selectAll(page);
    await page.keyboard.press(`${modifier}+b`);

    let html = await getEditorHTML(page);
    expect(html).toContain('<strong>');

    await selectAll(page);
    await page.locator(clearBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('A');
  });
});
