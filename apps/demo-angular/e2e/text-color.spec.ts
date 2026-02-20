import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = 'button[aria-label="Text Color"]';

// Demo app configures these 4 colors
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ff9900'] as const;

// Map hex to rgb for browser-normalized checks
const HEX_TO_RGB: Record<string, string> = {
  '#ff0000': 'rgb(255, 0, 0)',
  '#00ff00': 'rgb(0, 255, 0)',
  '#0000ff': 'rgb(0, 0, 255)',
  '#ff9900': 'rgb(255, 153, 0)',
};

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

async function selectAll(page: Page) {
  await page.locator(editorSelector).click();
  await page.keyboard.press(`${modifier}+A`);
}

/** Open the text color dropdown and click a specific color item */
async function setColorViaToolbar(page: Page, label: string) {
  await page.locator(dropdownTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

/**
 * Check that the HTML contains the given hex color (browser may render as hex or rgb).
 */
function expectColor(html: string, hexColor: string) {
  const rgb = HEX_TO_RGB[hexColor];
  const hasHex = html.includes(hexColor);
  const hasRgb = rgb ? html.includes(rgb) : false;
  expect(hasHex || hasRgb).toBe(true);
}

/** Check that the HTML has no color style */
function expectNoColor(html: string) {
  // Neither hex nor rgb color should appear in a style
  expect(html).not.toMatch(/style="[^"]*color:/);
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_RED = '<p><span style="color: #ff0000">red text</span></p>';
const PARAGRAPH_BLUE = '<p><span style="color: #0000ff">blue text</span></p>';
const PARAGRAPH_GREEN = '<p><span style="color: #00ff00">green text</span></p>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';

// ─── Toolbar dropdown ─────────────────────────────────────────────────

test.describe('TextColor — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(dropdownTrigger)).toBeVisible();
  });

  test('clicking trigger opens dropdown panel', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
  });

  test('dropdown contains 4 colors + Default = 5 items', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(5);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(panel).not.toBeVisible();
  });

  test('all configured color labels appear in dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    for (const color of COLORS) {
      await expect(panel.locator(`button[aria-label="${color}"]`)).toBeVisible();
    }
    await expect(panel.locator('button[aria-label="Default"]')).toBeVisible();
  });
});

// ─── Set color via toolbar ────────────────────────────────────────────

test.describe('TextColor — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set red (#ff0000) on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('hello world');
  });

  test('set green (#00ff00) on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#00ff00');

    const html = await getEditorHTML(page);
    expectColor(html, '#00ff00');
  });

  test('set blue (#0000ff) on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expectColor(html, '#0000ff');
  });

  test('set orange (#ff9900) on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff9900');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff9900');
  });

  test('color renders as span with color style', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<span[^>]*style="color:/);
  });
});

// ─── Unset / Default ──────────────────────────────────────────────────

test.describe('TextColor — unset (Default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking Default removes color from text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await selectAll(page);
    await setColorViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoColor(html);
    expect(html).toContain('red text');
  });

  test('Default removes span wrapper when no other styles', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await selectAll(page);
    await setColorViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
  });

  test('unset after setting via toolbar removes color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    let html = await getEditorHTML(page);
    expectColor(html, '#0000ff');

    // Re-focus editor and select all via evaluate (toolbar interaction loses editor focus)
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const s = window.getSelection();
      if (s && editor) {
        const range = document.createRange();
        range.selectNodeContents(editor);
        s.removeAllRanges();
        s.addRange(range);
      }
    }, editorSelector);
    await page.waitForTimeout(50);
    await setColorViaToolbar(page, 'Default');
    html = await getEditorHTML(page);
    expectNoColor(html);
  });
});

// ─── Change between colors ────────────────────────────────────────────

test.describe('TextColor — change between colors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('change from red to blue', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expectColor(html, '#0000ff');
    // Red should be gone
    expect(html).not.toContain('#ff0000');
    expect(html).not.toContain('rgb(255, 0, 0)');
  });

  test('change from blue to green', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);
    await selectAll(page);
    await setColorViaToolbar(page, '#00ff00');

    const html = await getEditorHTML(page);
    expectColor(html, '#00ff00');
    expect(html).not.toContain('#0000ff');
    expect(html).not.toContain('rgb(0, 0, 255)');
  });

  test('rapid color changes keep only the last', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');
    await page.waitForTimeout(50);
    await selectAll(page);
    await setColorViaToolbar(page, '#00ff00');
    await page.waitForTimeout(50);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff9900');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff9900');
    expect(html).not.toContain('#ff0000');
    expect(html).not.toContain('rgb(255, 0, 0)');
  });
});

// ─── Active state ─────────────────────────────────────────────────────

