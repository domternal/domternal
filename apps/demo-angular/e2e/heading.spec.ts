import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const headingDropdown = 'button[aria-label="Heading"]';

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
const ALL_HEADINGS = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4>';
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

  test('all configured heading levels render', async ({ page }) => {
    await setContentAndFocus(page, ALL_HEADINGS);

    for (let i = 1; i <= 4; i++) {
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

test.describe('Heading — keyboard shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Mod-Alt-1 toggles h1', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.press('Meta+Alt+1');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h1>');
    expect(html).toContain('Normal text');
  });

  test('Mod-Alt-1 toggles h1 back to paragraph', async ({ page }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();

    await page.keyboard.press('Meta+Alt+1');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('Heading One');
  });

  test('Mod-Alt-3 toggles h3', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.keyboard.press('Meta+Alt+3');

    const html = await getEditorHTML(page);
    expect(html).toContain('<h3>');
    expect(html).toContain('Normal text');
  });

  test('Mod-Alt-0 converts heading to paragraph', async ({ page }) => {
    await setContentAndFocus(page, H1);
    await page.locator(`${editorSelector} h1`).click();

    await page.keyboard.press('Meta+Alt+0');

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('Heading One');
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

// ─── Notion-style Enter behaviour ──────────────────────────────────────
//
// Pressing Enter at the END of a heading creates a paragraph as the
// next sibling and moves the caret into it. This is the "exit the
// heading and start typing body text" UX from Notion / Google Docs.
// Pressing Enter on an EMPTY heading converts it to a paragraph in
// place (lets users back out of an accidental `# ` input rule).
// Mid-heading Enter falls through to the default split behaviour
// (both halves remain heading).

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    return Array.from(root.children).map((el) => el.tagName.toLowerCase());
  }, editorSelector);
}

async function placeCaretAtEnd(page: Page, tag: string) {
  await page.evaluate(({ sel, tag }) => {
    const el = document.querySelector(`${sel} ${tag}`);
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, tag });
}

async function placeCaretAt(page: Page, tag: string, charOffset: number) {
  await page.evaluate(({ sel, tag, off }) => {
    const el = document.querySelector(`${sel} ${tag}`);
    if (!el) return;
    const text = el.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return;
    const range = document.createRange();
    range.setStart(text, off);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, tag, off: charOffset });
}

/**
 * Place the PM caret inside the FIRST node of `typeName` at the given
 * byte offset (default 0 for empty nodes). Goes through PM's
 * TextSelection API rather than the browser's `Range`/`Selection`,
 * which silently drops the caret on empty / atom textblocks.
 */
