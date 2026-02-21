import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

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
  await page.waitForTimeout(100);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Select a range of text inside the editor using JS selection API. */
async function selectText(page: Page, startOffset: number, endOffset: number, selector = `${editorSelector} p`) {
  await page.evaluate(
    ({ sel, startOffset, endOffset }) => {
      const el = document.querySelector(sel);
      if (!el || !el.firstChild) return;
      const range = document.createRange();
      range.setStart(el.firstChild, startOffset);
      range.setEnd(el.firstChild, endOffset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    },
    { sel: selector, startOffset, endOffset },
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
    },
    { sel: editorSelector, tag, index },
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
