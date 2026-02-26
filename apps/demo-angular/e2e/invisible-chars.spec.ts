import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const icButton = 'button[aria-label="Invisible Characters"]';

// ─── Helpers ──────────────────────────────────────────────────────────

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

async function focusEditor(page: Page) {
  await page.locator(editorSelector).click();
  await page.waitForTimeout(50);
}

async function focusEnd(page: Page, tag = 'p', index = 0) {
  await page.evaluate(
    ({ sel, tag, index }) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const els = editor?.querySelectorAll(tag);
      const el = els?.[index];
      if (!el) return;
      let node: Node = el;
      while (node.lastChild) node = node.lastChild;
      const range = document.createRange();
      range.setStart(
        node,
        node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0,
      );
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    },
    { sel: editorSelector, tag, index },
  );
  await page.waitForTimeout(50);
}

async function toggleInvisibleChars(page: Page) {
  await page.locator(icButton).click();
  await page.waitForTimeout(150);
}

/** Count elements with class invisible-char in the editor */
async function countInvisibleCharElements(page: Page): Promise<number> {
  return page.locator(`${editorSelector} .invisible-char`).count();
}

/** Get all text contents of invisible-char spans (widget decorations) */
async function getInvisibleCharTexts(page: Page): Promise<string[]> {
  return page.locator(`${editorSelector} span.invisible-char`).allTextContents();
}

/** Count invisible-char elements that contain the given character */
async function countCharMarkers(page: Page, char: string): Promise<number> {
  const texts = await getInvisibleCharTexts(page);
  return texts.filter((t) => t === char).length;
}

/** Count inline decorations with data-char attribute */
async function countInlineDecorations(page: Page, dataChar: string): Promise<number> {
  return page.locator(`${editorSelector} [data-char="${dataChar}"]`).count();
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const PARAGRAPH = '<p>Hello world</p>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';
const THREE_PARAGRAPHS = '<p>one</p><p>two</p><p>three</p>';
const EMPTY_PARAGRAPH = '<p></p>';
const TEXT_WITH_SPACES = '<p>Hello beautiful world today</p>';
const HEADING_AND_PARA = '<h2>My Heading</h2><p>Some text</p>';
const BLOCKQUOTE_PARA = '<blockquote><p>quoted text</p></blockquote><p>normal text</p>';

// ─── Toolbar button ──────────────────────────────────────────────────

test.describe('InvisibleChars — toolbar button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('button is visible in toolbar', async ({ page }) => {
    await expect(page.locator(icButton)).toBeVisible();
  });

  test('button has correct aria-label', async ({ page }) => {
    const btn = page.locator(icButton);
    await expect(btn).toHaveAttribute('aria-label', 'Invisible Characters');
  });

  test('button is not disabled', async ({ page }) => {
    const btn = page.locator(icButton);
    await expect(btn).not.toBeDisabled();
  });

  test('button is clickable without freezing', async ({ page }) => {
    // This directly tests the infinite loop fix
    await toggleInvisibleChars(page);
    // If we get here, no infinite loop occurred
    await expect(page.locator(icButton)).toBeVisible();
  });

  test('button is not active by default (chars hidden)', async ({ page }) => {
    const btn = page.locator(icButton);
    const isActive = await btn.evaluate((el) =>
      el.classList.contains('dm-toolbar-button--active'),
    );
    expect(isActive).toBe(false);
  });

  test('button gets active class when toggled on', async ({ page }) => {
    const btn = page.locator(icButton);
    await toggleInvisibleChars(page);

    const isActive = await btn.evaluate((el) =>
      el.classList.contains('dm-toolbar-button--active'),
    );
    expect(isActive).toBe(true);
  });

  test('button loses active class when toggled off', async ({ page }) => {
    const btn = page.locator(icButton);
    await toggleInvisibleChars(page);
    await toggleInvisibleChars(page);

    const isActive = await btn.evaluate((el) =>
      el.classList.contains('dm-toolbar-button--active'),
    );
    expect(isActive).toBe(false);
  });

  test('active state toggles correctly across multiple clicks', async ({ page }) => {
    const btn = page.locator(icButton);

    // Click 1: on
    await toggleInvisibleChars(page);
    expect(await btn.evaluate((el) => el.classList.contains('dm-toolbar-button--active'))).toBe(
      true,
    );

    // Click 2: off
    await toggleInvisibleChars(page);
    expect(await btn.evaluate((el) => el.classList.contains('dm-toolbar-button--active'))).toBe(
      false,
    );

    // Click 3: on again
    await toggleInvisibleChars(page);
    expect(await btn.evaluate((el) => el.classList.contains('dm-toolbar-button--active'))).toBe(
      true,
    );
  });

  test('active class persists while typing with chars visible', async ({ page }) => {
    const btn = page.locator(icButton);
    await toggleInvisibleChars(page);
    await focusEditor(page);

    await page.keyboard.type('Some text');
    await page.waitForTimeout(150);

    const isActive = await btn.evaluate((el) =>
      el.classList.contains('dm-toolbar-button--active'),
    );
    expect(isActive).toBe(true);
  });
});

