import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const blockquoteBtn = 'button[aria-label="Blockquote"]';

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

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

/** Place cursor at the very end of a code block inside the editor. */
async function focusCodeBlockEnd(page: Page, ancestor = '') {
  await page.evaluate(({ sel, anc }) => {
    const scope = anc
      ? document.querySelector(sel + ' ' + anc)
      : document.querySelector(sel);
    const code = scope?.querySelector('pre code');
    if (!code) return;
    let node: Node = code;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, anc: ancestor });
}

function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>Hello world</p>';
const BLOCKQUOTE = '<blockquote><p>quoted text</p></blockquote>';
const BLOCKQUOTE_MULTI = '<blockquote><p>line one</p><p>line two</p></blockquote>';
const BLOCKQUOTE_THEN_PARA = '<blockquote><p>quoted</p></blockquote><p>after</p>';
const PARA_THEN_BLOCKQUOTE = '<p>before</p><blockquote><p>quoted</p></blockquote>';
const NESTED_BLOCKQUOTE =
  '<blockquote><p>outer</p><blockquote><p>inner</p></blockquote></blockquote>';

const BLOCKQUOTE_WITH_LIST =
  '<blockquote><p>intro</p><ul><li><p>item 1</p></li><li><p>item 2</p></li></ul></blockquote>';
const BLOCKQUOTE_WITH_OL =
  '<blockquote><p>intro</p><ol><li><p>first</p></li><li><p>second</p></li></ol></blockquote>';

const LIST_WITH_BLOCKQUOTE =
  '<ul><li><p>item</p><blockquote><p>quoted inside list</p></blockquote></li></ul>';
const OL_WITH_BLOCKQUOTE =
  '<ol><li><p>item</p><blockquote><p>quoted inside ol</p></blockquote></li></ol>';

const BLOCKQUOTE_WITH_HEADING =
  '<blockquote><h2>Heading in quote</h2><p>paragraph in quote</p></blockquote>';

const BLOCKQUOTE_WITH_CODE =
  '<blockquote><p>before code</p><pre><code>const x = 1;</code></pre></blockquote>';

// ─── Tests ─────────────────────────────────────────────────────────────

test.describe('Blockquote — basic behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // ── Toggle via toolbar button ─────────────────────────────────────────

  test('toolbar button wraps paragraph in blockquote', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('Hello world');
  });

  test('toolbar button toggles blockquote off', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();

    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    expect(html).toContain('quoted text');
  });

  test('toolbar button shows active state inside blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();

    const btn = page.locator(blockquoteBtn);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('toolbar button shows inactive state outside blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE_THEN_PARA);
    await page.locator(`${editorSelector} > p`).click();

    const btn = page.locator(blockquoteBtn);
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  // ── Input rule (> + space) ────────────────────────────────────────────

  test('typing "> " at start of empty paragraph creates blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
  });

  test('typing "> " then text creates blockquote with text', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('> some text');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('some text');
  });

  // ── Content preserved ─────────────────────────────────────────────────

  test('blockquote preserves multiple paragraphs', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_MULTI);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('line one');
    expect(text).toContain('line two');
  });

  test('blockquote renders with border-left styling', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE);

    const bq = page.locator(`${editorSelector} blockquote`);
    await expect(bq).toBeVisible();
    const borderLeft = await bq.evaluate(
      (el) => getComputedStyle(el).borderLeftStyle,
    );
    expect(borderLeft).toBe('solid');
  });

  // ── Enter behavior inside blockquote ──────────────────────────────────

  test('Enter inside blockquote creates new paragraph within blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('new line');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const bqHtml = await page
      .locator(`${editorSelector} blockquote`)
      .innerHTML();
    expect(bqHtml).toContain('quoted text');
    expect(bqHtml).toContain('new line');
  });

  test('Enter on empty paragraph inside blockquote exits blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();
    await page.keyboard.press('End');

    // First Enter: new empty paragraph inside blockquote
    await page.keyboard.press('Enter');
    // Second Enter: exit blockquote (lift out)
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('quoted text');
    // A paragraph should exist outside the blockquote
    const paragraphsOutside = await page
      .locator(`${editorSelector} > p`)
      .count();
    expect(paragraphsOutside).toBeGreaterThanOrEqual(1);
  });

  test('Enter on empty blockquote created via input rule removes it', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    // Create blockquote via input rule
    await page.keyboard.type('> ');
    let html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');

    // Enter on the empty blockquote paragraph should exit/remove it
    await page.keyboard.press('Enter');

    html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
  });

  // ── Backspace at start ────────────────────────────────────────────────

  test('Backspace at start of blockquote lifts content out', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();
    await page.keyboard.press('Home');

    await page.keyboard.press('Backspace');

    const text = await getEditorText(page);
    expect(text).toContain('quoted text');
  });
});

