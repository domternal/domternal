import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const headingDropdown = 'button[aria-label="Heading"]';

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

/** Place cursor at position 0 of the Nth element matching `tag` inside the editor. */
async function focusStart(page: Page, tag: string, index = 0) {
  await page.evaluate(({ sel, tag, index }) => {
    const els = document.querySelectorAll(sel + ' ' + tag);
    const el = els[index];
    if (!el) return;
    const textNode = el.firstChild;
    const range = document.createRange();
    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
      range.setStart(textNode, 0);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, tag, index });
}

/** Open the heading dropdown and click a menu item by aria-label. */
async function selectHeadingItem(page: Page, label: string) {
  await page.locator(headingDropdown).click();
  await page.locator(`button[aria-label="${label}"]`).click();
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const H1 = '<h1>Heading One</h1>';
const H2 = '<h2>Heading Two</h2>';
const H3 = '<h3>Heading Three</h3>';
const ALL_HEADINGS = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';
const H1_WITH_MARKS = '<h1>Normal <strong>bold</strong> <em>italic</em></h1>';
const PARAGRAPH = '<p>Normal text</p>';

// ─── Tests ─────────────────────────────────────────────────────────────

test.describe('Heading — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('h1 renders correctly', async ({ page }) => {
    await setContentAndFocus(page, H1);

    const h1 = page.locator(`${editorSelector} h1`);
    await expect(h1).toBeVisible();
    await expect(h1).toContainText('Heading One');
  });

  test('h2 renders correctly', async ({ page }) => {
    await setContentAndFocus(page, H2);

    const h2 = page.locator(`${editorSelector} h2`);
    await expect(h2).toBeVisible();
    await expect(h2).toContainText('Heading Two');
  });

  test('h3 renders correctly', async ({ page }) => {
    await setContentAndFocus(page, H3);

    const h3 = page.locator(`${editorSelector} h3`);
    await expect(h3).toBeVisible();
    await expect(h3).toContainText('Heading Three');
  });

  test('all 6 heading levels render', async ({ page }) => {
    await setContentAndFocus(page, ALL_HEADINGS);

    for (let i = 1; i <= 6; i++) {
      const heading = page.locator(`${editorSelector} h${i}`);
      await expect(heading).toBeVisible();
      await expect(heading).toContainText(`H${i}`);
    }
  });

  test('h1 has larger font-size than h2', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Big</h1><h2>Smaller</h2>');

    const h1Size = await page
      .locator(`${editorSelector} h1`)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const h2Size = await page
      .locator(`${editorSelector} h2`)
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h1Size).toBeGreaterThan(h2Size);
  });

  test('heading preserves inline marks', async ({ page }) => {
    await setContentAndFocus(page, H1_WITH_MARKS);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });
});

test.describe('Heading — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('"# " creates h1', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('# ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
  });

  test('"## " creates h2', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('## ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
  });

  test('"### " creates h3', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('### ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h3>');
  });

  test('"# " then typing text creates h1 with text', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('# My Title');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    const text = await getEditorText(page);
    expect(text).toContain('My Title');
  });

  test('"#### " creates h4', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('#### ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h4>');
  });

  test('"####### " (7 hashes) does NOT create heading', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('####### ');

    const html = await getEditorHTML(page);
    expect(html).not.toMatch(/<h\d>/);
    expect(html).toContain('<p>');
  });
});