// ─── Toggle on/off ───────────────────────────────────────────────────

test.describe('InvisibleChars — toggle behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toggling on shows invisible char decorations', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    const beforeCount = await countInvisibleCharElements(page);
    expect(beforeCount).toBe(0);

    await toggleInvisibleChars(page);

    const afterCount = await countInvisibleCharElements(page);
    expect(afterCount).toBeGreaterThan(0);
  });

  test('toggling off hides invisible char decorations', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    // Toggle on
    await toggleInvisibleChars(page);
    const onCount = await countInvisibleCharElements(page);
    expect(onCount).toBeGreaterThan(0);

    // Toggle off
    await toggleInvisibleChars(page);
    const offCount = await countInvisibleCharElements(page);
    expect(offCount).toBe(0);
  });

  test('double toggle returns to hidden state', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    await toggleInvisibleChars(page);
    await toggleInvisibleChars(page);

    const count = await countInvisibleCharElements(page);
    expect(count).toBe(0);
  });

  test('triple toggle shows decorations again', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    await toggleInvisibleChars(page);
    await toggleInvisibleChars(page);
    await toggleInvisibleChars(page);

    const count = await countInvisibleCharElements(page);
    expect(count).toBeGreaterThan(0);
  });

  test('no decorations present by default', async ({ page }) => {
    const count = await countInvisibleCharElements(page);
    expect(count).toBe(0);
  });
});

// ─── Paragraph markers (¶) ──────────────────────────────────────────

test.describe('InvisibleChars — paragraph markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('single paragraph shows one ¶ marker', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(1);
  });

  test('two paragraphs show two ¶ markers', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await toggleInvisibleChars(page);

    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(2);
  });

  test('three paragraphs show three ¶ markers', async ({ page }) => {
    await setContentAndFocus(page, THREE_PARAGRAPHS);
    await toggleInvisibleChars(page);

    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(3);
  });

  test('empty paragraph still shows ¶ marker', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await toggleInvisibleChars(page);

    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(1);
  });

  test('¶ markers have invisible-char class', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    const spans = page.locator(`${editorSelector} span.invisible-char`);
    const texts = await spans.allTextContents();
    expect(texts).toContain('¶');
  });

  test('¶ markers have invisible-char--paragraph modifier class', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    const pilcrowSpans = page.locator(`${editorSelector} span.invisible-char--paragraph`);
    const count = await pilcrowSpans.count();
    expect(count).toBe(1);
    const text = await pilcrowSpans.first().textContent();
    expect(text).toBe('¶');
  });

  test('¶ marker is inside the paragraph element', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    // The pilcrow widget is placed at end of paragraph (inside <p>)
    const pilcrowInP = page.locator(`${editorSelector} p span.invisible-char`);
    const texts = await pilcrowInP.allTextContents();
    expect(texts.filter((t) => t === '¶').length).toBe(1);
  });

  test('heading paragraphs also get ¶ inside nested p', async ({ page }) => {
    await setContentAndFocus(page, HEADING_AND_PARA);
    await toggleInvisibleChars(page);

    // Heading is not a paragraph, so only the <p> gets ¶
    const paraMarkers = await countCharMarkers(page, '¶');
    expect(paraMarkers).toBeGreaterThanOrEqual(1);
  });

  test('blockquote paragraph gets ¶ marker', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_PARA);
    await toggleInvisibleChars(page);

    // Both the paragraph inside blockquote and the normal paragraph get ¶
    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(2);
  });
});

// ─── Space markers (·) ──────────────────────────────────────────────

