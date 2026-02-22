import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';

// Bubble menu default items: bold, italic, underline (no [items] input set)
const btn = {
  bold: `${bubbleMenu} button[title="Bold"]`,
  italic: `${bubbleMenu} button[title="Italic"]`,
  underline: `${bubbleMenu} button[title="Underline"]`,
} as const;

const BUTTON_COUNT = 3;
const SEPARATOR_COUNT = 0;

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

    await page.locator(`${editorSelector} p`).click();

    const menu = page.locator(bubbleMenu);
    await expect(menu).not.toHaveAttribute('data-show');
  });

  test('hidden after selection is collapsed', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');

    await selectText(page, 0, 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await page.locator(`${editorSelector} p`).click();
    await page.waitForTimeout(150);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('visible class toggles with opacity transition', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    const menu = page.locator(bubbleMenu);

    await expect(menu).toHaveCSS('visibility', 'hidden');

    await selectText(page, 0, 5);
    await expect(menu).toHaveCSS('visibility', 'visible');
  });

  test('hidden when selecting inside code block (no marks allowed)', async ({ page }) => {
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre>');
    await selectInCodeBlock(page, 0, 5);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// ─── Buttons (auto mode — bold, italic, underline) ──────────────────

test.describe('Bubble menu — Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test(`has ${BUTTON_COUNT} buttons and ${SEPARATOR_COUNT} separators (default items)`, async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await expect(page.locator(`${bubbleMenu} button`)).toHaveCount(BUTTON_COUNT);
    await expect(page.locator(`${bubbleMenu} .dm-toolbar-separator`)).toHaveCount(SEPARATOR_COUNT);
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

    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('applying multiple marks keeps menu visible', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(btn.bold).click();
    await page.waitForTimeout(100);
    await page.locator(btn.italic).click();
    await page.waitForTimeout(100);

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

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

    const buttons = page.locator(`${bubbleMenu} button`);
    const count = await buttons.count();
    expect(count).toBe(BUTTON_COUNT);

    for (let i = 0; i < count; i++) {
      const svg = buttons.nth(i).locator('svg');
      await expect(svg).toHaveCount(1);
    }
  });
});

// ─── Cross-block selection ──────────────────────────────────────────

/** Select from one block to another using ProseMirror's selection API. */
async function selectCrossBlock(
  page: Page,
  fromSelector: string,
  fromOffset: number,
  toSelector: string,
  toOffset: number,
) {
  await page.evaluate(
    ({ edSel, fromSel, fromOff, toSel, toOff }) => {
      const fromEl = document.querySelector(edSel + ' ' + fromSel);
      const toEl = document.querySelector(edSel + ' ' + toSel);
      if (!fromEl?.firstChild || !toEl?.firstChild) return;
      const range = document.createRange();
      range.setStart(fromEl.firstChild, fromOff);
      range.setEnd(toEl.firstChild, toOff);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { edSel: editorSelector, fromSel: fromSelector, fromOff: fromOffset, toSel: toSelector, toOff: toOffset },
  );
  await page.waitForTimeout(150);
}

const crossBlockContent = '<p>First paragraph</p><pre><code>const x = 1;</code></pre><p>Second paragraph</p>';

test.describe('Bubble menu — Cross-block selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('visible when selection spans paragraph → codeBlock → paragraph', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);
    await selectCrossBlock(page, 'p:first-of-type', 0, 'p:last-of-type', 6);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('visible when selection spans paragraph → codeBlock', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);
    await selectCrossBlock(page, 'p:first-of-type', 0, 'pre code', 5);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('hidden when selection is only inside codeBlock', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);
    await selectInCodeBlock(page, 0, 5);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('visible when selection spans codeBlock → paragraph ($from in codeBlock)', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);
    await selectCrossBlock(page, 'pre code', 0, 'p:last-of-type', 6);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('stays visible during drag DOWN through codeBlock (p1 → code → p2)', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);

    const p1 = page.locator(`${editorSelector} p:first-of-type`);
    const code = page.locator(`${editorSelector} pre`);
    const p2 = page.locator(`${editorSelector} p:last-of-type`);

    const [p1Box, codeBox, p2Box] = await Promise.all([p1.boundingBox(), code.boundingBox(), p2.boundingBox()]);
    if (!p1Box || !codeBox || !p2Box) return;

    // Start at beginning of p1
    await page.mouse.move(p1Box.x + 10, p1Box.y + p1Box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag to end of p1
    await page.mouse.move(p1Box.x + p1Box.width - 10, p1Box.y + p1Box.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Drag into middle of code block — should stay visible
    await page.mouse.move(codeBox.x + codeBox.width / 2, codeBox.y + codeBox.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Drag into p2 — should stay visible
    await page.mouse.move(p2Box.x + p2Box.width / 3, p2Box.y + p2Box.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await page.mouse.up();
  });

  test('stays visible during drag UP through codeBlock (p2 → code → p1)', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);

    const p1 = page.locator(`${editorSelector} p:first-of-type`);
    const code = page.locator(`${editorSelector} pre`);
    const p2 = page.locator(`${editorSelector} p:last-of-type`);

    const [p1Box, codeBox, p2Box] = await Promise.all([p1.boundingBox(), code.boundingBox(), p2.boundingBox()]);
    if (!p1Box || !codeBox || !p2Box) return;

    // Start at end of p2
    await page.mouse.move(p2Box.x + p2Box.width - 20, p2Box.y + p2Box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag to beginning of p2
    await page.mouse.move(p2Box.x + 10, p2Box.y + p2Box.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Drag into middle of code block — should stay visible
    await page.mouse.move(codeBox.x + codeBox.width / 2, codeBox.y + codeBox.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Drag into p1 — should stay visible
    await page.mouse.move(p1Box.x + p1Box.width / 2, p1Box.y + p1Box.height / 2, { steps: 5 });
    await page.waitForTimeout(150);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    await page.mouse.up();
  });

  test('bold applies to paragraphs only (not codeBlock) on cross-block selection', async ({ page }) => {
    await setContentAndFocus(page, crossBlockContent);
    await selectCrossBlock(page, 'p:first-of-type', 0, 'p:last-of-type', 6);
    await page.waitForTimeout(100);

    await page.locator(btn.bold).click();
    const html = await getEditorHTML(page);

    expect(html).toContain('<strong>First');
    expect(html).toContain('<pre>');
  });
});