test.describe('Blockquote — nested blockquotes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('nested blockquote renders correctly', async ({ page }) => {
    await setContentAndFocus(page, NESTED_BLOCKQUOTE);

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<blockquote>')).toBe(2);
    const text = await getEditorText(page);
    expect(text).toContain('outer');
    expect(text).toContain('inner');
  });

  test('toggle blockquote on already-blockquoted text toggles off (not nesting)', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE);
    await page.locator(`${editorSelector} blockquote p`).click();

    // toggleBlockquote when inside blockquote should UNWRAP, not nest
    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<blockquote>');
    expect(html).toContain('quoted text');
  });

  test('toggle blockquote on inner nested blockquote unwraps inner level', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_BLOCKQUOTE);
    const innerP = page.locator(`${editorSelector} blockquote blockquote p`);
    await innerP.click();

    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    // Should have removed one level of nesting
    expect(countOccurrences(html, '<blockquote>')).toBe(1);
    const text = await getEditorText(page);
    expect(text).toContain('outer');
    expect(text).toContain('inner');
  });
});

test.describe('Blockquote — with lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // ── List inside blockquote ────────────────────────────────────────────

  test('bullet list inside blockquote renders correctly', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_LIST);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
    const text = await getEditorText(page);
    expect(text).toContain('intro');
    expect(text).toContain('item 1');
    expect(text).toContain('item 2');
  });

  test('ordered list inside blockquote renders correctly', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_OL);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ol>');
    const text = await getEditorText(page);
    expect(text).toContain('intro');
    expect(text).toContain('first');
    expect(text).toContain('second');
  });

  test('Enter in list item inside blockquote creates new list item', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_LIST);
    const lastLi = page
      .locator(`${editorSelector} blockquote ul li`)
      .last();
    await lastLi.click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('item 3');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul>');
    expect(html).toContain('item 3');
    const listItems = await page
      .locator(`${editorSelector} blockquote ul li`)
      .count();
    expect(listItems).toBe(3);
  });

  test('empty list item Enter inside blockquote exits list but stays in blockquote', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_LIST);
    const lastLi = page
      .locator(`${editorSelector} blockquote ul li`)
      .last();
    await lastLi.click();
    await page.keyboard.press('End');

    // First Enter: new empty list item
    await page.keyboard.press('Enter');
    // Second Enter: exit list
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('item 1');
    expect(text).toContain('item 2');
  });

  // ── Blockquote inside list ────────────────────────────────────────────

  test('blockquote inside bullet list item renders correctly', async ({
    page,
  }) => {
    await setContentAndFocus(page, LIST_WITH_BLOCKQUOTE);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('item');
    expect(text).toContain('quoted inside list');
  });

  test('blockquote inside ordered list item renders correctly', async ({
    page,
  }) => {
    await setContentAndFocus(page, OL_WITH_BLOCKQUOTE);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('item');
    expect(text).toContain('quoted inside ol');
  });

  test('toggle blockquote off inside list preserves list structure', async ({
    page,
  }) => {
    await setContentAndFocus(page, LIST_WITH_BLOCKQUOTE);
    const bqP = page.locator(`${editorSelector} blockquote p`);
    await bqP.click();

    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    const text = await getEditorText(page);
    expect(text).toContain('quoted inside list');
  });
});

test.describe('Blockquote — with headings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('heading inside blockquote renders correctly', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_HEADING);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<h2>');
    const text = await getEditorText(page);
    expect(text).toContain('Heading in quote');
    expect(text).toContain('paragraph in quote');
  });

  test('heading inside blockquote preserves heading level', async ({
    page,
  }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_HEADING);

    const h2 = page.locator(`${editorSelector} blockquote h2`);
    await expect(h2).toBeVisible();
    await expect(h2).toContainText('Heading in quote');
  });
});

test.describe('Blockquote — with code block', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('code block inside blockquote renders correctly', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_CODE);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre>');
    const text = await getEditorText(page);
    expect(text).toContain('before code');
    expect(text).toContain('const x = 1;');
  });

  test('typing in code block inside blockquote works', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_WITH_CODE);

    // Use native DOM selection to place cursor at end of code block
    await focusCodeBlockEnd(page, 'blockquote');

    await page.keyboard.press('Enter');
    await page.keyboard.type('const y = 2;');

    const text = await getEditorText(page);
    expect(text).toContain('const x = 1;');
    expect(text).toContain('const y = 2;');
    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre>');
  });
});

test.describe('Blockquote — context before/after', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('paragraph before blockquote is preserved', async ({ page }) => {
    await setContentAndFocus(page, PARA_THEN_BLOCKQUOTE);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('before');
    expect(text).toContain('quoted');
  });

  test('paragraph after blockquote is preserved', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_THEN_PARA);

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('quoted');
    expect(text).toContain('after');
  });

  test('wrapping paragraph between other content preserves structure', async ({
    page,
  }) => {
    await setContentAndFocus(
      page,
      '<p>before</p><p>to quote</p><p>after</p>',
    );
    const paragraphs = page.locator(`${editorSelector} > p`);
    await paragraphs.nth(1).click();

    await page.locator(blockquoteBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<blockquote>');
    const text = await getEditorText(page);
    expect(text).toContain('before');
    expect(text).toContain('to quote');
    expect(text).toContain('after');
  });
});
