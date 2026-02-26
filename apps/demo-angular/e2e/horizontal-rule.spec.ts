import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const hrButton = 'button[aria-label="Horizontal Rule"]';

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

/** Focus the editor and place cursor at end of Nth matching element */
async function focusEnd(page: Page, tag = 'p', index = 0) {
  await page.evaluate(({ sel, tag, index }) => {
    const editor = document.querySelector(sel) as HTMLElement;
    editor?.focus();
    const els = editor?.querySelectorAll(tag);
    const el = els?.[index];
    if (!el) return;
    let node: Node = el;
    while (node.lastChild) node = node.lastChild;
    const range = document.createRange();
    range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
    range.collapse(true);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(range);
  }, { sel: editorSelector, tag, index });
  await page.waitForTimeout(50);
}

/** Focus the editor and place cursor at start of Nth matching element */
async function focusStart(page: Page, tag = 'p', index = 0) {
  await page.evaluate(({ sel, tag, index }) => {
    const editor = document.querySelector(sel) as HTMLElement;
    editor?.focus();
    const els = editor?.querySelectorAll(tag);
    const el = els?.[index];
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
  await page.waitForTimeout(50);
}

/** Check HTML contains an <hr ...> tag (ProseMirror renders with attributes like contenteditable="false") */
function expectHR(html: string) {
  expect(html).toMatch(/<hr[\s>]/);
}

/** Check HTML does NOT contain any <hr ...> tag */
function expectNoHR(html: string) {
  expect(html).not.toMatch(/<hr[\s>]/);
}

/** Count occurrences of <hr> tags in editor HTML */
function countHRs(html: string): number {
  return (html.match(/<hr[\s>]/g) || []).length;
}

/** Count occurrences of a tag in editor HTML */
function countTag(html: string, tag: string): number {
  const regex = new RegExp(`<${tag}[\\s>]`, 'g');
  return (html.match(regex) || []).length;
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const PARAGRAPH = '<p>Hello world</p>';
const EMPTY_PARAGRAPH = '<p></p>';
const TWO_PARAGRAPHS = '<p>first paragraph</p><p>second paragraph</p>';
const HR_BETWEEN = '<p>before</p><hr><p>after</p>';
const MULTIPLE_HRS = '<p>one</p><hr><p>two</p><hr><p>three</p>';
const HEADING_PARA = '<h2>My Heading</h2><p>Some text</p>';
const BLOCKQUOTE_PARA = '<blockquote><p>quoted text</p></blockquote><p>normal text</p>';
const LIST_CONTENT = '<ul><li><p>item one</p></li><li><p>item two</p></li></ul>';

// ─── Toolbar button ──────────────────────────────────────────────────

test.describe('HorizontalRule — toolbar button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button is visible', async ({ page }) => {
    await expect(page.locator(hrButton)).toBeVisible();
  });

  test('toolbar button has correct label', async ({ page }) => {
    const button = page.locator(hrButton);
    await expect(button).toHaveAttribute('aria-label', 'Horizontal Rule');
  });

  test('toolbar button is not a dropdown', async ({ page }) => {
    const button = page.locator(hrButton);
    await expect(button).not.toHaveAttribute('aria-haspopup');
  });
});

// ─── Insert via toolbar ──────────────────────────────────────────────

test.describe('HorizontalRule — insert via toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insert HR into empty paragraph', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
  });

  test('insert HR from paragraph with text — cursor at end', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('Hello world');
  });

  test('insert HR from paragraph with text — cursor at start', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusStart(page);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('Hello world');
  });

  test('HR inserts as block-level element (not inline)', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.locator(hrButton).click();

    // HR should exist as its own DOM element, not inside a <p>
    const hrInsideP = await page.evaluate((sel) => {
      const hrs = document.querySelectorAll(sel + ' hr');
      for (const hr of hrs) {
        if (hr.parentElement?.tagName === 'P') return true;
      }
      return false;
    }, editorSelector);
    expect(hrInsideP).toBe(false);
  });

  test('new paragraph is created after HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(countTag(html, 'p')).toBeGreaterThanOrEqual(1);
  });

  test('cursor moves to new paragraph after HR insertion', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(hrButton).click();

    // Type text — should appear in a paragraph (cursor lands in a paragraph)
    await page.keyboard.type('after hr');
    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('after hr');
    // Text should be in a paragraph, not inside the HR
    expect(html).toMatch(/<p[^>]*>after hr<\/p>/);
  });

  test('multiple HR insertions via toolbar', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(hrButton).click();
    await page.waitForTimeout(50);
    await page.locator(hrButton).click();
    await page.waitForTimeout(50);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(3);
  });
});