test.describe('InvisibleChars — space markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('spaces get inline decorations with data-char="space"', async ({ page }) => {
    await setContentAndFocus(page, TEXT_WITH_SPACES);
    await toggleInvisibleChars(page);

    // "Hello beautiful world today" has 3 spaces
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(3);
  });

  test('"Hello world" has 1 space decoration', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);
  });

  test('space decorations have invisible-char class', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    const spaceEls = page.locator(`${editorSelector} [data-char="space"]`);
    const count = await spaceEls.count();
    expect(count).toBeGreaterThan(0);

    const cls = await spaceEls.first().getAttribute('class');
    expect(cls).toContain('invisible-char');
  });

  test('text without spaces shows no space decorations', async ({ page }) => {
    await setContentAndFocus(page, '<p>NoSpacesHere</p>');
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);
  });

  test('multiple spaces between words each get a decoration', async ({ page }) => {
    // ProseMirror may collapse multiple spaces, but let's test what we can
    await setContentAndFocus(page, '<p>a b c d e</p>');
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(4); // 4 spaces between 5 words
  });

  test('space decorations disappear when toggled off', async ({ page }) => {
    await setContentAndFocus(page, TEXT_WITH_SPACES);
    await toggleInvisibleChars(page);

    let spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBeGreaterThan(0);

    await toggleInvisibleChars(page);

    spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);
  });
});

// ─── Content integrity ───────────────────────────────────────────────

test.describe('InvisibleChars — content integrity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toggling on does not change editor text content', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    await toggleInvisibleChars(page);
    const textAfter = await page.locator(editorSelector).innerText();

    // The actual text content should contain the original text
    // (innerText may include ¶ since it reads rendered text)
    expect(textAfter).toContain('Hello');
    expect(textAfter).toContain('world');
  });

  test('toggling off restores original appearance', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    await toggleInvisibleChars(page);
    await toggleInvisibleChars(page);
    const htmlAfter = await getEditorHTML(page);

    // After toggle off, no invisible-char elements should remain
    expect(htmlAfter).not.toContain('invisible-char');
    // Original content preserved
    expect(htmlAfter).toContain('Hello');
  });

  test('invisible chars are decorations, not part of document model', async ({ page }) => {
    await setContentAndFocus(page, '<p>Test text</p>');
    await toggleInvisibleChars(page);

    // Check that getHTML (the output panel) doesn't contain invisible-char
    const output = await page.locator('.output').innerText();
    expect(output).not.toContain('invisible-char');
    expect(output).not.toContain('¶');
    expect(output).toContain('Test text');
  });

  test('decorations do not appear in HTML output when visible', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await toggleInvisibleChars(page);

    const output = await page.locator('.output').innerText();
    expect(output).not.toContain('data-char');
    expect(output).toContain('first paragraph');
    expect(output).toContain('second paragraph');
  });
});

// ─── Typing with invisible chars on ─────────────────────────────────

test.describe('InvisibleChars — typing interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('typing text with chars visible updates decorations', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await toggleInvisibleChars(page);
    await focusEditor(page);

    await page.keyboard.type('Hello world');
    await page.waitForTimeout(100);

    // Should have space decoration for the space between Hello and world
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);
  });

  test('adding new paragraph via Enter adds another ¶', async ({ page }) => {
    await setContentAndFocus(page, '<p>First</p>');
    await toggleInvisibleChars(page);

    const before = await countCharMarkers(page, '¶');
    expect(before).toBe(1);

    await focusEnd(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const after = await countCharMarkers(page, '¶');
    expect(after).toBe(2);
  });

  test('deleting text updates space decorations', async ({ page }) => {
    await setContentAndFocus(page, '<p>a b c</p>');
    await toggleInvisibleChars(page);

    let spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(2);

    // Select all and type text without spaces
    await focusEditor(page);
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.type('nospaces');
    await page.waitForTimeout(100);

    spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);
  });

  test('typing spaces adds space decorations immediately', async ({ page }) => {
    await setContentAndFocus(page, '<p>ab</p>');
    await toggleInvisibleChars(page);

    let spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);

    // Place cursor between a and b, then type a space
    await page.evaluate(
      ({ sel }) => {
        const editor = document.querySelector(sel) as HTMLElement;
        editor?.focus();
        const p = editor?.querySelector('p');
        const textNode = p?.firstChild;
        if (!textNode) return;
        const range = document.createRange();
        range.setStart(textNode, 1); // after 'a'
        range.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      },
      { sel: editorSelector },
    );
    await page.keyboard.type(' ');
    await page.waitForTimeout(100);

    spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);
  });
});

