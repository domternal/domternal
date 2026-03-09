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

/** Check that the HTML contains the given font name in a font-family declaration */
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

  test('dropdown contains 8 font items', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const items = panel.locator('.dm-toolbar-dropdown-item');
    await expect(items).toHaveCount(8);
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
  });

  test('dropdown panel has text displayMode', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toHaveAttribute('data-display-mode', 'text');
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
});

// ─── Dynamic label trigger ────────────────────────────────────────────

test.describe('FontFamily — dynamicLabel trigger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('trigger shows icon (Aa) when no font is set', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    // No inline font-family → icon fallback (Aa SVG)
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toBeVisible();
    const svg = triggerLabel.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('trigger shows "Arial" when cursor is in Arial text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await page.locator(`${editorSelector} span`).click();

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Arial');
  });

  test('trigger shows "Georgia" when cursor is in Georgia text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_GEORGIA);
    await page.locator(`${editorSelector} span`).click();

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Georgia');
  });

  test('trigger shows "Courier New" when cursor is in Courier New text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_COURIER);
    await page.locator(`${editorSelector} span`).click();

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Courier New');
  });

  test('trigger updates when moving between styled and unstyled text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Arial">styled</span> plain</p>');

    // Click on styled text
    await page.locator(`${editorSelector} span`).click();
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Arial');

    // Click at end of plain text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      const p = editor?.querySelector('p');
      const textNode = p?.lastChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      (editor as HTMLElement)?.focus();
    }, editorSelector);
    await page.waitForTimeout(100);

    // Should revert to icon (Aa SVG) — no inline font on plain text
    const svg = triggerLabel.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('trigger label updates after applying font via toolbar', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Tahoma');

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Tahoma');
  });

  test('trigger does not have active class (dynamicLabel replaces active state)', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await page.locator(`${editorSelector} span`).click();

    await expect(page.locator(dropdownTrigger)).not.toHaveClass(/active/);
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

// ─── Unset font (via command) ────────────────────────────────────────

test.describe('FontFamily — unset via command', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('unsetFontFamily command removes font-family from text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expectNoFontFamily(html);
    expect(html).toContain('arial text');
  });

  test('unsetFontFamily removes span wrapper when no other styles', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH_ARIAL);
    await selectAll(page);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<span');
  });

  test('unset after setting via toolbar removes font-family', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await selectAll(page);
    await setFontViaToolbar(page, 'Georgia');

    let html = await getEditorHTML(page);
    expectFontFamily(html, 'Georgia');

    // Re-focus and select all, then unset via command
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

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

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

// ─── Active state in dropdown ─────────────────────────────────────────

test.describe('FontFamily — active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
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

  test('no item active for unstyled text', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const activeItems = panel.locator('.dm-toolbar-dropdown-item--active');
    await expect(activeItems).toHaveCount(0);
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
    await setContentAndFocus(page, '<p><span style="font-family: \'Times New Roman\'">quoted font</span></p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('Times New Roman');
    expect(html).toContain('quoted font');
  });
});

// ─── Custom HTML — no validation (any font accepted) ─────────────────

test.describe('FontFamily — custom HTML (any font accepted)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('accepts font-family not in configured list (Papyrus)', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Papyrus">custom font</span></p>');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Papyrus');
    expect(html).toContain('custom font');
  });

  test('accepts Comic Sans MS from pasted HTML', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: \'Comic Sans MS\'">funny text</span></p>');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Comic Sans MS');
    expect(html).toContain('funny text');
  });

  test('accepts Impact from pasted HTML', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Impact">impact text</span></p>');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Impact');
    expect(html).toContain('impact text');
  });

  test('unknown font has no active item in dropdown', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Papyrus">custom font</span></p>');
    await page.locator(`${editorSelector} span`).click();
    await page.locator(dropdownTrigger).click();

    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const activeItems = panel.locator('.dm-toolbar-dropdown-item--active');
    await expect(activeItems).toHaveCount(0);
  });

  test('unknown font shows font name on trigger via computedStyleProperty', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus">custom font</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    // Papyrus is not in the configured fontFamilies list, so isActive won't match
    // But computedStyleProperty reads the inline font-family and displays it
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Papyrus');
  });

  test('can overwrite unknown font with known font via toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Papyrus">custom font</span></p>');
    await selectAll(page);
    await setFontViaToolbar(page, 'Arial');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Arial');
    expect(html).not.toContain('Papyrus');
  });

  test('preserves unknown font alongside known font on different text', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="font-family: Papyrus">custom</span> <span style="font-family: Arial">known</span></p>');

    const html = await getEditorHTML(page);
    expectFontFamily(html, 'Papyrus');
    expectFontFamily(html, 'Arial');
  });
});