// ─── Input rules (markdown shortcuts) ────────────────────────────────

test.describe('HorizontalRule — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('--- followed by space creates HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('--- ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectHR(html);
    // The "--- " text should be consumed
    expect(html).not.toContain('---');
  });

  test('*** followed by space creates HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('*** ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).not.toContain('***');
  });

  test('___ followed by space creates HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('___ ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).not.toContain('___');
  });

  test('-- (two dashes) does NOT create HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('-- ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('--');
  });

  test('** (two asterisks) does NOT create HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('** ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectNoHR(html);
  });

  test('---- (four dashes) does NOT create HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('---- ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectNoHR(html);
  });

  test('--- without trailing space does NOT create HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('---', { delay: 30 });

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('---');
  });

  test('input rule in non-empty paragraph does NOT trigger', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.keyboard.type('--- ', { delay: 30 });

    const html = await getEditorHTML(page);
    expectNoHR(html);
  });

  test('cursor moves after HR created by input rule', async ({ page }) => {
    // Need two paragraphs so cursor can move to the second after input rule fires
    await setContentAndFocus(page, '<p></p><p>existing</p>');
    // Click the first (empty) paragraph to place cursor there
    await page.locator(`${editorSelector} p`).first().click();
    await page.keyboard.type('--- ', { delay: 30 });
    await page.keyboard.type('typed after');

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('typed after');
  });
});

// ─── parseHTML ────────────────────────────────────────────────────────

test.describe('HorizontalRule — parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parses <hr> from HTML', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('parses multiple HRs from HTML', async ({ page }) => {
    await setContentAndFocus(page, MULTIPLE_HRS);

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(2);
    expect(html).toContain('one');
    expect(html).toContain('two');
    expect(html).toContain('three');
  });

  test('parses <hr> at the start of document', async ({ page }) => {
    await setContentAndFocus(page, '<hr><p>content after</p>');

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('content after');
  });

  test('HR preserves surrounding paragraph text', async ({ page }) => {
    await setContentAndFocus(page, '<p>above</p><hr><p>below</p>');

    const html = await getEditorHTML(page);
    const hrMatch = /<hr[\s>]/.exec(html);
    const aboveIdx = html.indexOf('above');
    const belowIdx = html.indexOf('below');
    expect(aboveIdx).toBeLessThan(hrMatch!.index);
    expect(belowIdx).toBeGreaterThan(hrMatch!.index);
  });

  test('consecutive HRs with text between', async ({ page }) => {
    await setContentAndFocus(page, '<p>a</p><hr><p>b</p><hr><p>c</p><hr><p>d</p>');

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(3);
  });
});

// ─── Rendering ────────────────────────────────────────────────────────

test.describe('HorizontalRule — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('HR renders as visible element in DOM', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);

    const hr = page.locator(`${editorSelector} hr`);
    await expect(hr).toBeVisible();
  });

  test('HR renders as self-closing element', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('</hr>');
  });

  test('HR is not editable (cannot type inside it)', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);

    // Click on the HR — selects it as a node
    await page.locator(`${editorSelector} hr`).click();
    // Typing replaces node selection; text goes into a paragraph
    await page.keyboard.type('should not appear inside hr');

    const html = await getEditorHTML(page);
    // The text should exist in a paragraph, the HR should be replaced
    expect(html).toContain('should not appear inside hr');
  });

  test('HR has correct document structure (p then hr then p)', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);

    const children = await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      if (!editor) return [];
      return Array.from(editor.children).map(c => c.tagName.toLowerCase());
    }, editorSelector);

    expect(children).toContain('p');
    expect(children).toContain('hr');
    const hrIndex = children.indexOf('hr');
    expect(hrIndex).toBeGreaterThan(0);
    expect(children[hrIndex - 1]).toBe('p');
    expect(children[hrIndex + 1]).toBe('p');
  });
});

// ─── Cursor behavior around HR ───────────────────────────────────────

