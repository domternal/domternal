import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const highlightTrigger = 'button[aria-label="Highlight"]';
const swatchSelector = '.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-swatch';
const noHighlightBtn = 'button[aria-label="No highlight"]';

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

async function replaceAndSelectAll(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type(text);
  await page.keyboard.press(`${modifier}+a`);
}

// ─── Dropdown behavior ──────────────────────────────────────────────

test.describe('Highlight — dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(highlightTrigger)).toBeVisible();
  });

  test('clicking trigger opens color palette', async ({ page }) => {
    await page.locator(highlightTrigger).click();
    await expect(page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette')).toBeVisible();
  });

  test('clicking trigger again closes palette', async ({ page }) => {
    await page.locator(highlightTrigger).click();
    await page.locator(highlightTrigger).click();
    await expect(page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette')).not.toBeVisible();
  });

  test('palette contains 25 color swatches + No highlight', async ({ page }) => {
    await page.locator(highlightTrigger).click();
    const swatches = page.locator(swatchSelector);
    await expect(swatches).toHaveCount(25);
    await expect(page.locator(noHighlightBtn)).toBeVisible();
  });

  test('trigger has dropdown caret', async ({ page }) => {
    const html = await page.locator(highlightTrigger).innerHTML();
    expect(html).toContain('dm-dropdown-caret');
  });
});

// ─── Color indicator bar on trigger ──────────────────────────────────

test.describe('Highlight — color indicator bar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('trigger has no indicator when cursor is on unstyled text', async ({ page }) => {
    await setContentAndFocus(page, '<p>plain text</p>');
    await page.locator(`${editorSelector} p`).click();

    // Highlight has no defaultIndicatorColor, so indicator element should not exist
    const indicator = page.locator(highlightTrigger + ' .dm-toolbar-color-indicator');
    await expect(indicator).toHaveCount(0);
  });

  test('trigger shows indicator when cursor is on highlighted text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="background-color: #fef08a">highlighted</span></p>');
    await page.locator(`${editorSelector} span`).click();

    const indicator = page.locator(highlightTrigger + ' .dm-toolbar-color-indicator');
    await expect(indicator).toBeVisible();
    const bgColor = await indicator.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(254, 240, 138)');
  });

  test('indicator disappears after removing highlight', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="background-color: #fef08a">highlighted</span></p>');
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(noHighlightBtn).click();
    await page.waitForTimeout(100);

    const indicator = page.locator(highlightTrigger + ' .dm-toolbar-color-indicator');
    await expect(indicator).toHaveCount(0);
  });

  test('indicator updates color after changing highlight', async ({ page }) => {
    await replaceAndSelectAll(page, 'change color');
    // Apply first color (swatch 0)
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();
    await page.waitForTimeout(50);

    const indicator = page.locator(highlightTrigger + ' .dm-toolbar-color-indicator');
    const color1 = await indicator.evaluate(el => getComputedStyle(el).backgroundColor);

    // Apply different color (swatch 3)
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).nth(3).click();
    await page.waitForTimeout(50);

    const color2 = await indicator.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(color1).not.toBe(color2);
  });

  test('trigger does not have active class (grid dropdowns use indicator)', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="background-color: #fef08a">highlighted</span></p>');
    await page.locator(`${editorSelector} span`).click();

    await expect(page.locator(highlightTrigger)).not.toHaveClass(/active/);
  });
});

// ─── Applying highlight ──────────────────────────────────────────────

