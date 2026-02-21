import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';

// Bubble menu button selectors (by title attribute)
const btn = {
  bold: `${bubbleMenu} button[title="Bold"]`,
  italic: `${bubbleMenu} button[title="Italic"]`,
  underline: `${bubbleMenu} button[title="Underline"]`,
  strike: `${bubbleMenu} button[title="Strikethrough"]`,
  code: `${bubbleMenu} button[title="Code"]`,
} as const;

async function setContentAndFocus(page: Page, html: string) {
  const editor = page.locator(editorSelector);
  await editor.evaluate((el, h) => {
    el.innerHTML = h;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await editor.focus();
  await page.waitForTimeout(100);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Select a range of text inside the editor using JS selection API. */
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

/** Select all text in a specific element. */
async function selectInsideTag(page: Page, tag: string, index = 0) {
  await page.evaluate(
    ({ sel, tag, index }) => {
      const els = document.querySelectorAll(sel + ' ' + tag);
      const el = els[index];
      if (!el || !el.firstChild) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { sel: editorSelector, tag, index },
  );
  await page.waitForTimeout(150);
}

/** Select text inside a code block element. */
async function selectInCodeBlock(page: Page, startOffset: number, endOffset: number) {
  await page.evaluate(
    ({ edSel, startOffset, endOffset }) => {
      const code = document.querySelector(edSel + ' pre code');
      if (!code || !code.firstChild) return;
      const range = document.createRange();
      range.setStart(code.firstChild, startOffset);
      range.setEnd(code.firstChild, endOffset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { edSel: editorSelector, startOffset, endOffset },
  );
  await page.waitForTimeout(150);
}

// ─── Visibility ──────────────────────────────────────────────────────

test.describe('Bubble menu — Visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('hidden initially (no selection)', async ({ page }) => {
    const menu = page.locator(bubbleMenu);
    await expect(menu).not.toHaveAttribute('data-show');
  });

  test('appears when text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    const menu = page.locator(bubbleMenu);
    await expect(menu).toHaveAttribute('data-show', '');
  });

  test('hidden when clicking without selecting', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');

    // Click in the editor without selecting
    await page.locator(`${editorSelector} p`).click();

    const menu = page.locator(bubbleMenu);
    await expect(menu).not.toHaveAttribute('data-show');
  });

  test('hidden after selection is collapsed', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');

    // First select text
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Then click to collapse selection
    await page.locator(`${editorSelector} p`).click();
    await page.waitForTimeout(150);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('visible class toggles with opacity transition', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    const menu = page.locator(bubbleMenu);

    // Initially hidden (via CSS visibility: hidden)
    await expect(menu).toHaveCSS('visibility', 'hidden');

    // Select text — menu becomes visible
    await selectText(page, 0, 5);
    await expect(menu).toHaveCSS('visibility', 'visible');
  });
});

// ─── Buttons ─────────────────────────────────────────────────────────

test.describe('Bubble menu — Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('has 5 buttons (bold, italic, underline, strike, code)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    const buttons = page.locator(`${bubbleMenu} button`);
    await expect(buttons).toHaveCount(5);
  });

  test('bold button toggles bold on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>Hello</strong>');
  });

  test('italic button toggles italic on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>Hello</em>');
  });

  test('underline button toggles underline on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.underline).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<u>Hello</u>');
  });

  test('strikethrough button toggles strike on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.strike).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<s>Hello</s>');
  });

  test('code button toggles code on selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>Hello</code>');
  });

  test('bold button removes bold (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectInsideTag(page, 'strong');

    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('Bold text');
  });
});

// ─── Active state ────────────────────────────────────────────────────

