import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

// Toolbar button selectors
const btn = {
  bold: '.dm-toolbar button[aria-label="Bold"]',
  italic: '.dm-toolbar button[aria-label="Italic"]',
  underline: '.dm-toolbar button[aria-label="Underline"]',
  strike: '.dm-toolbar button[aria-label="Strikethrough"]',
  code: '.dm-toolbar button[aria-label="Code"]',
  highlight: '.dm-toolbar button[aria-label="Highlight"]',
  subscript: '.dm-toolbar button[aria-label="Subscript"]',
  superscript: '.dm-toolbar button[aria-label="Superscript"]',
} as const;

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Select all text, type replacement, select all again — ready to apply a mark. */
async function replaceAndSelectAll(page: Page, text: string) {
  const editor = page.locator(editorSelector);
  await editor.click();
  await page.keyboard.press(`${modifier}+a`);
  await page.keyboard.type(text);
  await page.keyboard.press(`${modifier}+a`);
}

/** Select text inside a specific tag element. */
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
}

// ─── Bold ─────────────────────────────────────────────────────────────

test.describe('Inline marks — Bold', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies bold to selected text', async ({ page }) => {
    await replaceAndSelectAll(page, 'make bold');
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>make bold</strong>');
  });

  test('toolbar removes bold (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await selectInsideTag(page, 'strong');
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
    expect(html).toContain('bold text');
  });

  test('active state when cursor is in bold', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold</strong></p>');
    await page.locator(`${editorSelector} strong`).click();

    await expect(page.locator(btn.bold)).toHaveClass(/active/);
  });

  test('inactive state when cursor is in plain text', async ({ page }) => {
    await setContentAndFocus(page, '<p>plain text</p>');
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(btn.bold)).not.toHaveClass(/active/);
  });

  test('Mod-B shortcut applies bold', async ({ page }) => {
    await replaceAndSelectAll(page, 'shortcut bold');
    await page.keyboard.press(`${modifier}+b`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>shortcut bold</strong>');
  });

  test('Mod-B shortcut removes bold', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>remove me</strong></p>');
    await page.locator(`${editorSelector} strong`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press(`${modifier}+b`);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<strong>');
  });

  test('**text** input rule creates bold', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('**hello**');

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>hello</strong>');
  });

  test('bold on partial word selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    // Select "world" only
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 6);
      range.setEnd(p.firstChild, 11);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('hello');
    expect(html).toContain('<strong>world</strong>');
  });
});

// ─── Italic ───────────────────────────────────────────────────────────

test.describe('Inline marks — Italic', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies italic', async ({ page }) => {
    await replaceAndSelectAll(page, 'make italic');
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>make italic</em>');
  });

  test('toolbar removes italic (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>italic text</em></p>');
    await selectInsideTag(page, 'em');
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<em>');
    expect(html).toContain('italic text');
  });

  test('Mod-I shortcut toggles italic', async ({ page }) => {
    await replaceAndSelectAll(page, 'shortcut italic');
    await page.keyboard.press(`${modifier}+i`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>shortcut italic</em>');
  });

  test('*text* input rule creates italic', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('*hello*');

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>hello</em>');
  });

  test('_text_ input rule creates italic', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('_hello_');

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>hello</em>');
  });
});

// ─── Underline ────────────────────────────────────────────────────────

test.describe('Inline marks — Underline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies underline', async ({ page }) => {
    await replaceAndSelectAll(page, 'underline me');
    await page.locator(btn.underline).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<u>underline me</u>');
  });

  test('toolbar removes underline (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><u>underlined</u></p>');
    await selectInsideTag(page, 'u');
    await page.locator(btn.underline).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<u>');
    expect(html).toContain('underlined');
  });

  test('Mod-U shortcut toggles underline', async ({ page }) => {
    await replaceAndSelectAll(page, 'shortcut underline');
    await page.keyboard.press(`${modifier}+u`);

    const html = await getEditorHTML(page);
    expect(html).toContain('<u>shortcut underline</u>');
  });
});

// ─── Strikethrough ────────────────────────────────────────────────────

test.describe('Inline marks — Strikethrough', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies strikethrough', async ({ page }) => {
    await replaceAndSelectAll(page, 'strike me');
    await page.locator(btn.strike).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<s>strike me</s>');
  });

  test('toolbar removes strikethrough (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><s>struck</s></p>');
    await selectInsideTag(page, 's');
    await page.locator(btn.strike).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<s>');
    expect(html).toContain('struck');
  });

  test('~~text~~ input rule creates strikethrough', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('~~hello~~');

    const html = await getEditorHTML(page);
    expect(html).toContain('<s>hello</s>');
  });
});

// ─── Inline Code ──────────────────────────────────────────────────────