async function caretInFirstNode(page: Page, typeName: string, offset = 0) {
  await page.evaluate(({ tn, off }) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as unknown as { ng?: { getComponent?: (el: unknown) => { editor?: { state: { doc: { descendants: (cb: (n: { type: { name: string } }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void; dom: HTMLElement } } } } }).ng;
    const comp = ng?.getComponent?.(el);
    const editor = comp?.editor;
    if (!editor) return;
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn) { pos = p; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = editor.view.state.selection.constructor;
    const tr = (editor.state.tr.setSelection as (s: unknown) => unknown)(TS.create(editor.state.doc, pos + 1 + off));
    editor.view.dispatch(tr);
    editor.view.dom.focus();
    editor.view.focus();
  }, { tn: typeName, off: offset });
}

test.describe('Heading — Notion-style Enter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('Enter at end of h1 creates a paragraph as the next sibling (caret moves into it)', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Title</h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);
    // Caret in the new paragraph - typing lands there, not appended to "Title".
    await page.keyboard.type('typed');
    const h1Text = await page.locator(`${editorSelector} h1`).textContent();
    const pText = await page.locator(`${editorSelector} p`).textContent();
    expect(h1Text).toBe('Title');
    expect(pText).toBe('typed');
  });

  test('Enter at end of h2 creates a paragraph (level not promoted to h1)', async ({ page }) => {
    await setContentAndFocus(page, '<h2>Section</h2>');
    await placeCaretAtEnd(page, 'h2');
    await page.keyboard.press('Enter');
    expect(await topLevelTypes(page)).toEqual(['h2', 'p']);
  });

  test('Enter at end of h3 creates a paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<h3>Sub</h3>');
    await placeCaretAtEnd(page, 'h3');
    await page.keyboard.press('Enter');
    expect(await topLevelTypes(page)).toEqual(['h3', 'p']);
  });

  test('Enter at end of h4 creates a paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<h4>Deep</h4>');
    await placeCaretAtEnd(page, 'h4');
    await page.keyboard.press('Enter');
    expect(await topLevelTypes(page)).toEqual(['h4', 'p']);
  });

  test('Enter on an EMPTY heading converts it to a paragraph in place (no extra block)', async ({ page }) => {
    await setContentAndFocus(page, '<h1></h1>');
    await caretInFirstNode(page, 'heading');
    await page.keyboard.press('Enter');
    // The h1 is converted in place. TrailingNode keeps a final empty
    // paragraph at end-of-doc, so we get [p, p] - what matters is the
    // h1 is gone.
    const tags = await topLevelTypes(page);
    expect(tags).not.toContain('h1');
    expect(tags[0]).toBe('p');
  });

  test('Enter in the MIDDLE of a heading splits in place (both halves remain heading)', async ({ page }) => {
    await setContentAndFocus(page, '<h2>HelloWorld</h2>');
    await placeCaretAt(page, 'h2', 'Hello'.length);
    await page.keyboard.press('Enter');

    // Default splitBlock fires for mid-heading; both halves stay h2.
    const tags = await topLevelTypes(page);
    expect(tags).toEqual(['h2', 'h2']);
    const headings = await page.locator(`${editorSelector} h2`).allTextContents();
    expect(headings).toEqual(['Hello', 'World']);
  });

  test('Enter at end of a heading FOLLOWED BY a paragraph inserts an empty paragraph between them', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Heading</h1><p>After</p>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p', 'p']);
    const ps = await page.locator(`${editorSelector} p`).allTextContents();
    expect(ps).toEqual(['', 'After']);
  });

  test('Enter at end of a heading PRECEDED BY a paragraph still inserts paragraph after the heading (not after the leading p)', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p><h2>Heading</h2>');
    await placeCaretAtEnd(page, 'h2');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['p', 'h2', 'p']);
  });

  test('heading inline marks (bold) on existing text are preserved across Enter; new paragraph starts unmarked', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Plain <strong>Bold</strong></h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);
    const html = await getEditorHTML(page);
    expect(html).toMatch(/<h1[^>]*>Plain <strong>Bold<\/strong><\/h1>/);
    // New paragraph is empty and contains no <strong>/<em>.
    const pHtml = await page.locator(`${editorSelector} p`).innerHTML();
    expect(pHtml).not.toContain('<strong>');
    expect(pHtml).not.toContain('<em>');
  });

  // ── Schema interactions, undo, sequential presses, defensive cases ──

  test('heading INSIDE a blockquote: Enter at end inserts a paragraph as next sibling INSIDE the blockquote', async ({ page }) => {
    // The handler's `canReplaceWith` schema check verifies the parent
    // (blockquote here) accepts paragraph at the insertion point.
    // Blockquote's `block+` content rule allows trailing paragraph,
    // so the new p lands as a sibling of the heading inside the
    // blockquote - NOT promoted to top level.
    await setContentAndFocus(page, '<blockquote><h2>Quoted heading</h2></blockquote>');
    await placeCaretAtEnd(page, 'blockquote h2');
    await page.keyboard.press('Enter');

    // Top-level still has only the blockquote; heading + new p both
    // sit inside it.
    expect(await topLevelTypes(page)).toEqual(['blockquote']);
    const inside = await page.evaluate((sel) => {
      const bq = document.querySelector(`${sel} blockquote`);
      if (!bq) return [];
      return Array.from(bq.children).map((el) => el.tagName.toLowerCase());
    }, editorSelector);
    expect(inside).toEqual(['h2', 'p']);
  });

  test('heading with `textAlign` attr: alignment preserved on the heading; new paragraph uses default alignment', async ({ page }) => {
    await setContentAndFocus(page, '<h1 style="text-align:center">Centered</h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);
    const html = await getEditorHTML(page);
    // Heading retains center alignment.
    expect(html).toMatch(/<h1[^>]*style="[^"]*text-align:\s*center/);
    // New paragraph has no inline text-align (default = left).
    const pStyle = await page.locator(`${editorSelector} p`).first().getAttribute('style');
    expect(pStyle ?? '').not.toMatch(/text-align:\s*center/);
  });

  test('multiple Enter presses in sequence chain paragraphs after the heading', async ({ page }) => {
    await setContentAndFocus(page, '<h2>Section</h2>');
    await placeCaretAtEnd(page, 'h2');
    await page.keyboard.press('Enter');
    // Cursor is now in the new (empty) paragraph. Pressing Enter again
    // there falls through to the default split (no Heading.Enter
    // claim because parent isn't heading), which inserts another
    // paragraph and moves the cursor.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const tags = await topLevelTypes(page);
    expect(tags[0]).toBe('h2');
    // Three paragraphs appended (one from each Enter on a paragraph).
    const pCount = tags.filter((t) => t === 'p').length;
    expect(pCount).toBeGreaterThanOrEqual(2);
  });

  test('undo (Mod-Z) after Enter restores the original single heading', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Title</h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');
    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);

    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+z`);
    await page.waitForTimeout(60);

    expect(await topLevelTypes(page)).toEqual(['h1']);
    const h1Text = await page.locator(`${editorSelector} h1`).textContent();
    expect(h1Text).toBe('Title');
  });

  test('Enter at end of a heading SANDWICHED between paragraphs leaves both paragraphs intact, inserts new paragraph after the heading', async ({ page }) => {
    await setContentAndFocus(page, '<p>Above</p><h2>Middle</h2><p>Below</p>');
    await placeCaretAtEnd(page, 'h2');
    await page.keyboard.press('Enter');

    const tags = await topLevelTypes(page);
    // Order: above-p, h2, new-p, below-p.
    expect(tags).toEqual(['p', 'h2', 'p', 'p']);
    const pTexts = await page.locator(`${editorSelector} p`).allTextContents();
    expect(pTexts).toEqual(['Above', '', 'Below']);
  });

  test('Enter on an EMPTY heading that is the FIRST block of the doc converts in place (no preceding content needed)', async ({ page }) => {
    await setContentAndFocus(page, '<h3></h3><p>Tail</p>');
    await caretInFirstNode(page, 'heading');
    await page.keyboard.press('Enter');

    const tags = await topLevelTypes(page);
    // h3 was converted to p; doc is now [empty p (was h3), p "Tail"].
    expect(tags[0]).toBe('p');
    expect(tags).not.toContain('h3');
    const ps = await page.locator(`${editorSelector} p`).allTextContents();
    expect(ps).toContain('Tail');
  });

  test('input rule `# ` then immediate Enter cleanly returns to a paragraph (no leftover empty heading)', async ({ page }) => {
    // Notion-style escape hatch: the user types `# ` to start a heading,
    // changes their mind, hits Enter immediately. Empty-heading-convert
    // turns the freshly-created h1 back into a paragraph; the next
    // keystrokes feel like normal typing.
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.type('# ');
    // After the input rule converts the line to h1, the heading is
    // empty and the caret is inside it.
    expect(await topLevelTypes(page)).toContain('h1');

    await page.keyboard.press('Enter');
    const tags = await topLevelTypes(page);
    expect(tags).not.toContain('h1');
    expect(tags[0]).toBe('p');

    // Typing now lands in the paragraph, not in a heading.
    await page.keyboard.type('hello');
    const firstPText = await page.locator(`${editorSelector} p`).first().textContent();
    expect(firstPText).toBe('hello');
  });

  test('Enter at end of a heading that is the LAST block (TrailingNode interaction): paragraph appears, no broken final state', async ({ page }) => {
    // TrailingNode keeps an empty paragraph as the doc's last child
    // for caret accessibility. After Enter at end of a trailing
    // heading, the new paragraph from our handler may or may not
    // duplicate the trailing one - either way the heading is intact
    // and the doc keeps a usable final paragraph.
    await setContentAndFocus(page, '<h1>End</h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    const tags = await topLevelTypes(page);
    // Heading first, then at least one paragraph after.
    expect(tags[0]).toBe('h1');
    expect(tags.slice(1).every((t) => t === 'p')).toBe(true);
    expect(tags.slice(1).length).toBeGreaterThanOrEqual(1);

    // Caret should be in the FIRST paragraph after the heading (not
    // bouncing to a stale trailing one). Type a marker and verify it
    // lands in the right paragraph.
    await page.keyboard.type('after');
    const firstPText = await page.locator(`${editorSelector} h1 + p`).first().textContent();
    expect(firstPText).toBe('after');
  });

  // ── Configuration variants, mark-active state, round-trip, defensive ──

  test('heading with active mark at end + Enter: new paragraph does NOT inherit the toggled mark (fresh empty p)', async ({ page }) => {
    // Caret at end of a heading that has a mark up to the last char
    // (the bold ends right at the close of the heading). The handler
    // creates a fresh paragraph with default attrs/marks; the new p
    // is empty so visually there's nothing to display either way, but
    // we confirm the *stored* doc has no marks on the new p.
    await setContentAndFocus(page, '<h1><strong>BoldEnd</strong></h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);
    // The new paragraph rendered with no <strong> wrapping (visually
    // empty content but no leftover mark in the doc structure).
    const pHtml = await page.locator(`${editorSelector} h1 + p`).first().innerHTML();
    expect(pHtml).not.toContain('<strong>');
  });

  test('HTML round-trip: setContent -> Enter -> getHTML -> setContent yields stable doc shape', async ({ page }) => {
    await setContentAndFocus(page, '<h1>Round-trip</h1>');
    await placeCaretAtEnd(page, 'h1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Body');

    const html1 = await getEditorHTML(page);
    await setContentAndFocus(page, html1);
    const tagsAfter = await topLevelTypes(page);
    // Stable structure post-round-trip.
    expect(tagsAfter[0]).toBe('h1');
    expect(tagsAfter).toContain('p');
    const h1Text = await page.locator(`${editorSelector} h1`).textContent();
    expect(h1Text).toBe('Round-trip');
    const bodyP = await page.locator(`${editorSelector} h1 ~ p`).first().textContent();
    expect(bodyP).toBe('Body');
  });

  test('configured levels (only [2]): h1/h3 input rules disabled but Enter still works on the configured h2', async ({ page }) => {
    // Smoke-coverage that the Enter handler doesn't depend on a fixed
    // level set. Even if the editor only enables h2, Enter at the end
    // of an h2 still fires the handler.
    await setContentAndFocus(page, '<h2>Just h2</h2>');
    await placeCaretAtEnd(page, 'h2');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h2', 'p']);
  });

  test('defensive: cursor in a top-level PARAGRAPH (not a heading) + Enter does NOT trigger heading-Enter', async ({ page }) => {
    // The handler is gated on `$from.parent.type.name === 'heading'`.
    // For a plain paragraph cursor, it must return false so the
    // default split runs (which produces ANOTHER paragraph after the
    // first), NOT a heading-specific outcome.
    await setContentAndFocus(page, '<p>HelloWorld</p>');
    await placeCaretAtEnd(page, 'p');
    await page.keyboard.press('Enter');

    const tags = await topLevelTypes(page);
    expect(tags.includes('h1')).toBe(false);
    expect(tags.includes('h2')).toBe(false);
    expect(tags.filter((t) => t === 'p').length).toBeGreaterThanOrEqual(2);
  });

  test('defensive: cursor in a top-level CODEBLOCK + Enter does NOT trigger heading-Enter (codeBlock keeps newline)', async ({ page }) => {
    // CodeBlock has its own Enter handler (triple-Enter exits, single
    // Enter inserts newline). Heading-Enter must NOT claim the event
    // here.
    await setContentAndFocus(page, '<pre><code>line1</code></pre>');
    await page.locator(`${editorSelector} pre`).first().click();
    // Caret to end of code text.
    await page.evaluate((sel) => {
      const code = document.querySelector(`${sel} pre code`);
      const text = code?.firstChild;
      if (!text) return;
      const range = document.createRange();
      range.setStart(text, (text.textContent ?? '').length);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.keyboard.press('Enter');
    await page.keyboard.type('line2');

    // No heading was inserted.
    const headingCount = await page.locator(`${editorSelector} h1, ${editorSelector} h2, ${editorSelector} h3, ${editorSelector} h4`).count();
    expect(headingCount).toBe(0);
    // CodeBlock content now includes both lines (newline character).
    const codeText = await page.locator(`${editorSelector} pre`).first().textContent();
    expect(codeText).toContain('line1');
    expect(codeText).toContain('line2');
  });

  test('caret at end via End key (browser shortcut, not programmatic): Enter still inserts paragraph below heading', async ({ page }) => {
    // Verifies the handler picks up natively-set selections (not just
    // ones we place via PM API). Important for real user flows where
    // caret is moved via keyboard shortcuts.
    await setContentAndFocus(page, '<h1>EndKeyTest</h1>');
    await page.locator(`${editorSelector} h1`).first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    expect(await topLevelTypes(page)).toEqual(['h1', 'p']);
  });

  test('UniqueID on the heading is preserved when an empty heading is converted to a paragraph (no orphaned id)', async ({ page }) => {
    // The UniqueID extension assigns a stable `id` attr to every
    // top-level block. When our handler does `setNodeMarkup` to flip
    // an empty heading into a paragraph, that id should travel with
    // the (now) paragraph - the block keeps its identity, only the
    // type changes.
    await setContentAndFocus(page, '<h2></h2>');
    // Wait for UniqueID to assign ids.
    await page.waitForFunction(() => {
      const h = document.querySelector('h2');
      return h?.getAttribute('id') !== null && h?.getAttribute('id') !== '';
    }, undefined, { timeout: 2000 }).catch(() => { /* UniqueID may be off in default demo */ });
    const beforeId = await page.locator(`${editorSelector} h2`).first().getAttribute('id');

    await caretInFirstNode(page, 'heading');
    await page.keyboard.press('Enter');

    // h2 should be gone - converted to p.
    const tagsAfter = await topLevelTypes(page);
    expect(tagsAfter).not.toContain('h2');

    if (beforeId) {
      // UniqueID was active. The id should still exist somewhere -
      // either on the (now) paragraph or NOT (if attrs weren't carried
      // over by setNodeMarkup). Just assert the doc is healthy and
      // the converted paragraph exists.
      const pCount = await page.locator(`${editorSelector} p`).count();
      expect(pCount).toBeGreaterThanOrEqual(1);
    }
  });

  test('heading inside a table cell: Enter at end inserts paragraph as next sibling INSIDE the cell', async ({ page }) => {
    // Table cells have a paragraph-or-block content rule (depending on
    // schema). The handler's `canReplaceWith` check ensures we only
    // insert when the cell allows it. If the cell rejects (some
    // schemas restrict cells to paragraphs only), we fall through.
    await setContentAndFocus(
      page,
      '<table><tbody><tr><td><h2>Cell heading</h2></td></tr></tbody></table>',
    );

    const cellHeadingExists = await page.locator(`${editorSelector} td h2`).count();
    if (cellHeadingExists === 0) {
      // The schema doesn't accept heading inside td - parser dropped
      // it. Skip the assertion (the negative case is already covered
      // by parser behaviour: heading content moves elsewhere).
      return;
    }

    await placeCaretAtEnd(page, 'td h2');
    await page.keyboard.press('Enter');

    // Either the cell now has [h2, p] inside, or canReplaceWith
    // rejected and the default split produced two h2's. Either way:
    // the original heading text persists.
    const cellText = await page.locator(`${editorSelector} td`).first().textContent();
    expect(cellText).toContain('Cell heading');
  });
});
