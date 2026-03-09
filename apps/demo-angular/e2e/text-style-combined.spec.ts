/**
 * Combined TextStyle E2E tests — font family, font size, text color, highlight
 * working together on the same text. Tests interactions between all textStyle
 * sub-properties and their toolbar UX.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const fontFamilyTrigger = 'button[aria-label="Font Family"]';
const fontSizeTrigger = 'button[aria-label="Font Size"]';
const textColorTrigger = 'button[aria-label="Text Color"]';
const highlightTrigger = 'button[aria-label="Highlight"]';

const RED = '#e03131';
const BLUE = '#1971c2';
const YELLOW_HIGHLIGHT = '#fef08a';

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

async function setFontViaToolbar(page: Page, label: string) {
  await page.locator(fontFamilyTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

async function setSizeViaToolbar(page: Page, label: string) {
  await page.locator(fontSizeTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Size"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

async function setColorViaToolbar(page: Page, label: string) {
  await page.locator(textColorTrigger).dispatchEvent('click');
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Text Color"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).dispatchEvent('click');
}

async function setHighlightViaToolbar(page: Page) {
  await page.locator(highlightTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator('.dm-color-swatch').first().click();
}

function expectColor(html: string, hex: string) {
  const rgbMap: Record<string, string> = {
    '#e03131': 'rgb(224, 49, 49)',
    '#1971c2': 'rgb(25, 113, 194)',
  };
  const rgb = rgbMap[hex];
  expect(html.includes(hex) || (rgb && html.includes(rgb))).toBe(true);
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const FULLY_STYLED = `<p><span style="font-family: Georgia; font-size: 24px; color: ${RED}; background-color: ${YELLOW_HIGHLIGHT}">styled text</span></p>`;

// ─── All textStyle properties together ────────────────────────────────

test.describe('TextStyle — combined properties', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply font-family + font-size via toolbar on same text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    // Re-select after toolbar interaction
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setSizeViaToolbar(page, '24px');

    const html = await getEditorHTML(page);
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expect(html).toContain('hello world');
  });

  test('apply font-family + text color via toolbar', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setColorViaToolbar(page, RED);

    const html = await getEditorHTML(page);
    expect(html).toContain('Arial');
    expectColor(html, RED);
  });

  test('apply font-size + highlight via toolbar', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setHighlightViaToolbar(page);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-size: 32px');
    expect(html).toContain('background-color');
  });

  test('apply all four textStyle properties via toolbar', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setSizeViaToolbar(page, '24px');

    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setColorViaToolbar(page, RED);

    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    await setHighlightViaToolbar(page);

    const html = await getEditorHTML(page);
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expectColor(html, RED);
    expect(html).toContain('background-color');
    expect(html).toContain('hello world');
  });

  test('all four properties render on a single span', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);

    const html = await getEditorHTML(page);
    // All properties should be on the same textStyle span
    const spanMatch = html.match(/<span[^>]*style="([^"]*)"[^>]*>/);
    expect(spanMatch).not.toBeNull();
    const style = spanMatch![1];
    expect(style).toContain('font-family');
    expect(style).toContain('font-size');
    expect(style).toContain('color');
    expect(style).toContain('background-color');
  });
});

// ─── Unset individual properties ──────────────────────────────────────

test.describe('TextStyle — unset individual properties', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('unset font-family preserves size, color, highlight', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('font-family');
    expect(html).toContain('font-size: 24px');
    expectColor(html, RED);
    expect(html).toContain('background-color');
  });

  test('unset font-size preserves family, color, highlight', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontSize();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-family');
    expect(html).toContain('Georgia');
    expect(html).not.toContain('font-size');
    expectColor(html, RED);
    expect(html).toContain('background-color');
  });

  test('unset text color preserves family, size, highlight', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetTextColor();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-family');
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expect(html).not.toMatch(/[^-]color:/); // no standalone color, but background-color may exist
    expect(html).toContain('background-color');
  });

  test('unset highlight preserves family, size, color', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetHighlight();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('font-family');
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expectColor(html, RED);
    expect(html).not.toContain('background-color');
  });

  test('unset all properties removes span entirely', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      const ed = comp?.editor;
      if (!ed) return;
      ed.commands.unsetFontFamily();
      ed.commands.unsetFontSize();
      ed.commands.unsetTextColor();
      ed.commands.unsetHighlight();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
    expect(html).toContain('styled text');
  });
});

// ─── Toolbar trigger states for combined styles ───────────────────────

test.describe('TextStyle — toolbar triggers reflect combined state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('font family trigger shows font name for fully styled text', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await page.locator(`${editorSelector} span`).click();

    const triggerLabel = page.locator(fontFamilyTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Georgia');
  });

  test('font size trigger shows size for fully styled text', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await page.locator(`${editorSelector} span`).click();

    const triggerLabel = page.locator(fontSizeTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('24px');
  });

  test('text color trigger shows red indicator for fully styled text', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await page.locator(`${editorSelector} span`).click();

    const indicator = page.locator(textColorTrigger + ' .dm-toolbar-color-indicator');
    const bgColor = await indicator.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe('rgb(224, 49, 49)');
  });
});

// ─── Custom HTML with multiple textStyle properties ───────────────────

test.describe('TextStyle — custom HTML parsing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parses HTML with font-family + font-size + color (all accepted)', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="font-family: 'Comic Sans MS'; font-size: 20px; color: ${BLUE}">multi-styled</span></p>`);

    const html = await getEditorHTML(page);
    // Comic Sans MS is accepted (no validation)
    expect(html).toContain('Comic Sans MS');
    // 20px is accepted (no validation on font size either)
    expect(html).toContain('font-size: 20px');
    // Blue color is preserved
    expectColor(html, BLUE);
    expect(html).toContain('multi-styled');
  });

  test('parses HTML with unknown font + known size + known color', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="font-family: Papyrus; font-size: 24px; color: ${RED}">pasted content</span></p>`);

    const html = await getEditorHTML(page);
    // All properties preserved
    expect(html).toContain('Papyrus');
    expect(html).toContain('font-size: 24px');
    expectColor(html, RED);
    expect(html).toContain('pasted content');
  });

  test('text with color + highlight both preserved', async ({ page }) => {
    await setContentAndFocus(page, `<p><span style="color: ${RED}; background-color: ${YELLOW_HIGHLIGHT}">colored highlight</span></p>`);

    const html = await getEditorHTML(page);
    expectColor(html, RED);
    expect(html).toContain('background-color');
    expect(html).toContain('colored highlight');
    // Both on same span
    const spanCount = (html.match(/<span/g) || []).length;
    expect(spanCount).toBe(1);
  });

  test('bold + italic + font-family + color all preserved', async ({ page }) => {
    await setContentAndFocus(page, `<p><strong><em><span style="font-family: Georgia; color: ${BLUE}">rich text</span></em></strong></p>`);

    const html = await getEditorHTML(page);
    expect(html).toContain('Georgia');
    expectColor(html, BLUE);
    expect(html).toContain('rich text');
    expect(html).toMatch(/strong|font-weight/);
    expect(html).toContain('<em');
  });
});

// ─── Changing one property doesn't affect others ──────────────────────

test.describe('TextStyle — property isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('changing font-family preserves font-size and color', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    const html = await getEditorHTML(page);
    expect(html).toContain('Arial');
    expect(html).not.toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expectColor(html, RED);
    expect(html).toContain('background-color');
  });

  test('changing font-size preserves font-family and color', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);
    await setSizeViaToolbar(page, '32px');

    const html = await getEditorHTML(page);
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 32px');
    expect(html).not.toContain('font-size: 24px');
    expectColor(html, RED);
  });

  test('changing text color preserves font-family and font-size', async ({ page }) => {
    await setContentAndFocus(page, FULLY_STYLED);
    await selectAll(page);
    await setColorViaToolbar(page, BLUE);

    const html = await getEditorHTML(page);
    expect(html).toContain('Georgia');
    expect(html).toContain('font-size: 24px');
    expectColor(html, BLUE);
  });
});
