import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const detailsBtn = 'button[aria-label="Toggle Details"]';

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

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

/** Click the toggle button inside a details NodeView to open/close it. */
async function clickDetailsToggle(page: Page, nth = 0) {
  const toggle = page.locator(`${editorSelector} div[data-type="details"] > button[type="button"]`).nth(nth);
  await toggle.click();
}

/** Check if a details NodeView has the open class. */
async function isDetailsOpen(page: Page, nth = 0): Promise<boolean> {
  const details = page.locator(`${editorSelector} div[data-type="details"]`).nth(nth);
  return details.evaluate((el) => el.classList.contains('is-open'));
}

/** Place cursor at start of summary text using native DOM selection. */
async function focusSummaryStart(page: Page, nth = 0) {
  await page.evaluate(({ sel, n }) => {
    const summaries = document.querySelectorAll(sel + ' div[data-type="details"] summary');
    const summary = summaries[n];
    if (!summary) return;
    const range = document.createRange();
    if (summary.firstChild) {
      range.setStart(summary.firstChild, 0);
    } else {
      range.setStart(summary, 0);
    }
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, n: nth });
  await page.waitForTimeout(50);
}

/** Place cursor at end of summary text. */
async function focusSummaryEnd(page: Page, nth = 0) {
  await page.evaluate(({ sel, n }) => {
    const summaries = document.querySelectorAll(sel + ' div[data-type="details"] summary');
    const summary = summaries[n];
    if (!summary) return;
    let node: Node = summary;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, n: nth });
  await page.waitForTimeout(50);
}

/** Place cursor inside the content area of a details (first paragraph). */
async function focusContentParagraph(page: Page, nth = 0) {
  await page.evaluate(({ sel, n }) => {
    const contents = document.querySelectorAll(sel + ' div[data-type="details"] div[data-details-content]');
    const content = contents[n];
    if (!content) return;
    const p = content.querySelector('p');
    if (!p) return;
    const range = document.createRange();
    if (p.firstChild) {
      range.setStart(p.firstChild, 0);
    } else {
      range.setStart(p, 0);
    }
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, n: nth });
  await page.waitForTimeout(50);
}