test.describe('Inline marks — Code', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies code', async ({ page }) => {
    await replaceAndSelectAll(page, 'code me');
    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>code me</code>');
  });

  test('toolbar removes code (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><code>coded</code></p>');
    await selectInsideTag(page, 'code');
    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<code>');
    expect(html).toContain('coded');
  });

  test('`text` input rule creates code', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('`hello`');

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>hello</code>');
  });

  test('code mark excludes bold (applying code to bold text removes bold)', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p><strong>bold text</strong></p>');
    await selectInsideTag(page, 'strong');
    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>');
    expect(html).not.toContain('<strong>');
  });

  test('code mark excludes italic', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>italic text</em></p>');
    await selectInsideTag(page, 'em');
    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>');
    expect(html).not.toContain('<em>');
  });

  test('bold button is disabled when cursor is in inline code', async ({ page }) => {
    await setContentAndFocus(page, '<p><code>code text</code></p>');
    await page.locator(`${editorSelector} code`).click();

    await expect(page.locator(btn.bold)).toBeDisabled();
  });
});

// ─── Highlight ────────────────────────────────────────────────────────

test.describe('Inline marks — Highlight', () => {
  // Highlight is a dropdown (color picker). Click trigger → click swatch.
  const highlightTrigger = btn.highlight;
  const firstSwatch = '.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-swatch';
  const noHighlight = 'button[aria-label="No highlight"]';

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies highlight via color swatch', async ({ page }) => {
    await replaceAndSelectAll(page, 'highlight me');
    await page.locator(highlightTrigger).click();
    await page.locator(firstSwatch).first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toContain('highlight me');
    expect(html).not.toContain('<mark');
  });

  test('toolbar removes highlight via No highlight button', async ({ page }) => {
    await setContentAndFocus(page, '<p><span style="background-color: #fef08a">highlighted</span></p>');
    await page.locator(`${editorSelector} span`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(highlightTrigger).click();
    await page.locator(noHighlight).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('background-color');
    expect(html).toContain('highlighted');
  });

  test('==text== input rule creates highlight', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('==hello==');

    const html = await getEditorHTML(page);
    expect(html).toContain('background-color');
    expect(html).toContain('hello');
    expect(html).not.toContain('<mark');
  });
});

// ─── Subscript ────────────────────────────────────────────────────────

test.describe('Inline marks — Subscript', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies subscript', async ({ page }) => {
    await replaceAndSelectAll(page, 'sub me');
    await page.locator(btn.subscript).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<sub>sub me</sub>');
  });

  test('toolbar removes subscript (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><sub>subscript</sub></p>');
    await selectInsideTag(page, 'sub');
    await page.locator(btn.subscript).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<sub>');
    expect(html).toContain('subscript');
  });

  test('toggling subscript removes superscript', async ({ page }) => {
    await setContentAndFocus(page, '<p><sup>super</sup></p>');
    await selectInsideTag(page, 'sup');
    await page.locator(btn.subscript).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<sup>');
    expect(html).toContain('<sub>super</sub>');
  });
});

// ─── Superscript ──────────────────────────────────────────────────────

test.describe('Inline marks — Superscript', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar applies superscript', async ({ page }) => {
    await replaceAndSelectAll(page, 'sup me');
    await page.locator(btn.superscript).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<sup>sup me</sup>');
  });

  test('toolbar removes superscript (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, '<p><sup>superscript</sup></p>');
    await selectInsideTag(page, 'sup');
    await page.locator(btn.superscript).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<sup>');
    expect(html).toContain('superscript');
  });

  test('toggling superscript removes subscript', async ({ page }) => {
    await setContentAndFocus(page, '<p><sub>sub</sub></p>');
    await selectInsideTag(page, 'sub');
    await page.locator(btn.superscript).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<sub>');
    expect(html).toContain('<sup>sub</sup>');
  });
});

// ─── Combining marks ─────────────────────────────────────────────────

test.describe('Inline marks — combining marks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bold + italic on same text', async ({ page }) => {
    await replaceAndSelectAll(page, 'bold italic');
    await page.locator(btn.bold).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('bold italic');
  });

  test('bold + underline + italic on same text', async ({ page }) => {
    await replaceAndSelectAll(page, 'triple');
    await page.locator(btn.bold).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.underline).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<u>');
    expect(html).toContain('<em>');
    expect(html).toContain('triple');
  });

  test('bold + strikethrough + highlight', async ({ page }) => {
    await replaceAndSelectAll(page, 'combo');
    await page.locator(btn.bold).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.strike).click();
    await page.keyboard.press(`${modifier}+a`);
    // Highlight is a dropdown — open it and click a swatch
    await page.locator(btn.highlight).click();
    await page.locator('.dm-toolbar-dropdown-wrapper:has(button[aria-label="Highlight"]) .dm-color-swatch').first().click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>');
    expect(html).toContain('<s>');
    expect(html).toContain('background-color');
    expect(html).toContain('combo');
  });

  test('applying code to bold+italic removes both (code is exclusive)', async ({
    page,
  }) => {
    await setContentAndFocus(
      page,
      '<p><strong><em>bold italic</em></strong></p>',
    );
    await page.locator(`${editorSelector} strong`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.code).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<code>');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<em>');
  });
});