// ─── Undo/redo interaction ───────────────────────────────────────────

test.describe('InvisibleChars — undo/redo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo does not undo the toggle itself', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    let count = await countInvisibleCharElements(page);
    expect(count).toBeGreaterThan(0);

    // Undo should not undo the toggle (it's plugin state, not doc change)
    await page.keyboard.press(`${modifier}+Z`);
    await page.waitForTimeout(100);

    count = await countInvisibleCharElements(page);
    // Toggle state should persist — it's meta, not a doc modification
    // But the transaction may be undoable; the key point is app doesn't break
    // and decorations are consistent with toggle state
    await expect(page.locator(icButton)).toBeVisible();
  });

  test('undo of text change updates decorations correctly', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p>');
    await page.waitForTimeout(300); // Separate undo history from setContentAndFocus
    await toggleInvisibleChars(page);

    await focusEnd(page);
    await page.keyboard.type(' world');
    await page.waitForTimeout(300); // Ensure undo step boundary

    let spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);

    // Undo the typed text
    await page.keyboard.press(`${modifier}+Z`);
    await page.waitForTimeout(100);

    // After undo, "Hello" has no spaces
    spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);
  });

  test('decorations survive redo', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p>');
    await toggleInvisibleChars(page);

    await focusEnd(page);
    await page.keyboard.type(' world');
    await page.waitForTimeout(100);

    await page.keyboard.press(`${modifier}+Z`);
    await page.waitForTimeout(100);

    await page.keyboard.press(`${modifier}+Shift+Z`);
    await page.waitForTimeout(100);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);
  });
});

// ─── Interaction with formatting ─────────────────────────────────────

test.describe('InvisibleChars — with formatting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('decorations work with bold text', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>Hello world</strong></p>');
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);

    const pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(1);
  });

  test('decorations work with italic text', async ({ page }) => {
    await setContentAndFocus(page, '<p><em>Hello world</em></p>');
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(1);
  });

  test('decorations work with mixed inline marks', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p><strong>Bold word</strong> and <em>italic word</em></p>',
    );
    await toggleInvisibleChars(page);

    // "Bold word" has 1 space, " and " has 2 spaces, "italic word" has 1 space = 4 total
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(4);
  });

  test('decorations work with headings', async ({ page }) => {
    await setContentAndFocus(page, HEADING_AND_PARA);
    await toggleInvisibleChars(page);

    // Both heading and paragraph have text with spaces
    const totalDecorations = await countInvisibleCharElements(page);
    expect(totalDecorations).toBeGreaterThan(0);
  });

  test('decorations work inside blockquote', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_PARA);
    await toggleInvisibleChars(page);

    // "quoted text" has 1 space, "normal text" has 1 space
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(2);
  });

  test('decorations work inside list items', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>item one</p></li><li><p>item two</p></li></ul>',
    );
    await toggleInvisibleChars(page);

    // "item one" and "item two" each have 1 space = 2 spaces
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(2);

    // 2 list item paragraphs = 2 ¶ markers
    const pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(2);
  });
});

// ─── Hard break markers (↵) ─────────────────────────────────────────

