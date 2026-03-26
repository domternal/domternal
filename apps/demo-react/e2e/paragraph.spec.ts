import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

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

// ─── Fixtures ──────────────────────────────────────────────────────────

const SINGLE_PARA = '<p>Hello world</p>';
const TWO_PARAS = '<p>First paragraph</p><p>Second paragraph</p>';
const PARA_WITH_MARKS =
  '<p>Normal <strong>bold</strong> <em>italic</em> <code>code</code></p>';
const EMPTY_PARA = '<p></p>';

// ─── Tests ─────────────────────────────────────────────────────────────

test.describe('Paragraph — basic rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('single paragraph renders correctly', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);

    const html = await getEditorHTML(page);
    expect(html).toContain('<p>');
    expect(html).toContain('Hello world');
    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(1);
  });

  test('multiple paragraphs render correctly', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAS);

    const text = await getEditorText(page);
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
  });

  test('paragraph preserves inline marks', async ({ page }) => {
    await setContentAndFocus(page, PARA_WITH_MARKS);

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
  });

  test('empty paragraph is editable', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.type('typed text');

    const text = await getEditorText(page);
    expect(text).toContain('typed text');
  });
});

test.describe('Paragraph — Enter key behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end of paragraph creates new paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
    const text = await getEditorText(page);
    expect(text).toContain('Hello world');
  });

  test('Enter at end + typing creates content in new paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('new paragraph');

    const text = await getEditorText(page);
    expect(text).toContain('Hello world');
    expect(text).toContain('new paragraph');
    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
  });

  test('Enter in middle of paragraph splits it', async ({ page }) => {
    await setContentAndFocus(page, '<p>ABCDEF</p>');
    // Place cursor at position 3 (after "ABC")
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' p');
      if (!p || !p.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);

    await page.keyboard.press('Enter');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
    const firstP = page.locator(`${editorSelector} p`).first();
    const lastP = page.locator(`${editorSelector} p`).last();
    await expect(firstP).toContainText('ABC');
    await expect(lastP).toContainText('DEF');
  });

  test('Enter at start of paragraph creates empty paragraph before', async ({
    page,
  }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await focusStart(page, 'p');

    await page.keyboard.press('Enter');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
    const text = await getEditorText(page);
    expect(text).toContain('Hello world');
  });

  test('Enter on empty paragraph creates another empty paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, EMPTY_PARA);
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.press('Enter');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(2);
  });
});

test.describe('Paragraph — Backspace and Delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at start of second paragraph joins with first', async ({
    page,
  }) => {
    await setContentAndFocus(page, TWO_PARAS);
    await focusStart(page, 'p', 1);

    await page.keyboard.press('Backspace');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(1);
    const text = await getEditorText(page);
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
  });

  test('Delete at end of first paragraph joins with second', async ({
    page,
  }) => {
    await setContentAndFocus(page, TWO_PARAS);
    // Place cursor at end of first paragraph via DOM selection
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const p = editor?.querySelector('p');
      if (!p) return;
      let node: Node = p;
      while (node.lastChild) node = node.lastChild;
      const range = document.createRange();
      range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.waitForTimeout(50);

    await page.keyboard.press('Delete');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(1);
    const text = await getEditorText(page);
    expect(text).toContain('First paragraph');
    expect(text).toContain('Second paragraph');
  });

  test('Backspace merges bold text correctly', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p>before</p><p><strong>bold after</strong></p>',
    );
    await focusStart(page, 'p', 1);

    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expect(html).toContain('before');
    expect(html).toContain('<strong>bold after</strong>');
    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBe(1);
  });
});

test.describe('Paragraph — text selection and replacement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('select all and type replaces content', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.type('replaced');

    const text = await getEditorText(page);
    expect(text).toContain('replaced');
    expect(text).not.toContain('Hello world');
  });

  test('select all and delete leaves empty paragraph', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAS);
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.press(`${modifier}+a`);
    await page.keyboard.press('Backspace');

    const pCount = await page.locator(`${editorSelector} p`).count();
    expect(pCount).toBeGreaterThanOrEqual(1);
  });
});