// ─── Marks in different contexts ──────────────────────────────────────

test.describe('Inline marks — in different contexts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bold works inside heading', async ({ page }) => {
    await setContentAndFocus(page, '<h1>heading text</h1>');
    await selectInsideTag(page, 'h1');
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>heading text</strong>');
  });

  test('italic works inside heading', async ({ page }) => {
    await setContentAndFocus(page, '<h2>heading text</h2>');
    await selectInsideTag(page, 'h2');
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expect(html).toContain('<em>heading text</em>');
  });

  test('bold works inside blockquote', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<blockquote><p>quote text</p></blockquote>',
    );
    await selectInsideTag(page, 'blockquote p');
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<strong>quote text</strong>');
  });

  test('underline works inside list item', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>list text</p></li></ul>',
    );
    await selectInsideTag(page, 'li p');
    await page.locator(btn.underline).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<u>list text</u>');
  });

  test('bold button is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<pre><code>code block text</code></pre>',
    );
    // Click inside the code block
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(btn.bold)).toBeDisabled();
  });

  test('italic button is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<pre><code>code block text</code></pre>',
    );
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(btn.italic)).toBeDisabled();
  });

  test('underline button is disabled inside code block', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<pre><code>code block text</code></pre>',
    );
    await page.locator(`${editorSelector} pre code`).click();

    await expect(page.locator(btn.underline)).toBeDisabled();
  });

  test('highlight dropdown is not active inside code block', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<pre><code>code block text</code></pre>',
    );
    await page.locator(`${editorSelector} pre code`).click();

    // Highlight is a dropdown trigger — verify it's not showing as active
    const trigger = page.locator(btn.highlight);
    await expect(trigger).not.toHaveClass(/dm-toolbar-button--active/);
  });

  test('marks work inside ordered list item', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ol><li><p>ordered item</p></li></ol>',
    );
    await selectInsideTag(page, 'li p');
    await page.locator(btn.strike).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('<s>ordered item</s>');
  });
});

// ─── Marks survive editing operations ─────────────────────────────────

test.describe('Inline marks — editing operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bold survives paragraph split (Enter)', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p><strong>ABCDEF</strong></p>',
    );
    // Place cursor at position 3 inside strong
    await page.evaluate((sel) => {
      const strong = document.querySelector(sel + ' strong');
      if (!strong?.firstChild) return;
      const range = document.createRange();
      range.setStart(strong.firstChild, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);

    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    // Both parts should remain bold
    const strongCount = (html.match(/<strong>/g) || []).length;
    expect(strongCount).toBe(2);
    expect(html).toContain('ABC');
    expect(html).toContain('DEF');
  });

  test('mark applies with cursor (no selection) then typing', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p>hello</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    // Toggle bold on with no selection
    await page.locator(btn.bold).click();
    await page.keyboard.type('bold');

    const html = await getEditorHTML(page);
    expect(html).toContain('hello');
    expect(html).toContain('<strong>bold</strong>');
  });

  test('italic mark at start of paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    // Select "hello"
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, 5);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.italic).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<em>hello</em>');
    expect(html).toContain(' world');
  });

  test('mark at end of paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<p>hello world</p>');
    // Select "world"
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 6);
      range.setEnd(p.firstChild, 11);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.underline).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('hello ');
    expect(html).toContain('<u>world</u>');
  });

  test('marks survive Backspace join of paragraphs', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p><strong>bold</strong></p><p><em>italic</em></p>',
    );
    // Place cursor at start of second paragraph
    await page.evaluate(({ sel }) => {
      const ps = document.querySelectorAll(sel + ' p');
      const p2 = ps[1];
      if (!p2) return;
      const textNode = p2.querySelector('em')?.firstChild || p2.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, { sel: editorSelector });

    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    const pCount = (html.match(/<p>/g) || []).length;
    expect(pCount).toBe(1);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  test('select all and apply mark to multi-paragraph content', async ({
    page,
  }) => {
    await setContentAndFocus(
      page,
      '<p>first paragraph</p><p>second paragraph</p>',
    );
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.press(`${modifier}+a`);
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>first paragraph</strong>');
    expect(html).toContain('<strong>second paragraph</strong>');
  });
});