test.describe('HorizontalRule — cursor behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('can type in paragraph before HR', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await focusEnd(page, 'p', 0);
    await page.keyboard.type(' added');

    const html = await getEditorHTML(page);
    expect(html).toContain('before added');
    expectHR(html);
  });

  test('can type in paragraph after HR', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await focusStart(page, 'p', 1);
    await page.keyboard.type('added ');

    const html = await getEditorHTML(page);
    expect(html).toContain('added after');
    expectHR(html);
  });

  test('arrow down from above HR navigates past it', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await focusEnd(page, 'p', 0);
    // ArrowDown should move past the HR to the paragraph after it
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('x');

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('x');
  });

  test('clicking HR selects it as node selection', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await page.locator(`${editorSelector} hr`).click();

    const hasSelectedClass = await page.evaluate((sel) => {
      const hr = document.querySelector(sel + ' hr');
      return hr?.classList.contains('ProseMirror-selectednode') ?? false;
    }, editorSelector);

    expect(hasSelectedClass).toBe(true);
  });

  test('pressing Delete on selected HR removes it', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await page.locator(`${editorSelector} hr`).click();
    await page.keyboard.press('Delete');

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  test('pressing Backspace on selected HR removes it', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await page.locator(`${editorSelector} hr`).click();
    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('before');
    expect(html).toContain('after');
  });
});

// ─── Undo / Redo ─────────────────────────────────────────────────────

test.describe('HorizontalRule — undo/redo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo after toolbar insert removes HR', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.locator(hrButton).click();

    let html = await getEditorHTML(page);
    expectHR(html);

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('Hello world');
  });

  test('redo after undo restores HR', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.locator(hrButton).click();

    await page.keyboard.press(`${modifier}+Z`);
    let html = await getEditorHTML(page);
    expectNoHR(html);

    await page.keyboard.press(`${modifier}+Shift+Z`);
    html = await getEditorHTML(page);
    expectHR(html);
  });

  test('undo after input rule removes HR', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('--- ', { delay: 30 });

    let html = await getEditorHTML(page);
    expectHR(html);

    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectNoHR(html);
  });

  test('undo after delete restores HR', async ({ page }) => {
    // Use pre-existing HR content so undo history is clean
    await setContentAndFocus(page, HR_BETWEEN);
    await page.waitForTimeout(200);

    // Select and delete the HR
    await page.locator(`${editorSelector} hr`).click();
    await page.waitForTimeout(200);
    await page.keyboard.press('Delete');

    let html = await getEditorHTML(page);
    expectNoHR(html);

    // Undo the delete
    await page.keyboard.press(`${modifier}+Z`);
    html = await getEditorHTML(page);
    expectHR(html);
  });
});

// ─── Interaction with other blocks ────────────────────────────────────

test.describe('HorizontalRule — interaction with other blocks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insert HR after heading', async ({ page }) => {
    await setContentAndFocus(page, HEADING_PARA);
    await focusEnd(page, 'h2');
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expectHR(html);
    expect(html).toContain('My Heading');
  });

  test('insert HR between two paragraphs', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await focusEnd(page, 'p', 0);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');
  });

  test('insert HR after blockquote', async ({ page }) => {
    await setContentAndFocus(page, BLOCKQUOTE_PARA);
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const bq = editor?.querySelector('blockquote p');
      if (!bq) return;
      let node: Node = bq;
      while (node.lastChild) node = node.lastChild;
      const range = document.createRange();
      range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.waitForTimeout(50);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
  });

  test('HR between heading and paragraph preserves both', async ({ page }) => {
    await setContentAndFocus(page, '<h2>Title</h2><p>Body text</p>');
    await focusEnd(page, 'h2');
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expectHR(html);
    expect(html).toContain('Title');
    expect(html).toContain('Body text');
  });

  test('insert HR inside list', async ({ page }) => {
    await setContentAndFocus(page, LIST_CONTENT);
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const li = editor?.querySelector('li p');
      if (!li) return;
      let node: Node = li;
      while (node.lastChild) node = node.lastChild;
      const range = document.createRange();
      range.setStart(node, node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : 0);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.waitForTimeout(50);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
  });
});

// ─── Multiple HRs ────────────────────────────────────────────────────