test.describe('TextColor — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger shows active when color is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await page.locator(`${editorSelector} span`).click();

    await expect(page.locator(dropdownTrigger)).toHaveClass(/active/);
  });

  test('dropdown trigger not active for unstyled text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(dropdownTrigger)).not.toHaveClass(/active/);
  });

  test('correct color item shows active in dropdown', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="#ff0000"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="#0000ff"]')).not.toHaveClass(/active/);
  });

  test('blue item shows active for blue text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="#0000ff"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="#ff0000"]')).not.toHaveClass(/active/);
  });

  test('active state updates after changing color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await selectAll(page);
    await setColorViaToolbar(page, '#00ff00');
    await page.waitForTimeout(50);
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="#00ff00"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="#ff0000"]')).not.toHaveClass(/active/);
  });
});

// ─── parseHTML / color normalization ──────────────────────────────────

test.describe('TextColor — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves red color from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('red text');
  });

  test('preserves blue color from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, '#0000ff');
    expect(html).toContain('blue text');
  });

  test('normalizes rgb() to hex on parse', async ({ page }) => {
    // Browser style uses rgb(), extension normalizes to hex on parse
    await setContentAndFocus(page, '<p><span style="color: rgb(255, 0, 0)">rgb text</span></p>');

    const html = await getEditorHTML(page);
    // After parse → normalize → render, should still have the color
    expectColor(html, '#ff0000');
    expect(html).toContain('rgb text');
  });

  test('unstyled paragraph has no span wrapper', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
    expectNoColor(html);
  });

  test('rejects color not in allowed list', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="color: #purple">not allowed</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('not allowed');
    // Invalid color should be stripped
    expect(html).not.toContain('#purple');
  });

  test('rejects hex color not in configured list', async ({ page }) => {
    // #123456 is not in the configured colors list
    await setContentAndFocus(page, '<p><span style="color: #123456">unlisted color</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('unlisted color');
    expect(html).not.toContain('#123456');
  });
});

// ─── Partial selection ────────────────────────────────────────────────

test.describe('TextColor — partial selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply color to partial text creates styled span', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    // Select "hello" using evaluate for precision
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('world');
    // Only one colored span
    const spans = html.match(/<span[^>]*color[^>]*>/g);
    expect(spans).toHaveLength(1);
  });

  test('apply different colors to different paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first line</p><p>second line</p>');

    // Select first paragraph text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setColorViaToolbar(page, '#ff0000');

    await page.waitForTimeout(50);

    // Select second paragraph text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const p2 = editor?.querySelectorAll('p')[1];
      const textNode = p2?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expectColor(html, '#0000ff');
  });
});

// ─── Multiple paragraphs ─────────────────────────────────────────────

test.describe('TextColor — multiple paragraphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply color to first paragraph only', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('second paragraph</p>');
  });

  test('select all applies color to all text', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expectColor(html, '#0000ff');
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');
  });
});

// ─── Combined with other styles ───────────────────────────────────────

test.describe('TextColor — combined with other marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('color with bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('bold text');
    expect(html).toMatch(/strong|font-weight/);
  });

  test('color combined with font-family on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia">styled text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });

  test('color combined with font-size on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 24px">sized text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expectColor(html, '#0000ff');
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
  });

  test('unset color preserves font-family', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia; color: #ff0000">styled text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoColor(html);
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });

  test('unset color preserves font-size', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 24px; color: #ff0000">styled text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoColor(html);
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
  });
});

// ─── Persistence ──────────────────────────────────────────────────────

test.describe('TextColor — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('color persists after typing more text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('extra');
  });

  test('undo restores original text without color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    let html = await getEditorHTML(page);
    expectColor(html, '#ff0000');

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectNoColor(html);
  });

  test('redo re-applies color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, '#ff0000');

    await page.keyboard.press(`${modifier}+Z`);
    let html = await getEditorHTML(page);
    expectNoColor(html);

    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('TextColor — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('applying color with collapsed cursor affects next typed text', async ({ page }) => {
    await setContentAndFocus(page, '<p>text</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    await setColorViaToolbar(page, '#ff0000');
    await page.keyboard.type(' new');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff0000');
    expect(html).toContain('new');
  });

  test('color on heading text', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await selectAll(page);
    await setColorViaToolbar(page, '#0000ff');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expectColor(html, '#0000ff');
    expect(html).toContain('heading text');
  });

  test('color inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await selectAll(page);
    await setColorViaToolbar(page, '#ff9900');

    const html = await getEditorHTML(page);
    expectColor(html, '#ff9900');
    expect(html).toContain('quoted text');
  });

  test('color inside list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>list item</p></li></ul>');
    await selectAll(page);
    await setColorViaToolbar(page, '#00ff00');

    const html = await getEditorHTML(page);
    expectColor(html, '#00ff00');
    expect(html).toContain('list item');
  });

  test('color does not bleed into adjacent paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first</p><p>second</p>');
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const textNode = editor?.querySelector('p:first-child')?.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await setColorViaToolbar(page, '#ff0000');

    const html = await getEditorHTML(page);
    expect(html).toContain('second</p>');
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});
