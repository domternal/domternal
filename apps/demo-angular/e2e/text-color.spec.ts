import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = 'button[aria-label="Text Color"]';

// Default palette: 5x5 = 25 color swatches
const SWATCH_COUNT = 25;

// Palette colors used in tests (vivid row)
const RED    = '#e03131';
const ORANGE = '#f08c00';
const GREEN  = '#2f9e44';
const BLUE   = '#1971c2';

// Map hex to rgb for browser-normalized checks
const HEX_TO_RGB: Record<string, string> = {
  [RED]:    'rgb(224, 49, 49)',
  [ORANGE]: 'rgb(240, 140, 0)',
  [GREEN]:  'rgb(47, 158, 68)',
  [BLUE]:   'rgb(25, 113, 194)',
};

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
  await page.keyboard.press(`${modifier}+A`);
}

/** Open the text color dropdown and click a specific color item */
async function setColorViaToolbar(page: Page, label: string) {
  await page.locator(dropdownTrigger).dispatchEvent('click');
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).dispatchEvent('click');
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
  expect(html).not.toMatch(/style="[^"]*color:/);
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_RED = `<p><span style="color: ${RED}">red text</span></p>`;
const PARAGRAPH_BLUE = `<p><span style="color: ${BLUE}">blue text</span></p>`;
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

  test(`dropdown contains ${SWATCH_COUNT} color swatches + reset button`, async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    const swatches = panel.locator('.dm-color-swatch');
    await expect(swatches).toHaveCount(SWATCH_COUNT);
    const reset = panel.locator('.dm-color-palette-reset');
    await expect(reset).toHaveCount(1);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(panel).not.toBeVisible();
  });

  test('palette panel has grid layout class', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-color-palette');
    await expect(panel).toBeVisible();
  });

  test('palette contains default/reset button', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="Default"]')).toBeVisible();
  });

  test('palette colors have background-color style', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    const firstSwatch = panel.locator('.dm-color-swatch').first();
    const bgColor = await firstSwatch.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).not.toBe('');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });
});

// ─── Set color via toolbar ────────────────────────────────────────────

test.describe('TextColor — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set red on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('hello world');
  });

  test('set green on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, GREEN);

    const html = await getEditorHTML(page);
    expectColor(html, GREEN);
  });

  test('set blue on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, BLUE);
  });

  test('set orange on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, ORANGE);

    const html = await getEditorHTML(page);
    expectColor(html, ORANGE);
  });

  test('color renders as span with color style', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, RED);

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
    await setColorViaToolbar(page, BLUE);

    let html = await getEditorHTML(page);
    expectColor(html, BLUE);

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
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, BLUE);
    // Red should be gone
    expect(html).not.toContain(RED);
    expect(html).not.toContain(HEX_TO_RGB[RED]);
  });

  test('change from blue to green', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);
    await selectAll(page);
    await setColorViaToolbar(page, GREEN);

    const html = await getEditorHTML(page);
    expectColor(html, GREEN);
    expect(html).not.toContain(BLUE);
    expect(html).not.toContain(HEX_TO_RGB[BLUE]);
  });

  test('rapid color changes keep only the last', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, RED);
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setColorViaToolbar(page, GREEN);
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setColorViaToolbar(page, ORANGE);

    const html = await getEditorHTML(page);
    expectColor(html, ORANGE);
    expect(html).not.toContain(RED);
    expect(html).not.toContain(HEX_TO_RGB[RED]);
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

  test('correct color swatch shows active in palette', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator(`button[aria-label="${RED}"]`)).toHaveClass(/active/);
    await expect(panel.locator(`button[aria-label="${BLUE}"]`)).not.toHaveClass(/active/);
  });

  test('blue swatch shows active for blue text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator(`button[aria-label="${BLUE}"]`)).toHaveClass(/active/);
    await expect(panel.locator(`button[aria-label="${RED}"]`)).not.toHaveClass(/active/);
  });

  test('active state updates after changing color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_RED);
    await selectAll(page);
    await setColorViaToolbar(page, GREEN);
    await page.waitForTimeout(50);
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator(`button[aria-label="${GREEN}"]`)).toHaveClass(/active/);
    await expect(panel.locator(`button[aria-label="${RED}"]`)).not.toHaveClass(/active/);
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
    expectColor(html, RED);
    expect(html).toContain('red text');
  });

  test('preserves blue color from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, BLUE);
    expect(html).toContain('blue text');
  });

  test('normalizes rgb() to hex on parse', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="color: ${HEX_TO_RGB[RED]}">rgb text</span></p>`);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('rgb text');
  });

  test('unstyled paragraph has no span wrapper', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
    expectNoColor(html);
  });

  test('rejects invalid CSS color', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="color: #purple">not allowed</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('not allowed');
    expect(html).not.toContain('#purple');
  });

  test('preserves any valid hex color from HTML', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="color: #123456">custom color</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('custom color');
    // Browser innerHTML normalizes hex to rgb(), so check the equivalent rgb value
    expect(html).toContain('rgb(18, 52, 86)');
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
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('world');
    const spans = html.match(/<span[^>]*color[^>]*>/g);
    expect(spans).toHaveLength(1);
  });

  test('apply different colors to different paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first line</p><p>second line</p>');

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
    await setColorViaToolbar(page, RED);

    await page.waitForTimeout(50);

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
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expectColor(html, BLUE);
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
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('second paragraph</p>');
  });

  test('select all applies color to all text', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await selectAll(page);
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, BLUE);
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
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('bold text');
    expect(html).toMatch(/strong|font-weight/);
  });

  test('color combined with font-family on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia">styled text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });

  test('color combined with font-size on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 24px">sized text</span></p>');
    await selectAll(page);
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expectColor(html, BLUE);
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
  });

  test('unset color preserves font-family', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="font-family: Georgia; color: ${RED}">styled text</span></p>`);
    await selectAll(page);
    await setColorViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoColor(html);
    expect(html).toContain('Georgia');
    expect(html).toContain('styled text');
  });

  test('unset color preserves font-size', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="font-size: 24px; color: ${RED}">styled text</span></p>`);
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
    expectColor(html, RED);
    expect(html).toContain('extra');
  });

  test('undo restores original text without color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, RED);

    let html = await getEditorHTML(page);
    expectColor(html, RED);

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectNoColor(html);
  });

  test('redo re-applies color', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setColorViaToolbar(page, RED);

    await page.keyboard.press(`${modifier}+Z`);
    let html = await getEditorHTML(page);
    expectNoColor(html);

    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expectColor(html, RED);
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

    await setColorViaToolbar(page, RED);
    await page.keyboard.type(' new');

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('new');
  });

  test('color on heading text', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await selectAll(page);
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expectColor(html, BLUE);
    expect(html).toContain('heading text');
  });

  test('color inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await selectAll(page);
    await setColorViaToolbar(page, ORANGE);

    const html = await getEditorHTML(page);
    expectColor(html, ORANGE);
    expect(html).toContain('quoted text');
  });

  test('color inside list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>list item</p></li></ul>');
    await selectAll(page);
    await setColorViaToolbar(page, GREEN);

    const html = await getEditorHTML(page);
    expectColor(html, GREEN);
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
    await setColorViaToolbar(page, RED);

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