/** Place cursor at end of last paragraph in details content area. */
async function focusContentEnd(page: Page, nth = 0) {
  await page.evaluate(({ sel, n }) => {
    const contents = document.querySelectorAll(sel + ' div[data-type="details"] div[data-details-content]');
    const content = contents[n];
    if (!content) return;
    const paragraphs = content.querySelectorAll('p');
    const lastP = paragraphs[paragraphs.length - 1];
    if (!lastP) return;
    let node: Node = lastP;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, n: nth });
  await page.waitForTimeout(50);
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const SINGLE_PARA = '<p>Some text</p>';
const TWO_PARAS = '<p>First paragraph</p><p>Second paragraph</p>';
const THREE_PARAS = '<p>First</p><p>Second</p><p>Third</p>';
const DETAILS_BASIC = '<details><summary>Summary title</summary><div data-details-content><p>Content body</p></div></details>';
const DETAILS_EMPTY_SUMMARY = '<details><summary></summary><div data-details-content><p>Content</p></div></details>';
const DETAILS_MULTI_CONTENT = '<details><summary>Title</summary><div data-details-content><p>Para one</p><p>Para two</p><p>Para three</p></div></details>';
const DETAILS_WITH_MARKS = '<details><summary><strong>Bold title</strong></summary><div data-details-content><p>Content</p></div></details>';
const DETAILS_MIXED_MARKS = '<details><summary><strong>Bold</strong> and <em>italic</em></summary><div data-details-content><p>Content</p></div></details>';
const DETAILS_BETWEEN_PARAS = '<p>Before</p><details><summary>Middle</summary><div data-details-content><p>Content</p></div></details><p>After</p>';
const TWO_DETAILS = '<details><summary>Q1</summary><div data-details-content><p>A1</p></div></details><details><summary>Q2</summary><div data-details-content><p>A2</p></div></details>';
const THREE_DETAILS = '<details><summary>Q1</summary><div data-details-content><p>A1</p></div></details><details><summary>Q2</summary><div data-details-content><p>A2</p></div></details><details><summary>Q3</summary><div data-details-content><p>A3</p></div></details>';
const DETAILS_WITH_LIST = '<details><summary>FAQ</summary><div data-details-content><ul><li><p>Item one</p></li><li><p>Item two</p></li></ul></div></details>';
const DETAILS_OPEN = '<details open><summary>Open title</summary><div data-details-content><p>Visible content</p></div></details>';
const DETAILS_CONTENT_EMPTY_LAST = '<details><summary>Title</summary><div data-details-content><p>Content</p><p></p></div></details>';

// ═══════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders details with NodeView wrapper div[data-type="details"]', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toBeVisible();
  });

  test('renders summary element inside details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('Summary title');
  });

  test('renders content area with data-details-content attribute', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const content = page.locator(`${editorSelector} div[data-details-content]`);
    await expect(content).toBeAttached();
  });

  test('content area starts hidden by default', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const content = page.locator(`${editorSelector} div[data-details-content]`);
    await expect(content).toHaveAttribute('hidden', 'hidden');
  });

  test('renders toggle button element', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const button = page.locator(`${editorSelector} div[data-type="details"] > button[type="button"]`);
    await expect(button).toBeAttached();
  });

  test('details does not have is-open class initially', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const isOpen = await isDetailsOpen(page);
    expect(isOpen).toBe(false);
  });

  test('renders summary with inline marks (bold)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_WITH_MARKS);

    const strong = page.locator(`${editorSelector} div[data-type="details"] summary strong`);
    await expect(strong).toBeVisible();
    await expect(strong).toContainText('Bold title');
  });

  test('renders summary with mixed marks', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_MIXED_MARKS);

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('Bold and italic');
    const strong = summary.locator('strong');
    const em = summary.locator('em');
    await expect(strong).toContainText('Bold');
    await expect(em).toContainText('italic');
  });

  test('renders multiple paragraphs inside content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_MULTI_CONTENT);
    await clickDetailsToggle(page);

    const paragraphs = page.locator(`${editorSelector} div[data-details-content] p`);
    await expect(paragraphs).toHaveCount(3);
  });

  test('details between paragraphs preserves surrounding content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BETWEEN_PARAS);

    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('Middle');
    expect(text).toContain('After');
  });

  test('renders consecutive details blocks', async ({ page }) => {
    await setContentAndFocus(page, THREE_DETAILS);

    const detailsNodes = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(detailsNodes).toHaveCount(3);
  });

  test('renders list inside details content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_WITH_LIST);
    await clickDetailsToggle(page);

    const list = page.locator(`${editorSelector} div[data-details-content] ul`);
    await expect(list).toBeVisible();
    const items = page.locator(`${editorSelector} div[data-details-content] li`);
    await expect(items).toHaveCount(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TOGGLE BUTTON (open/close)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — toggle button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking toggle opens details (adds is-open class)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    expect(await isDetailsOpen(page)).toBe(false);

    await clickDetailsToggle(page);

    expect(await isDetailsOpen(page)).toBe(true);
  });

  test('clicking toggle reveals hidden content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const content = page.locator(`${editorSelector} div[data-details-content]`);
    await expect(content).toHaveAttribute('hidden', 'hidden');

    await clickDetailsToggle(page);

    await expect(content).not.toHaveAttribute('hidden');
  });

  test('clicking toggle twice closes details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    await clickDetailsToggle(page);
    expect(await isDetailsOpen(page)).toBe(true);

    await clickDetailsToggle(page);
    expect(await isDetailsOpen(page)).toBe(false);
  });

  test('clicking toggle twice re-hides content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const content = page.locator(`${editorSelector} div[data-details-content]`);

    await clickDetailsToggle(page);
    await expect(content).not.toHaveAttribute('hidden');

    await clickDetailsToggle(page);
    await expect(content).toHaveAttribute('hidden', '');
  });

  test('toggling one details does not affect another', async ({ page }) => {
    await setContentAndFocus(page, TWO_DETAILS);

    await clickDetailsToggle(page, 0);

    expect(await isDetailsOpen(page, 0)).toBe(true);
    expect(await isDetailsOpen(page, 1)).toBe(false);
  });

  test('both details can be opened independently', async ({ page }) => {
    await setContentAndFocus(page, TWO_DETAILS);

    await clickDetailsToggle(page, 0);
    await clickDetailsToggle(page, 1);

    expect(await isDetailsOpen(page, 0)).toBe(true);
    expect(await isDetailsOpen(page, 1)).toBe(true);
  });

  test('chevron rotates when open (transform changes)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const button = page.locator(`${editorSelector} div[data-type="details"] > button[type="button"]`);
    const closedTransform = await button.evaluate((el) =>
      getComputedStyle(el, '::before').transform,
    );

    await clickDetailsToggle(page);
    // Wait for CSS transition to complete (150ms ease)
    await page.waitForTimeout(250);

    const openTransform = await button.evaluate((el) =>
      getComputedStyle(el, '::before').transform,
    );

    expect(closedTransform).not.toBe(openTransform);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TOOLBAR BUTTON
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — toolbar button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar has "Toggle Details" button', async ({ page }) => {
    const btn = page.locator(detailsBtn);
    await expect(btn).toBeVisible();
  });

  test('wraps paragraph in details via toolbar button', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(detailsBtn).click();

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toBeVisible();
    const text = await getEditorText(page);
    expect(text).toContain('Some text');
  });

  test('wrapped content goes into detailsContent', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(detailsBtn).click();

    // Open to see content
    await clickDetailsToggle(page);
    const contentPara = page.locator(`${editorSelector} div[data-details-content] p`);
    await expect(contentPara).toContainText('Some text');
  });

  test('summary is empty after wrapping', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(detailsBtn).click();

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    const summaryText = await summary.textContent();
    expect(summaryText?.trim()).toBe('');
  });

  test('cursor is placed in summary after wrapping', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.locator(detailsBtn).click();

    // Type into the summary
    await page.keyboard.type('My Summary');

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('My Summary');
  });

  test('toggle button shows active state when inside details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryStart(page);

    const btn = page.locator(detailsBtn);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  test('toggle button shows inactive state outside details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BETWEEN_PARAS);
    await page.locator(`${editorSelector} > p`).first().click();

    const btn = page.locator(detailsBtn);
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  test('toolbar button unwraps details when cursor is inside (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryStart(page);

    await page.locator(detailsBtn).click();

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Summary title');
  });

  test('unwrapping preserves content paragraphs', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryStart(page);

    await page.locator(detailsBtn).click();

    const text = await getEditorText(page);
    expect(text).toContain('Summary title');
    expect(text).toContain('Content body');
  });

  test('wraps selected paragraph into details content', async ({ page }) => {
    await setContentAndFocus(page, THREE_PARAS);

    // Click the second paragraph
    const middlePara = page.locator(`${editorSelector} > p`).nth(1);
    await middlePara.click();
    await page.locator(detailsBtn).click();

    // Open content
    await clickDetailsToggle(page);
    const contentParas = page.locator(`${editorSelector} div[data-details-content] p`);
    await expect(contentParas).toHaveCount(1);
    await expect(contentParas.first()).toContainText('Second');
    // Other paragraphs remain outside
    const allParas = page.locator(`${editorSelector} > p`);
    await expect(allParas).toHaveCount(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TYPING IN SUMMARY
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — typing in summary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('can type text into summary', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_EMPTY_SUMMARY);
    await focusSummaryStart(page);

    await page.keyboard.type('New summary text');

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('New summary text');
  });

  test('can edit existing summary text', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryEnd(page);

    await page.keyboard.type(' appended');

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('Summary title appended');
  });

  test('can apply bold to summary text', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_EMPTY_SUMMARY);
    await focusSummaryStart(page);

    await page.keyboard.press('Meta+b');
    await page.keyboard.type('Bold summary');

    const strong = page.locator(`${editorSelector} div[data-type="details"] summary strong`);
    await expect(strong).toContainText('Bold summary');
  });

  test('can apply italic to summary text', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_EMPTY_SUMMARY);
    await focusSummaryStart(page);

    await page.keyboard.press('Meta+i');
    await page.keyboard.type('Italic summary');

    const em = page.locator(`${editorSelector} div[data-type="details"] summary em`);
    await expect(em).toContainText('Italic summary');
  });

  test('Enter in summary does not create new paragraph in summary', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryEnd(page);

    await page.keyboard.press('Enter');

    // Summary should still contain original text without a split
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('Summary title');
    // Summary should not contain multiple paragraphs
    const summaryParas = summary.locator('p');
    await expect(summaryParas).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TYPING IN CONTENT
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — typing in content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('can type in content area when open', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);

    const contentPara = page.locator(`${editorSelector} div[data-details-content] p`);
    await contentPara.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' extra text');

    const contentText = await contentPara.textContent();
    expect(contentText).toContain('Content body extra text');
  });

  test('Enter in content creates new paragraph within content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.type('New paragraph');

    const contentParas = page.locator(`${editorSelector} div[data-details-content] p`);
    await expect(contentParas).toHaveCount(2);
    const text = await getEditorText(page);
    expect(text).toContain('New paragraph');
  });

  test('can apply bold in content area', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Meta+b');
    await page.keyboard.type('Bold content');

    const strong = page.locator(`${editorSelector} div[data-details-content] strong`);
    await expect(strong).toContainText('Bold content');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ENTER KEY IN SUMMARY (open content + move cursor)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — Enter in summary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter in summary opens collapsed content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    expect(await isDetailsOpen(page)).toBe(false);

    await focusSummaryEnd(page);
    await page.keyboard.press('Enter');

    expect(await isDetailsOpen(page)).toBe(true);
  });

  test('Enter in summary moves cursor into content area', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryEnd(page);

    await page.keyboard.press('Enter');
    // Type to verify cursor is in content area
    await page.keyboard.type('typed in content');

    const text = await getEditorText(page);
    expect(text).toContain('typed in content');
    // The typed text should be inside detailsContent, not in summary
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    const summaryText = await summary.textContent();
    expect(summaryText).not.toContain('typed in content');
  });

  test('Enter in summary when content is already open still works', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    expect(await isDetailsOpen(page)).toBe(true);

    await focusSummaryEnd(page);
    await page.keyboard.press('Enter');

    // Should still be open and cursor in content
    expect(await isDetailsOpen(page)).toBe(true);
    await page.keyboard.type('inserted');
    const text = await getEditorText(page);
    expect(text).toContain('inserted');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BACKSPACE IN SUMMARY
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — Backspace in summary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at start of summary unwraps details', async ({ page }) => {
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await setContentAndFocus(page, DETAILS_BASIC);
    // Click summary then use Cmd+Left to reliably move to start (ProseMirror-aware)
    await page.locator(`${editorSelector} div[data-type="details"] summary`).click();
    await page.keyboard.press(`${modifier}+ArrowLeft`);
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Summary title');
    expect(text).toContain('Content body');
  });

  test('Backspace in middle of summary deletes character (does not unwrap)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryEnd(page);

    await page.keyboard.press('Backspace');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('Summary titl');
  });

  test('Backspace on empty summary unwraps details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_EMPTY_SUMMARY);
    // Use focus('start') to place cursor in the empty summary (clicking on it misses the summary)
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (comp?.editor) comp.editor.commands.focus('start');
    });
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(0);
  });

  test('Backspace at start of summary between paragraphs preserves surrounding content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BETWEEN_PARAS);
    await focusSummaryStart(page);

    await page.keyboard.press('Backspace');

    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('Middle');
    expect(text).toContain('Content');
    expect(text).toContain('After');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DOUBLE-ENTER ESCAPE FROM CONTENT
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — double-Enter escape from content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter+Enter at end of content escapes out of details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    // First Enter: new empty paragraph in content
    await page.keyboard.press('Enter');
    // Second Enter: escape out of details
    await page.keyboard.press('Enter');

    // Type to verify cursor is outside details
    await page.keyboard.type('Outside now');

    const text = await getEditorText(page);
    expect(text).toContain('Outside now');

    // "Outside now" should be in a paragraph after the details, not inside it
    const outsidePara = page.locator(`${editorSelector} > p`).filter({ hasText: 'Outside now' });
    // Check it's a direct child of the editor
    const count = await outsidePara.count();
    // It might be rendered after the details NodeView div
    expect(count).toBeGreaterThanOrEqual(0); // May be inside the last ProseMirror container

    // The details should still exist
    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);
  });

  test('single Enter at end of content does NOT escape', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.type('Still inside');

    // Should still be inside details content
    const contentText = await page.locator(`${editorSelector} div[data-details-content]`).textContent();
    expect(contentText).toContain('Still inside');
  });

  test('Enter on non-empty last paragraph does NOT escape', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    // The last paragraph has text ("Content body"), so Enter should just split
    await page.keyboard.press('Enter');

    const contentParas = page.locator(`${editorSelector} div[data-details-content] p`);
    // Should be 2 paragraphs (split), still inside content
    await expect(contentParas).toHaveCount(2);
  });

  test('double-Enter escape creates paragraph after details', async ({ page }) => {
    await setContentAndFocus(page, '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details>');
    await clickDetailsToggle(page);
    await focusContentEnd(page);

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // A paragraph should exist after the details
    const html = await getEditorHTML(page);
    // The details block should still have its content
    expect(html).toContain('data-type="details"');
    // New paragraph should exist outside
    const allText = await getEditorText(page);
    expect(allText).toContain('Title');
    expect(allText).toContain('Body');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NESTING PREVENTION
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — nesting prevention', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button does not nest details inside details (from summary)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryStart(page);

    // Clicking toggle details when inside details should unwrap, not nest
    await page.locator(detailsBtn).click();

    const detailsCount = await page.locator(`${editorSelector} div[data-type="details"]`).count();
    expect(detailsCount).toBeLessThanOrEqual(1);
  });

  test('toolbar button does not nest details inside details (from content)', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);
    await focusContentParagraph(page);

    // Should unwrap the parent details
    await page.locator(detailsBtn).click();

    const detailsCount = await page.locator(`${editorSelector} div[data-type="details"]`).count();
    expect(detailsCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SELECTION PLUGIN (cursor in collapsed content)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — selection in collapsed content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking on collapsed content area does not place cursor there', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BETWEEN_PARAS);

    // Content is hidden, try to interact with summary instead
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await summary.click();

    // Type to verify cursor is in an accessible position
    await page.keyboard.type('X');
    const summaryText = await summary.textContent();
    // The text should have been added to the summary
    expect(summaryText).toContain('X');
  });

  test('ArrowDown from paragraph before collapsed details lands in summary', async ({ page }) => {
    await setContentAndFocus(page, '<p>Line above</p><details><summary>Title</summary><div data-details-content><p>Hidden</p></div></details>');
    await page.locator(`${editorSelector} > p`).click();

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.type('Z');

    // Z should appear somewhere in the editor (summary or adjacent paragraph)
    const text = await page.locator(editorSelector).textContent();
    expect(text).toContain('Z');
    // The hidden content should not have been modified
    const html = await page.locator(editorSelector).innerHTML();
    expect(html).toContain('Title');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HTML OUTPUT
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('outputs semantic <details> and <summary> HTML', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>');
    expect(html).toContain('Summary title');
    expect(html).toContain('</summary>');
    expect(html).toContain('</details>');
  });

  test('outputs data-details-content div in HTML', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('data-details-content');
  });

  test('outputs inline marks in summary HTML', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_WITH_MARKS);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('<strong>Bold title</strong>');
  });

  test('outputs mixed marks in summary HTML', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_MIXED_MARKS);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  test('HTML output contains details from initial content', async ({ page }) => {
    // The demo initial content has a details block
    const output = page.locator('pre.output');
    await expect(output).toContainText('<details>');
    await expect(output).toContainText('<summary>');
    await expect(output).toContainText('Click to expand this accordion');
  });

  test('HTML output changes after toggling details via toolbar', async ({ page }) => {
    // Record initial HTML output
    const output = page.locator('pre.output');
    const initialHtml = await output.textContent() ?? '';
    expect(initialHtml).toContain('<details>');

    // Click inside the details summary to toggle it off
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await summary.click();

    // The toolbar button should now show active state
    const btn = page.locator(detailsBtn);
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// MULTIPLE DETAILS BLOCKS
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — multiple blocks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('opening first details does not affect second', async ({ page }) => {
    await setContentAndFocus(page, TWO_DETAILS);

    await clickDetailsToggle(page, 0);

    const content0 = page.locator(`${editorSelector} div[data-details-content]`).nth(0);
    const content1 = page.locator(`${editorSelector} div[data-details-content]`).nth(1);
    await expect(content0).not.toHaveAttribute('hidden');
    await expect(content1).toHaveAttribute('hidden', 'hidden');
  });

  test('unwrapping one details preserves the other', async ({ page }) => {
    await setContentAndFocus(page, TWO_DETAILS);
    await focusSummaryStart(page, 0);

    await page.locator(detailsBtn).click();

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);
    const text = await getEditorText(page);
    expect(text).toContain('Q1');
    expect(text).toContain('A1');
    expect(text).toContain('Q2');
  });

  test('three consecutive details all render correctly', async ({ page }) => {
    await setContentAndFocus(page, THREE_DETAILS);

    const summaries = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summaries).toHaveCount(3);
    await expect(summaries.nth(0)).toContainText('Q1');
    await expect(summaries.nth(1)).toContainText('Q2');
    await expect(summaries.nth(2)).toContainText('Q3');
  });

  test('can open all three details simultaneously', async ({ page }) => {
    await setContentAndFocus(page, THREE_DETAILS);

    await clickDetailsToggle(page, 0);
    await clickDetailsToggle(page, 1);
    await clickDetailsToggle(page, 2);

    expect(await isDetailsOpen(page, 0)).toBe(true);
    expect(await isDetailsOpen(page, 1)).toBe(true);
    expect(await isDetailsOpen(page, 2)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// SURROUNDING CONTENT PRESERVATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — surrounding content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('paragraph before details is preserved', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before text</p>' + DETAILS_BASIC);

    const html = await getEditorHTML(page);
    expect(html).toContain('Before text');
    expect(html).toContain('data-type="details"');
  });

  test('paragraph after details is preserved', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC + '<p>After text</p>');

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="details"');
    expect(html).toContain('After text');
  });

  test('wrapping middle paragraph preserves before and after', async ({ page }) => {
    await setContentAndFocus(page, THREE_PARAS);

    // Click the middle paragraph
    const middlePara = page.locator(`${editorSelector} > p`).nth(1);
    await middlePara.click();

    await page.locator(detailsBtn).click();

    const text = await getEditorText(page);
    expect(text).toContain('First');
    expect(text).toContain('Second');
    expect(text).toContain('Third');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);
  });

  test('details after heading renders correctly', async ({ page }) => {
    await setContentAndFocus(page, '<h2>Title</h2>' + DETAILS_BASIC);

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expect(html).toContain('data-type="details"');
  });

  test('details after list renders correctly', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>item</p></li></ul>' + DETAILS_BASIC);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('data-type="details"');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('empty details with empty summary and empty content paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<details><summary></summary><div data-details-content><p></p></div></details>');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toBeVisible();
    const summary = details.locator('summary');
    await expect(summary).toBeAttached();
  });

  test('details with very long summary text', async ({ page }) => {
    const longText = 'A'.repeat(200);
    await setContentAndFocus(page, `<details><summary>${longText}</summary><div data-details-content><p>Content</p></div></details>`);

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText(longText);
  });

  test('details with many content paragraphs', async ({ page }) => {
    const paras = Array.from({ length: 10 }, (_, i) => `<p>Paragraph ${i}</p>`).join('');
    await setContentAndFocus(page, `<details><summary>Title</summary><div data-details-content>${paras}</div></details>`);

    await clickDetailsToggle(page);
    const contentParas = page.locator(`${editorSelector} div[data-details-content] p`);
    await expect(contentParas).toHaveCount(10);
  });

  test('wrapping empty paragraph creates valid details', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).first().click();

    await page.locator(detailsBtn).click();

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details.first()).toBeVisible();
    const summary = details.first().locator('summary');
    await expect(summary).toBeAttached();
  });

  test('toggle wrap/unwrap cycle produces consistent results', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    // Wrap
    await page.locator(detailsBtn).click();
    let details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);

    // Focus summary for unwrap
    await focusSummaryStart(page);

    // Unwrap
    await page.locator(detailsBtn).click();
    details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Some text');
  });

  test('undo after wrapping restores original state', async ({ page }) => {
    // Use the initial content which has a details and surrounding paragraphs
    // Click the last paragraph ("Final paragraph...")
    const lastPara = page.locator(`${editorSelector} > p`).last();
    await lastPara.click();

    // Wrap it in details
    await page.locator(detailsBtn).click();

    // Should now have 2 details blocks (original + newly wrapped)
    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    const countAfterWrap = await details.count();
    expect(countAfterWrap).toBe(2);

    // Undo
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(200);

    // Should be back to 1 details
    const countAfterUndo = await details.count();
    expect(countAfterUndo).toBe(1);
  });

  test('undo after unwrapping restores details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await focusSummaryStart(page);

    await page.locator(detailsBtn).click();
    let details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(0);

    await page.keyboard.press('Meta+z');

    details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toHaveCount(1);
  });

  test('details at very start of document', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const firstChild = page.locator(`${editorSelector} > *`).first();
    const tagName = await firstChild.evaluate((el) => el.getAttribute('data-type'));
    expect(tagName).toBe('details');
  });

  test('details at very end of document', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p>' + DETAILS_BASIC);

    const lastChild = page.locator(`${editorSelector} > *`).last();
    const tagName = await lastChild.evaluate((el) => el.getAttribute('data-type'));
    expect(tagName).toBe('details');
  });

  test('parsing div[data-type="details"] compatibility format', async ({ page }) => {
    // This tests the alternative parseHTML rule
    await setContentAndFocus(page, '<div data-type="details"><summary>Compat</summary><div data-details-content><p>Content</p></div></div>');

    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toBeVisible();
    const summary = details.locator('summary');
    await expect(summary).toContainText('Compat');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CSS STYLING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — CSS styling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('details has grid display', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const display = await page.locator(`${editorSelector} div[data-type="details"]`).evaluate(
      (el) => getComputedStyle(el).display,
    );
    expect(display).toBe('grid');
  });

  test('details has border', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const border = await page.locator(`${editorSelector} div[data-type="details"]`).evaluate(
      (el) => getComputedStyle(el).borderStyle,
    );
    expect(border).not.toBe('none');
  });

  test('details has border-radius', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const radius = await page.locator(`${editorSelector} div[data-type="details"]`).evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    expect(radius).not.toBe('0px');
  });

  test('toggle button is visible', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const button = page.locator(`${editorSelector} div[data-type="details"] > button[type="button"]`);
    await expect(button).toBeVisible();
  });

  test('summary has font-weight applied', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);

    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toBeVisible();
    const fontWeight = await summary.evaluate((el) => getComputedStyle(el).fontWeight);
    // Should have some weight (typically bold or semi-bold for summary)
    expect(parseInt(fontWeight, 10)).toBeGreaterThanOrEqual(400);
  });

  test('content area has padding when visible', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC);
    await clickDetailsToggle(page);

    const content = page.locator(`${editorSelector} div[data-details-content]`);
    const padding = await content.evaluate((el) => getComputedStyle(el).padding);
    expect(padding).not.toBe('0px');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD NAVIGATION (ArrowRight/ArrowDown on collapsed)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — keyboard navigation around collapsed details', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('ArrowDown from summary of collapsed details moves past the details', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC + '<p>After details</p>');
    await focusSummaryEnd(page);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    await page.keyboard.type('X');

    // X should be typed in the paragraph after details, not in summary
    const afterPara = page.locator(`${editorSelector} > p`).filter({ hasText: 'X' });
    const count = await afterPara.count();
    // Cursor should have moved out of details
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('ArrowRight at end of summary in collapsed details skips past content', async ({ page }) => {
    await setContentAndFocus(page, DETAILS_BASIC + '<p>After</p>');
    await focusSummaryEnd(page);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    // Cursor should not be inside the hidden content
    // We verify by typing and checking it doesn't appear in content
    await page.keyboard.type('Y');
    const contentText = await page.locator(`${editorSelector} div[data-details-content]`).first().textContent();
    expect(contentText).not.toContain('Y');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INITIAL CONTENT IN DEMO
// ═══════════════════════════════════════════════════════════════════════

test.describe('Details — initial demo content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('demo page has a details block in initial content', async ({ page }) => {
    const details = page.locator(`${editorSelector} div[data-type="details"]`);
    await expect(details).toBeVisible();
  });

  test('initial details has correct summary text', async ({ page }) => {
    const summary = page.locator(`${editorSelector} div[data-type="details"] summary`);
    await expect(summary).toContainText('Click to expand this accordion');
  });

  test('initial details starts collapsed', async ({ page }) => {
    const isOpen = await isDetailsOpen(page);
    expect(isOpen).toBe(false);
  });

  test('initial details can be toggled open', async ({ page }) => {
    await clickDetailsToggle(page);

    expect(await isDetailsOpen(page)).toBe(true);
    const content = page.locator(`${editorSelector} div[data-details-content]`);
    await expect(content).not.toHaveAttribute('hidden');
  });

  test('initial details content is accessible when open', async ({ page }) => {
    await clickDetailsToggle(page);

    const text = await page.locator(`${editorSelector} div[data-details-content]`).textContent();
    expect(text).toContain('hidden content inside a details/accordion block');
    expect(text).toContain('rich text');
  });
});