// ─── computedStyleProperty — dynamic trigger for custom fonts ─────────

test.describe('FontFamily — computedStyleProperty trigger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('trigger shows "Papyrus" for non-list font via inline style', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus">custom</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Papyrus');
  });

  test('trigger shows "Impact" for another non-list font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Impact">impact</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Impact');
  });

  test('trigger shows "Comic Sans MS" for quoted multi-word non-list font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: \'Comic Sans MS\'">funny</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Comic Sans MS');
  });

  test('trigger shows first font when font stack is set via inline style', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus, fantasy">stack</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Papyrus');
  });

  test('trigger shows icon for unstyled text (no inline font-family)', async ({ page }) => {
    await setContentAndFocus(page, '<p>plain text</p>');
    await page.locator(`${editorSelector} p`).click();

    // No inline font-family on <p> → falls through to icon (Aa SVG)
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    const svg = triggerLabel.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('trigger updates from custom font to known font after toolbar change', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus">custom</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Papyrus');

    // Select all and change to Arial
    await page.keyboard.press(`${modifier}+A`);
    await setFontViaToolbar(page, 'Arial');

    await expect(triggerLabel).toHaveText('Arial');
  });

  test('trigger updates from known font to custom font after command', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Arial">text</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Arial');

    // Change to custom font via command
    await page.keyboard.press(`${modifier}+A`);
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.setFontFamily('Papyrus');
    });
    await page.waitForTimeout(200);

    // Re-position cursor inside the text to read inline style
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.focus(3);
    });
    await page.waitForTimeout(100);

    await expect(triggerLabel).toHaveText('Papyrus');
  });

  test('no dropdown item is active for custom non-list font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Impact">text</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    // Trigger shows "Impact" but no dropdown item highlighted
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Impact');

    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    const activeItems = panel.locator('.dm-toolbar-dropdown-item--active');
    await expect(activeItems).toHaveCount(0);
  });

  test('overwriting custom font with known font shows active in dropdown', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus">text</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    await page.keyboard.press(`${modifier}+A`);
    await setFontViaToolbar(page, 'Georgia');

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Georgia');

    // Georgia should now be active in dropdown
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel.locator('button[aria-label="Georgia"]')).toHaveClass(/active/);
  });

  test('trigger shows icon for heading text (no inline font-family)', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await page.locator(`${editorSelector} h2`).click();

    // Heading has no inline font-family → icon
    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    const svg = triggerLabel.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('trigger shows font name for heading with explicit font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<h2><span style="font-family: Georgia">styled heading</span></h2>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Georgia');
  });

  test('trigger reverts from font name to icon after unsetting font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Papyrus">text</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Papyrus');

    // Unset font-family
    await page.keyboard.press(`${modifier}+A`);
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

    // Should revert to icon
    const svg = triggerLabel.locator('svg');
    await expect(svg).toBeVisible();
  });

  test('trigger shows "Test" for custom font name from demo content', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: Test">test font</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Test');
  });

  test('trigger shows "Lucida Console" for monospace custom font', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) {
        comp.editor.setContent('<p><span style="font-family: \'Lucida Console\'">mono</span></p>', false);
        comp.editor.commands.focus(3);
      }
    });
    await page.waitForTimeout(200);

    const triggerLabel = page.locator(dropdownTrigger + ' .dm-toolbar-trigger-label');
    await expect(triggerLabel).toHaveText('Lucida Console');
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
    expect(html).toContain('world');
    const spans = html.match(/<span[^>]*font-family[^>]*>/g);
    expect(spans).toHaveLength(1);
  });

  test('apply different fonts to different paragraphs', async ({ page }) => {
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
    await setFontViaToolbar(page, 'Arial');

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

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands.unsetFontFamily();
    });
    await page.waitForTimeout(100);

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
    expect(html).toContain('second</p>');
  });

  test('clicking outside dropdown closes it', async ({ page }) => {
    await page.locator(dropdownTrigger).click();
    const panel = page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Font Family"]) .dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    await page.locator(editorSelector).click();
    await expect(panel).not.toBeVisible();
  });
});