test.describe('HorizontalRule — multiple HRs', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('parse and render multiple HRs with text between', async ({ page }) => {
    await setContentAndFocus(page, MULTIPLE_HRS);

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(2);

    const hrs = page.locator(`${editorSelector} hr`);
    await expect(hrs).toHaveCount(2);
  });

  test('delete one HR leaves others intact', async ({ page }) => {
    await setContentAndFocus(page, MULTIPLE_HRS);
    await page.locator(`${editorSelector} hr`).first().click();
    await page.keyboard.press('Delete');

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(1);
    expect(html).toContain('one');
    expect(html).toContain('two');
    expect(html).toContain('three');
  });

  test('insert HR adds to existing count', async ({ page }) => {
    await setContentAndFocus(page, MULTIPLE_HRS);
    await focusEnd(page, 'p', 2);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(3);
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────

test.describe('HorizontalRule — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insert HR in empty editor creates HR + empty paragraph', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(countTag(html, 'p')).toBeGreaterThanOrEqual(1);
  });

  test('insert HR at end of multi-paragraph document', async ({ page }) => {
    await setContentAndFocus(page, TWO_PARAGRAPHS);
    await focusEnd(page, 'p', 1);
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('first paragraph');
    expect(html).toContain('second paragraph');
  });

  test('HR does not merge with adjacent HRs', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    // Place cursor in paragraph after HR and clear it
    await focusStart(page, 'p', 1);
    await page.keyboard.press(`${modifier}+A`);
    await page.waitForTimeout(50);
    // Focus just the second paragraph and delete its text
    await page.evaluate((sel) => {
      const editor = document.querySelector(sel) as HTMLElement;
      editor?.focus();
      const ps = editor?.querySelectorAll('p');
      const p = ps?.[ps.length - 1];
      if (!p) return;
      const textNode = p.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(50);
    // Now insert HR in the empty paragraph
    await page.locator(hrButton).click();

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBeGreaterThanOrEqual(2);
  });

  test('HR with styled text around it preserves styles', async ({ page }) => {
    await setContentAndFocus(page, '<p><strong>bold above</strong></p><hr><p><em>italic below</em></p>');

    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toMatch(/strong|font-weight/);
    expect(html).toContain('bold above');
    expect(html).toContain('<em>');
    expect(html).toContain('italic below');
  });

  test('Enter before HR creates new paragraph, not HR', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await focusEnd(page, 'p', 0);
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(1);
    expect(countTag(html, 'p')).toBeGreaterThanOrEqual(3);
  });

  test('Enter after HR creates new paragraph', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await focusStart(page, 'p', 1);
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(1);
    expect(countTag(html, 'p')).toBeGreaterThanOrEqual(3);
  });

  test('HR inside complex document preserves structure', async ({ page }) => {
    const complex = '<h1>Title</h1><p>Intro</p><hr><h2>Section</h2><p>Body</p><hr><p>Footer</p>';
    await setContentAndFocus(page, complex);

    const html = await getEditorHTML(page);
    expect(countHRs(html)).toBe(2);
    expect(html).toContain('Title');
    expect(html).toContain('Intro');
    expect(html).toContain('Section');
    expect(html).toContain('Body');
    expect(html).toContain('Footer');
  });

  test('text typed after HR insertion goes into new paragraph', async ({ page }) => {
    await setContentAndFocus(page, PARAGRAPH);
    await focusEnd(page);
    await page.locator(hrButton).click();
    await page.waitForTimeout(50);
    await page.keyboard.type('new content');

    const html = await getEditorHTML(page);
    expect(html).toContain('new content');
    const origIdx = html.indexOf('Hello world');
    const hrMatch = /<hr[\s>]/.exec(html);
    const newIdx = html.indexOf('new content');
    expect(origIdx).toBeLessThan(hrMatch!.index);
    expect(hrMatch!.index).toBeLessThan(newIdx);
  });
});

// ─── Select all with HR ──────────────────────────────────────────────

test.describe('HorizontalRule — select all', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Ctrl+A selects content including HR', async ({ page }) => {
    await setContentAndFocus(page, HR_BETWEEN);
    await page.locator(editorSelector).click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.press('Backspace');

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).not.toContain('before');
    expect(html).not.toContain('after');
  });

  test('Ctrl+A then type replaces everything including HR', async ({ page }) => {
    await setContentAndFocus(page, MULTIPLE_HRS);
    await page.locator(editorSelector).click();
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.type('replaced');

    const html = await getEditorHTML(page);
    expectNoHR(html);
    expect(html).toContain('replaced');
  });
});

// ─── Copy/paste with HR ──────────────────────────────────────────────

test.describe('HorizontalRule — copy/paste', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('paste HTML with HR preserves it', async ({ page }) => {
    await setContentAndFocus(page, EMPTY_PARAGRAPH);
    await page.locator(`${editorSelector} p`).click();

    await page.evaluate((sel) => {
      const editor = document.querySelector(sel);
      if (!editor) return;
      const dt = new DataTransfer();
      dt.setData('text/html', '<p>pasted above</p><hr><p>pasted below</p>');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
    }, editorSelector);

    await page.waitForTimeout(100);
    const html = await getEditorHTML(page);
    expectHR(html);
    expect(html).toContain('pasted above');
    expect(html).toContain('pasted below');
  });
});
