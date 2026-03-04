import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const dropdownTrigger = 'button[aria-label="Font Family"]';

const DEFAULT_FONTS = [
  'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Palatino Linotype', 'Courier New',
];

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

/** Open the font family dropdown and click a specific font item */
async function setFontViaToolbar(page: Page, label: string) {
  await page.locator(dropdownTrigger).click();
  const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
  await panel.waitFor({ state: 'visible' });
  await panel.locator(`button[aria-label="${label}"]`).click();
}

/** Check that the HTML contains the given font name in a font-family declaration.
 *  Browser may quote multi-word font names (e.g., &quot;Courier New&quot;) */
function expectFontFamily(html: string, fontName: string) {
  expect(html).toContain('font-family');
  expect(html).toContain(fontName);
}

/** Check that the HTML does NOT contain any font-family */
function expectNoFontFamily(html: string) {
  expect(html).not.toContain('font-family');
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>hello world</p>';
const PARAGRAPH_ARIAL = '<p><span style="font-family: Arial">arial text</span></p>';
const PARAGRAPH_GEORGIA = '<p><span style="font-family: Georgia">georgia text</span></p>';
const PARAGRAPH_COURIER = '<p><span style="font-family: Courier New">monospaced text</span></p>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';

// ─── Toolbar dropdown ─────────────────────────────────────────────────

test.describe('FontFamily — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger is visible in toolbar', async ({ page }) => {
    await expect(page.locator(dropdownTrigger)).toBeVisible();
  });

  test('clicking trigger opens dropdown panel', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
  });

  test('dropdown contains 8 fonts + Default = 9 items', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(9);
  });

  test('clicking trigger again closes dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    await page.locator(dropdownTrigger).click();
    await expect(panel).not.toBeVisible();
  });

  test('all default font names appear in dropdown', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    for (const font of DEFAULT_FONTS) {
      await expect(panel.locator(`button[aria-label="${font}"]`)).toBeVisible();
    }
    await expect(panel.locator('button[aria-label="Default"]')).toBeVisible();
  });
});

// ─── Font preview in dropdown ─────────────────────────────────────────

test.describe('FontFamily — font preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('each font item is rendered in its own font', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');

    for (const font of DEFAULT_FONTS) {
      const item = panel.locator(`button[aria-label="${font}"]`);
      const style = await item.getAttribute('style');
      const expected = font.includes(' ') ? `font-family: '${font}'` : `font-family: ${font}`;
      expect(style).toContain(expected);
    }
  });

  test('Default item has no font-family style', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const defaultBtn = panel.locator('button[aria-label="Default"]');
    const style = await defaultBtn.getAttribute('style');
    expect(style).toBeNull();
  });
});

// ─── Set font family via toolbar ──────────────────────────────────────

test.describe('FontFamily — set via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('set Arial on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');
    expect(html).toContain('hello world');
  });

  test('set Times New Roman on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Times New Roman');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Times New Roman');
  });

  test('set Courier New on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Courier New');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Courier New');
  });

  test('set Tahoma on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Tahoma');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Tahoma');
  });

  test('set Trebuchet MS on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Trebuchet MS');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Trebuchet MS');
  });

  test('set Georgia on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
  });

  test('set Palatino Linotype on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Palatino Linotype');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Palatino Linotype');
  });

  test('set Verdana on selected text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Verdana');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Verdana');
  });

  test('font renders as span with style', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<span[^>]*style="font-family: Georgia;?"[^>]*>/);
  });
});

// ─── Unset / Default ──────────────────────────────────────────────────

test.describe('FontFamily — unset (Default)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking Default removes font-family from text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);
    await setFontViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoFontFamily(html);
    expect(html).toContain('arial text');
  });

  test('Default removes span wrapper when no other styles', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);
    await setFontViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
  });

  test('unset after setting via toolbar removes font-family', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    let html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');

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
    await setFontViaToolbar(page, 'Default');
    html = await getEditorHTML(page);
    expectNoFontFamily(html);
  });
});

// ─── Change between fonts ─────────────────────────────────────────────

test.describe('FontFamily — change between fonts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('change from Arial to Georgia', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    expect(html).not.toContain('Arial');
  });

  test('change from Georgia to Courier New', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_GEORGIA);
    await selectAll(page);
    await setFontViaToolbar(page, 'Courier New');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Courier New');
    expect(html).not.toContain('Georgia');
  });

  test('rapid font changes keep only the last', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setFontViaToolbar(page, 'Tahoma');
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(100);
    await setFontViaToolbar(page, 'Verdana');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Verdana');
    expect(html).not.toContain('Arial');
    expect(html).not.toContain('Tahoma');
  });
});

// ─── Active state ─────────────────────────────────────────────────────