test.describe('Heading — toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('heading dropdown trigger is visible', async ({ page }) => {
    await expect(page.locator(headingDropdown)).toBeVisible();
  });

  test('clicking dropdown shows heading options', async ({ page }) => {
    await page.locator(headingDropdown).click();

    await expect(page.locator('button[aria-label="Normal text"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Heading 1"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Heading 2"]')).toBeVisible();
    await expect(page.locator('button[aria-label="Heading 3"]')).toBeVisible();
  });

  test('selecting Heading 1 converts paragraph to h1', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await selectHeadingItem(page, 'Heading 1');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('Normal text');
  });

  test('selecting Heading 2 converts paragraph to h2', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await selectHeadingItem(page, 'Heading 2');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expect(html).toContain('Normal text');
  });

  test('selecting Normal text converts heading to paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();

    await selectHeadingItem(page, 'Normal text');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('Heading One');
  });

  test('switching heading levels via dropdown', async ({ page }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();

    await selectHeadingItem(page, 'Heading 3');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<h3>');
    expect(html).toContain('Heading One');
  });

  test('dropdown shows active state for current heading level', async ({
    page,
  }) => {
    await setContentAndFocus(page, H2);
    await page.locator(`${editorSelector} h2`).click();

    await page.locator(headingDropdown).click();

    const h2Item = page.locator('button[aria-label="Heading 2"]');
    await expect(h2Item).toHaveClass(/active/);
  });

  test('dropdown shows active state for paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(headingDropdown).click();

    const paraItem = page.locator('button[aria-label="Normal text"]');
    await expect(paraItem).toHaveClass(/active/);
  });
});

test.describe('Heading — Enter key behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end of heading creates paragraph (not new heading)', async ({
    page,
  }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('<p>');
    const h1Count = await page.locator(`${editorSelector} h1`).count();
    expect(h1Count).toBe(1);
  });

  test('Enter at end + typing goes into paragraph', async ({ page }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('body text');

    const text = await getEditorText(page);
    expect(text).toContain('Heading One');
    expect(text).toContain('body text');
    const lastP = page.locator(`${editorSelector} p`).last();
    await expect(lastP).toContainText('body text');
  });

  test('Enter in middle of heading splits into two headings', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<h1>ABCDEF</h1>');
    // Place cursor at position 3 (after "ABC")
    await page.evaluate((sel) => {
      const h1 = document.querySelector(sel + ' h1');
      if (!h1 || !h1.firstChild) return;
      const range = document.createRange();
      range.setStart(h1.firstChild, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);

    await page.keyboard.press('Enter');

    const text = await getEditorText(page);
    expect(text).toContain('ABC');
    expect(text).toContain('DEF');
    // Both parts should be headings when split in the middle
    const headings = await page.locator(`${editorSelector} h1`).count();
    expect(headings).toBe(2);
  });
});

test.describe('Heading — Backspace behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at start of heading converts to paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();
    await focusStart(page, 'h1');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('Heading One');
  });

  test('Backspace at start of h2 converts to paragraph', async ({ page }) => {
    await setContentAndFocus(page, H2);
    await page.locator(`${editorSelector} h2`).click();
    await focusStart(page, 'h2');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h2>');
    expect(html).toContain('<p>');
    expect(html).toContain('Heading Two');
  });

  test('Backspace at start of heading after paragraph converts heading first', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<p>before</p><h2>Title</h2>');
    await focusStart(page, 'h2');

    // First Backspace: converts h2 to paragraph (heading plugin handler)
    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    // h2 should be converted to paragraph
    expect(html).not.toContain('<h2>');
    const text = await getEditorText(page);
    expect(text).toContain('before');
    expect(text).toContain('Title');
  });
});

test.describe('Heading — with surrounding content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('heading between paragraphs preserves structure', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p>intro</p><h2>Section Title</h2><p>body</p>',
    );

    const html = await getEditorHTML(page);
    expect(html).toContain('<p>');
    expect(html).toContain('<h2>');
    const text = await getEditorText(page);
    expect(text).toContain('intro');
    expect(text).toContain('Section Title');
    expect(text).toContain('body');
  });

  test('multiple headings with paragraphs render correctly', async ({
    page,
  }) => {
    await setContentAndFocus(
      page,
      '<h1>Title</h1><p>intro</p><h2>Section</h2><p>content</p>',
    );

    const h1 = page.locator(`${editorSelector} h1`);
    const h2 = page.locator(`${editorSelector} h2`);
    await expect(h1).toContainText('Title');
    await expect(h2).toContainText('Section');
    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
  });
});