test.describe('Bubble menu — Active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bold button shows active when bold text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Bold text</strong></p>');
    await selectInsideTag(page, 'strong');

    await expect(page.locator(btn.bold)).toHaveClass(/active/);
  });

  test('italic button shows active when italic text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>Italic text</em></p>');
    await selectInsideTag(page, 'em');

    await expect(page.locator(btn.italic)).toHaveClass(/active/);
  });

  test('underline button shows active when underlined text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><u>Underlined text</u></p>');
    await selectInsideTag(page, 'u');

    await expect(page.locator(btn.underline)).toHaveClass(/active/);
  });

  test('buttons not active on plain text selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Plain text</p>');
    await selectText(page, 0, 5);

    await expect(page.locator(btn.bold)).not.toHaveClass(/active/);
    await expect(page.locator(btn.italic)).not.toHaveClass(/active/);
    await expect(page.locator(btn.underline)).not.toHaveClass(/active/);
  });
});

// ─── Selection preservation ──────────────────────────────────────────

test.describe('Bubble menu — Selection preservation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking bubble menu button preserves selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    // Click bold — selection should remain and menu stays visible
    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);

    // Menu should still be visible after clicking a button
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('applying multiple marks keeps menu visible', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    // Apply bold then italic
    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);
    await page.locator(btn.italic).click();
    await page.waitForTimeout(100);

    // Menu still visible
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Both marks applied
    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
  });
});

// ─── Context-aware rendering ─────────────────────────────────────────

test.describe('Bubble menu — Context-aware [contexts]', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('shows text context buttons when selecting paragraph text', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const buttons = page.locator(`${bubbleMenu} button`);
    await expect(buttons).toHaveCount(5);
    await expect(page.locator(btn.bold)).toBeVisible();
    await expect(page.locator(btn.italic)).toBeVisible();
  });

  test('shows codeBlock context buttons when selecting inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre>');
    await selectInCodeBlock(page, 0, 5);

    // Demo has codeBlock: ['paragraph'] — menu should show
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('shows different buttons for code block context', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p><pre><code>const x = 1;</code></pre>');
    await selectInCodeBlock(page, 0, 5);

    // Should show codeBlock context buttons (paragraph = "Normal text")
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const buttons = page.locator(`${bubbleMenu} button`);
    await expect(buttons).toHaveCount(1);
    await expect(page.locator(`${bubbleMenu} button[title="Normal text"]`)).toBeVisible();
  });

  test('text format buttons NOT shown inside code block', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p><pre><code>const x = 1;</code></pre>');
    await selectInCodeBlock(page, 0, 5);

    // Bold/Italic/etc should NOT be visible
    await expect(page.locator(btn.bold)).not.toBeVisible();
    await expect(page.locator(btn.italic)).not.toBeVisible();
  });

  test('switches from text buttons to code block buttons on context change', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p><pre><code>const x = 1;</code></pre>');

    // First select paragraph text
    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    await expect(page.locator(`${bubbleMenu} button`)).toHaveCount(5);

    // Then select inside code block
    await selectInCodeBlock(page, 0, 5);

    // Should now show codeBlock context (1 button)
    await expect(page.locator(`${bubbleMenu} button`)).toHaveCount(1);
    await expect(page.locator(`${bubbleMenu} button[title="Normal text"]`)).toBeVisible();
  });

  test('code block paragraph button converts to paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre>');
    await selectInCodeBlock(page, 0, 5);

    // Click the "Normal text" button
    await page.locator(`${bubbleMenu} button[title="Normal text"]`).click();
    await page.waitForTimeout(100);

    // Code block should be converted to paragraph
    const html = await getEditorHTML(page);
    expect(html).not.toContain('<pre>');
    expect(html).toContain('<p>');
  });

  test('codeBlock context does not fall back to text context', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>only code here</code></pre>');
    await selectInCodeBlock(page, 0, 4);

    // Menu should show with codeBlock context (since demo has codeBlock: ['paragraph'])
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    // But it should NOT show text context buttons
    await expect(page.locator(btn.bold)).not.toBeVisible();
  });
});

// ─── Icons ───────────────────────────────────────────────────────────

test.describe('Bubble menu — Icons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('buttons have SVG icons (not text)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    // Each button should contain an SVG element
    const buttons = page.locator(`${bubbleMenu} button`);
    const count = await buttons.count();
    expect(count).toBe(5);

    for (let i = 0; i < count; i++) {
      const svg = buttons.nth(i).locator('svg');
      await expect(svg).toHaveCount(1);
    }
  });
});