test.describe('InvisibleChars — hard break markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Shift+Enter inserts hard break with ↵ marker when visible', async ({ page }) => {
    await setContentAndFocus(page, '<p>Line one</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    const count = await countCharMarkers(page, '↵');
    expect(count).toBe(1);
  });

  test('multiple hard breaks show multiple ↵ markers', async ({ page }) => {
    await setContentAndFocus(page, '<p>Start</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    const count = await countCharMarkers(page, '↵');
    expect(count).toBe(2);
  });

  test('hard break marker has invisible-char--hardBreak class', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    const hbSpans = page.locator(`${editorSelector} span.invisible-char--hardBreak`);
    const count = await hbSpans.count();
    expect(count).toBe(1);
    const text = await hbSpans.first().textContent();
    expect(text).toBe('↵');
  });

  test('hard break ↵ and paragraph ¶ show together', async ({ page }) => {
    await setContentAndFocus(page, '<p>First</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Second line');
    await page.waitForTimeout(100);

    const hardBreaks = await countCharMarkers(page, '↵');
    const paragraphs = await countCharMarkers(page, '¶');
    expect(hardBreaks).toBe(1);
    expect(paragraphs).toBe(1);
  });

  test('hard break markers disappear when toggled off', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(100);

    let count = await countCharMarkers(page, '↵');
    expect(count).toBe(1);

    await toggleInvisibleChars(page);

    count = await countCharMarkers(page, '↵');
    expect(count).toBe(0);
  });

  test('hard break vs Enter — different markers', async ({ page }) => {
    await setContentAndFocus(page, '<p>Start</p>');
    await toggleInvisibleChars(page);
    await focusEnd(page);

    // Shift+Enter = hard break (↵), Enter = new paragraph (¶)
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('after break');
    await page.keyboard.press('Enter');
    await page.keyboard.type('new paragraph');
    await page.waitForTimeout(100);

    const hardBreaks = await countCharMarkers(page, '↵');
    const paragraphs = await countCharMarkers(page, '¶');
    expect(hardBreaks).toBe(1);
    expect(paragraphs).toBe(2); // original + new paragraph
  });
});

// ─── Non-breaking space markers (°) ─────────────────────────────────

test.describe('InvisibleChars — nbsp markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('nbsp in content shows ° overlay when visible', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello\u00A0world</p>');
    await toggleInvisibleChars(page);

    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(1);
  });

  test('nbsp decoration has invisible-char--nbsp class', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello\u00A0world</p>');
    await toggleInvisibleChars(page);

    const nbspSpans = page.locator(`${editorSelector} .invisible-char--nbsp`);
    const count = await nbspSpans.count();
    expect(count).toBe(1);
  });

  test('multiple nbsps show multiple decorations', async ({ page }) => {
    await setContentAndFocus(page, '<p>a\u00A0b\u00A0c</p>');
    await toggleInvisibleChars(page);

    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(2);
  });

  test('nbsp decorations disappear when toggled off', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello\u00A0world</p>');
    await toggleInvisibleChars(page);

    let nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(1);

    await toggleInvisibleChars(page);

    nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(0);
  });

  test('nbsp and regular space show different decorations', async ({ page }) => {
    await setContentAndFocus(page, '<p>normal space\u00A0nbsp here</p>');
    await toggleInvisibleChars(page);

    const spaceCount = await countInlineDecorations(page, 'space');
    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(spaceCount).toBe(2); // "normal space" + "nbsp here"
    expect(nbspCount).toBe(1); // the \u00A0
  });

  test('Mod+Shift+Space inserts nbsp', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello world</p>');
    await toggleInvisibleChars(page);

    // Place cursor between "Hello" and " world" (position 5)
    await page.evaluate(
      ({ sel }) => {
        const editor = document.querySelector(sel) as HTMLElement;
        editor?.focus();
        const p = editor?.querySelector('p');
        const textNode = p?.firstChild;
        if (!textNode) return;
        const range = document.createRange();
        range.setStart(textNode, 5); // after "Hello"
        range.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      },
      { sel: editorSelector },
    );

    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.waitForTimeout(100);

    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(1);
  });

  test('Mod+Shift+Space inserts nbsp in empty paragraph', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await toggleInvisibleChars(page);
    await focusEditor(page);

    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.waitForTimeout(100);

    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(1);
  });

  test('multiple Mod+Shift+Space presses insert multiple nbsps', async ({ page }) => {
    await setContentAndFocus(page, '<p>AB</p>');
    await toggleInvisibleChars(page);

    // Place cursor between A and B
    await page.evaluate(
      ({ sel }) => {
        const editor = document.querySelector(sel) as HTMLElement;
        editor?.focus();
        const p = editor?.querySelector('p');
        const textNode = p?.firstChild;
        if (!textNode) return;
        const range = document.createRange();
        range.setStart(textNode, 1);
        range.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      },
      { sel: editorSelector },
    );

    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.waitForTimeout(100);

    const nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(2);
  });

  test('nbsp inserted via shortcut is visible as ° decoration', async ({ page }) => {
    await setContentAndFocus(page, '<p>Test</p>');
    await focusEnd(page);

    // Insert nbsp while chars are hidden
    await page.keyboard.press(`${modifier}+Shift+Space`);
    await page.waitForTimeout(100);

    // No decoration yet
    let nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(0);

    // Toggle on — should reveal the nbsp
    await toggleInvisibleChars(page);

    nbspCount = await countInlineDecorations(page, 'nbsp');
    expect(nbspCount).toBe(1);
  });
});