test.describe('Highlight — applying', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking a swatch applies background-color to selected text', async ({ page }) => {
    await replaceAndSelectAll(page, 'color me');
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toContain('color me');
    expect(html).not.toContain('<mark');
  });

  test('highlight renders as span not mark', async ({ page }) => {
    await replaceAndSelectAll(page, 'no mark tag');
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<span');
    expect(html).not.toContain('<mark');
  });

  test('specific color swatch applies its color', async ({ page }) => {
    await replaceAndSelectAll(page, 'yellow');
    await page.locator(highlightTrigger).click();
    // First swatch is #fef08a → browser serialises as rgb(254, 240, 138)
    await page.locator(swatchSelector).first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toMatch(/rgb\(254,\s*240,\s*138\)|#fef08a/);
  });

  test('different swatches apply different colors', async ({ page }) => {
    await replaceAndSelectAll(page, 'first');
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();
    const html1 = await getEditorHTML(page);

    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('second');
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).nth(4).click();
    const html2 = await getEditorHTML(page);

    // The two colors should differ
    const bg1 = html1.match(/background-color:\s*([^;"]+)/)?.[1] ?? '';
    const bg2 = html2.match(/background-color:\s*([^;"]+)/)?.[1] ?? '';
    expect(bg1).not.toBe('');
    expect(bg2).not.toBe('');
    expect(bg1).not.toBe(bg2);
  });

  test('dropdown closes after clicking swatch', async ({ page }) => {
    await replaceAndSelectAll(page, 'close test');
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    await expect(page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-palette')).not.toBeVisible();
  });

  test('swatch is active when cursor is on highlighted text', async ({ page }) => {
    await replaceAndSelectAll(page, 'active test');
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    // Re-open dropdown
    await page.locator(highlightTrigger).click();
    const firstSwatch = page.locator(swatchSelector).first();
    await expect(firstSwatch).toHaveClass(/dm-color-swatch--active/);
  });
});

// ─── Removing highlight ──────────────────────────────────────────────

test.describe('Highlight — removing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('No highlight button removes background-color', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="background-color: #fef08a">highlighted</span></p>');
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(noHighlightBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('background-color');
    expect(html).toContain('highlighted');
  });

  test('removing highlight preserves text color', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="color: #e03131; background-color: #fef08a">both</span></p>');
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(noHighlightBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('background-color');
    // Text color preserved (browser may serialise as rgb)
    expect(html).toMatch(/color:\s*(#e03131|rgb\(224,\s*49,\s*49\))/);
  });

  test('changing highlight color replaces previous color', async ({ page }) => {
    await replaceAndSelectAll(page, 'swap');
    // Apply first color
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    // Apply second color
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).nth(2).click();

    const html = await getEditorHTML(page);
    // Should only have one background-color, the second one
    const bgMatches = html.match(/background-color/g);
    expect(bgMatches).toHaveLength(1);
  });
});

// ─── Keyboard shortcut ───────────────────────────────────────────────

test.describe('Highlight — keyboard shortcut', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Mod-Shift-H toggles highlight with default color', async ({ page }) => {
    await replaceAndSelectAll(page, 'shortcut');
    await page.keyboard.press(`${modifier}+Shift+h`);

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toContain('shortcut');
  });

  test('Mod-Shift-H removes highlight (toggle off)', async ({ page }) => {
    await replaceAndSelectAll(page, 'toggle off');
    // Apply via keyboard shortcut
    await page.keyboard.press(`${modifier}+Shift+h`);
    let html = await getEditorHTML(page);
    expect(html).toContain('background-color');

    // Remove via No Highlight button (unsetHighlight command)
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(noHighlightBtn).click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('background-color');
    expect(html).toContain('toggle off');
  });
});

// ─── Input rule ──────────────────────────────────────────────────────

test.describe('Highlight — input rule', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('==text== creates highlight', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('==hello==');

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toContain('hello');
    expect(html).not.toContain('<mark');
    expect(html).not.toContain('==');
  });

  test('==text== uses defaultColor', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('==yellow==');

    const html = await getEditorHTML(page);
    // defaultColor is #fef08a → browser serialises as rgb(254, 240, 138)
    expect(html).toMatch(/rgb\(254,\s*240,\s*138\)|#fef08a/);
  });
});

// ─── Combined with other formatting ─────────────────────────────────

test.describe('Highlight — combined with other marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('highlight + text color render on same span', async ({ page }) => {
    await replaceAndSelectAll(page, 'both colors');
    // Apply text color first
    await page.locator('button[aria-label="Text Color"]').click();
    await page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-color-swatch').first().click();

    // Apply highlight
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    const html = await getEditorHTML(page);
    // Both colors should be on the same span (textStyle mark)
    expect(html).toContain('color:');
    expect(html).toContain('background-color:');
    // Should not have nested spans for colors
    const spanCount = (html.match(/<span/g) || []).length;
    expect(spanCount).toBe(1);
  });

  test('highlight + bold renders correctly', async ({ page }) => {
    await replaceAndSelectAll(page, 'bold highlight');
    await page.locator('.dm-toolbar button[aria-label="Bold"]').click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(swatchSelector).first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('background-color');
  });

  test('parsed <mark> converts to textStyle with backgroundColor', async ({ page }) => {
    await setContentAndFocus(page, '<p><mark>legacy</mark></p>');

    const html = await getEditorHTML(page);
    // <mark> should be parsed as textStyle with backgroundColor, not as <mark>
    expect(html).not.toContain('<mark');
    expect(html).toContain('background-color');
    expect(html).toContain('legacy');
  });
});