test.describe('FontFamily — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dropdown trigger shows active when font is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await page.locator(`${editorSelector} span`).click();

    await expect(page.locator(dropdownTrigger)).toHaveClass(/active/);
  });

  test('dropdown trigger not active for unstyled text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(dropdownTrigger)).not.toHaveClass(/active/);
  });

  test('correct font item shows active in dropdown', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="Arial"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="Georgia"]')).not.toHaveClass(/active/);
  });

  test('Georgia item shows active for Georgia text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_GEORGIA);
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="Georgia"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="Arial"]')).not.toHaveClass(/active/);
  });

  test('active state updates after changing font', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);
    await setFontViaToolbar(page, 'Verdana');
    await page.waitForTimeout(50);
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="Verdana"]')).toHaveClass(/active/);
    await expect(panel.locator('button[aria-label="Arial"]')).not.toHaveClass(/active/);
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('FontFamily — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('preserves font-family: Arial from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');
    expect(html).toContain('arial text');
  });

  test('preserves font-family: Georgia from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_GEORGIA);

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    expect(html).toContain('georgia text');
  });

  test('preserves font-family: Courier New from HTML', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_COURIER);

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Courier New');
    expect(html).toContain('monospaced text');
  });

  test('unstyled paragraph has no span wrapper', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
    expectNoFontFamily(html);
  });

  test('parses quoted font-family from browser-style HTML', async ({ page }) => {
    // Browsers may add quotes around font names with spaces
    await setContentAndFocus(page, '<p><span style="font-family: \'Times New Roman\'">quoted font</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('Times New Roman');
    expect(html).toContain('quoted font');
  });

  test('rejects font-family not in allowed list', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Papyrus">not allowed</span></p>');

    const html = await getEditorHTML(page);
    // Papyrus is not in the default list, so it should be stripped
    expect(html).not.toContain('Papyrus');
    expect(html).toContain('not allowed');
  });
});

// ─── Partial selection ────────────────────────────────────────────────

test.describe('FontFamily — partial selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply font to partial text creates styled span', async ({ page }) => {
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
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    // "world" should remain unstyled
    expect(html).toContain('world');
    const spans = html.match(/<span[^>]*font-family[^>]*>/g);
    expect(spans).toHaveLength(1);
  });

  test('apply different fonts to different paragraphs', async ({ page }) => {
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
    await setFontViaToolbar(page, 'Arial');

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
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expect(html).toContain('Arial');
    expect(html).toContain('Georgia');
  });
});

// ─── Multiple paragraphs ─────────────────────────────────────────────

test.describe('FontFamily — multiple paragraphs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('apply font to first paragraph only', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    // Select only first paragraph text via evaluate
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
    await setFontViaToolbar(page, 'Arial');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');
    // Second paragraph should remain unstyled
    expect(html).toContain('second paragraph</p>');
  });

  test('select all applies font to all paragraphs', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await selectAll(page);
    await setFontViaToolbar(page, 'Verdana');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Verdana');
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');
  });
});

// ─── Combined with other styles ───────────────────────────────────────

test.describe('FontFamily — combined with other marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('font-family with bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    expect(html).toContain('bold text');
    expect(html).toMatch(/strong|font-weight/);
  });

  test('font-family with italic text', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>italic text</em></p>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Tahoma');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Tahoma');
    expect(html).toContain('italic text');
    expect(html).toContain('<em');
  });

  test('font-family combined with font-size on same text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-size: 24px">sized text</span></p>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    const html = await getEditorHTML(page);
    expect(html).toContain('Arial');
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
    expect(html).toContain('sized text');
  });

  test('unset font-family preserves font-size', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Georgia; font-size: 24px">styled text</span></p>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Default');

    const html = await getEditorHTML(page);
    expectNoFontFamily(html);
    expect(html).toContain('font-size');
    expect(html).toContain('24px');
    expect(html).toContain('styled text');
  });
});

// ─── Persistence ──────────────────────────────────────────────────────

test.describe('FontFamily — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('font-family persists after typing more text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_GEORGIA);
    // Click inside styled span and type at the end
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    expect(html).toContain('extra');
  });

  test('undo restores original text without font', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    let html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectNoFontFamily(html);
  });

  test('redo re-applies font', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    await page.keyboard.press(`${modifier}+Z`);
    let html = await getEditorHTML(page);
    expectNoFontFamily(html);

    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────

test.describe('FontFamily — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('applying font with collapsed cursor affects next typed text', async ({ page }) => {
    await setContentAndFocus(page, '<p>text</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    // Set font with collapsed cursor
    await setFontViaToolbar(page, 'Georgia');
    await page.keyboard.type(' new');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');
    expect(html).toContain('new');
  });

  test('font-family on heading text', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2');
    expectFontFamily(html, 'Georgia');
    expect(html).toContain('heading text');
  });

  test('font-family inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, '<blockquote><p>quoted text</p></blockquote>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Tahoma');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Tahoma');
    expect(html).toContain('quoted text');
  });

  test('font-family inside list item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>list item</p></li></ul>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Verdana');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Verdana');
    expect(html).toContain('list item');
  });

  test('font-family does not bleed into adjacent paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<p>first</p><p>second</p>');
    // Select only first paragraph
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
    await setFontViaToolbar(page, 'Georgia');

    const html = await getEditorHTML(page);
    // Second paragraph should not have font-family
    expect(html).toContain('second</p>');
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    // Click on editor body
    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});