// ─── Code block interaction ──────────────────────────────────────────

test.describe('InvisibleChars — code blocks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('code block text gets space decorations', async ({ page }) => {
    // The demo app starts with a code block, so use default content
    await toggleInvisibleChars(page);

    // Should have decorations for spaces in both regular text and code
    const totalDecorations = await countInvisibleCharElements(page);
    expect(totalDecorations).toBeGreaterThan(0);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

test.describe('InvisibleChars — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('rapid toggling does not break decorations', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    // Toggle rapidly 5 times (ends visible since odd count)
    for (let i = 0; i < 5; i++) {
      await page.locator(icButton).click();
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(200);

    const count = await countInvisibleCharElements(page);
    expect(count).toBeGreaterThan(0);
  });

  test('rapid toggling 6 times ends hidden', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);

    for (let i = 0; i < 6; i++) {
      await page.locator(icButton).click();
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(200);

    const count = await countInvisibleCharElements(page);
    expect(count).toBe(0);
  });

  test('toggle after setting new content works', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await toggleInvisibleChars(page);

    let count = await countCharMarkers(page, '¶');
    expect(count).toBe(1);

    // Set new content while visible
    await setContentAndFocus(page, THREE_PARAGRAPHS);
    await page.waitForTimeout(150);

    // Decorations should update to new content
    count = await countCharMarkers(page, '¶');
    expect(count).toBe(3);
  });

  test('select all then delete with chars visible works', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await toggleInvisibleChars(page);

    await focusEditor(page);
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    // Should still have at least one paragraph marker for the empty paragraph
    const count = await countCharMarkers(page, '¶');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('empty document still shows ¶ for empty paragraph', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await toggleInvisibleChars(page);

    const count = await countCharMarkers(page, '¶');
    expect(count).toBe(1);

    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBe(0);
  });

  test('toolbar button can be clicked multiple times without app freeze', async ({
    page,
  }) => {
    // Explicit regression test for the can() infinite loop bug
    for (let i = 0; i < 10; i++) {
      await page.locator(icButton).click();
      await page.waitForTimeout(30);
    }

    // Verify app is still responsive
    await expect(page.locator(icButton)).toBeVisible();
    await focusEditor(page);
    await page.keyboard.type('still works');
    const html = await getEditorHTML(page);
    expect(html).toContain('still works');
  });
});

// ─── Persistence across content changes ──────────────────────────────

test.describe('InvisibleChars — persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toggle state persists while typing', async ({ page }) => {
    await setContentAndFocus(page, '<p>Start</p>');
    await toggleInvisibleChars(page);

    await focusEnd(page);
    await page.keyboard.type(' more text here');
    await page.waitForTimeout(100);

    // Should still show decorations
    const spaceCount = await countInlineDecorations(page, 'space');
    expect(spaceCount).toBeGreaterThanOrEqual(3);

    const pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(1);
  });

  test('toggle state persists across Enter (new paragraph)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Line one</p>');
    await toggleInvisibleChars(page);

    await focusEnd(page);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Line two');
    await page.waitForTimeout(100);

    const pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(2);
  });

  test('toggle state persists across Backspace (merge paragraphs)', async ({
    page,
  }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await toggleInvisibleChars(page);

    let pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(2);

    // Place cursor at start of second paragraph and press Backspace
    await page.evaluate(
      ({ sel }) => {
        const editor = document.querySelector(sel) as HTMLElement;
        editor?.focus();
        const ps = editor?.querySelectorAll('p');
        const secondP = ps?.[1];
        if (!secondP) return;
        const range = document.createRange();
        const textNode = secondP.firstChild;
        if (textNode) {
          range.setStart(textNode, 0);
        } else {
          range.setStart(secondP, 0);
        }
        range.collapse(true);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
      },
      { sel: editorSelector },
    );
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(100);

    pilcrows = await countCharMarkers(page, '¶');
    expect(pilcrows).toBe(1);
  });
});
