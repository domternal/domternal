import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';

/**
 * Helper: set editor content by replacing ProseMirror innerHTML and
 * dispatching an input event so ProseMirror picks up the change.
 * Optionally click on `focusSelector` to place cursor there.
 */
async function setContentAndFocus(
  page: Page,
  html: string,
  focusSelector?: string,
) {
  const editor = page.locator(editorSelector);
  await editor.evaluate((el, h) => {
    el.innerHTML = h;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);

  // Give ProseMirror a tick to parse the new DOM
  await page.waitForTimeout(100);

  if (focusSelector) {
    const el = page.locator(`${editorSelector} ${focusSelector}`);
    await el.click();
    await page.keyboard.press('End');
  }
}

/**
 * Helper: get the editor's HTML from the DOM.
 */
async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/**
 * Count how many times a substring appears in a string.
 */
function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

// ─── Nested task list content (taskList inside orderedList) ────────────
const NESTED_TASK_IN_OL = [
  '<ol>',
  '  <li><p>ordered item 1</p></li>',
  '  <li>',
  '    <p>ordered item 2</p>',
  '    <ul data-type="taskList">',
  '      <li data-type="taskItem" data-checked="false">',
  '        <label contenteditable="false"><input type="checkbox"></label>',
  '        <div><p>nested task 1</p></div>',
  '      </li>',
  '    </ul>',
  '  </li>',
  '</ol>',
].join('');

// Nested task list inside bullet list
const NESTED_TASK_IN_UL = [
  '<ul>',
  '  <li><p>bullet item 1</p></li>',
  '  <li>',
  '    <p>bullet item 2</p>',
  '    <ul data-type="taskList">',
  '      <li data-type="taskItem" data-checked="false">',
  '        <label contenteditable="false"><input type="checkbox"></label>',
  '        <div><p>nested task A</p></div>',
  '      </li>',
  '    </ul>',
  '  </li>',
  '</ul>',
].join('');

// Standalone (non-nested) task list
const STANDALONE_TASK = [
  '<ul data-type="taskList">',
  '  <li data-type="taskItem" data-checked="false">',
  '    <label contenteditable="false"><input type="checkbox"></label>',
  '    <div><p>standalone task 1</p></div>',
  '  </li>',
  '</ul>',
].join('');

// Standalone ordered list
const STANDALONE_OL = [
  '<ol>',
  '  <li><p>ol item 1</p></li>',
  '  <li><p>ol item 2</p></li>',
  '</ol>',
].join('');

// Nested task list with empty task item (only task)
const NESTED_EMPTY_TASK_IN_OL = [
  '<ol>',
  '  <li><p>ordered item 1</p></li>',
  '  <li>',
  '    <p>ordered item 2</p>',
  '    <ul data-type="taskList">',
  '      <li data-type="taskItem" data-checked="false">',
  '        <label contenteditable="false"><input type="checkbox"></label>',
  '        <div><p></p></div>',
  '      </li>',
  '    </ul>',
  '  </li>',
  '</ol>',
].join('');

// ─── Tests ─────────────────────────────────────────────────────────────

test.describe('Nested lists — Enter key behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // ── Baseline tests (non-nested) ──────────────────────────────────────

  test('baseline: Enter in standalone taskItem creates new taskItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, STANDALONE_TASK);

    const taskDiv = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskDiv.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
    expect(html).toContain('data-type="taskList"');
  });

  test('baseline: Enter in standalone orderedList creates new listItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, STANDALONE_OL);

    const lastLi = page.locator(`${editorSelector} ol li`).last();
    await lastLi.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(countOccurrences(html, '<li>')).toBeGreaterThanOrEqual(3);
  });

  // ── Nested taskList in orderedList ───────────────────────────────────

  test('Enter on non-empty nested taskItem (in orderedList) creates new taskItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('<ol>');
    expect(html).toContain('data-type="taskList"');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
  });

  test('Enter does NOT destroy parent orderedList structure when pressing Enter multiple times', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
  });

  test('Enter + typing in nested taskItem preserves structure and adds text', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('nested task 2');

    const html = await getEditorHTML(page);

    expect(html).toContain('<ol>');
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('nested task 1');
    expect(html).toContain('nested task 2');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
  });

  // ── Nested taskList in bulletList ────────────────────────────────────

  test('Enter on nested taskItem (in bulletList) creates new taskItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_UL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('bullet item 1');
    expect(html).toContain('bullet item 2');
    expect(html).toContain('data-type="taskList"');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
  });

  // ── Regression: repeated Enter should not unwrap parents one by one ──

  test('REGRESSION: repeated Enter in nested taskItem must not strip parent list levels', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    const htmlBefore = await getEditorHTML(page);
    const olCountBefore = countOccurrences(htmlBefore, '<ol>');

    // Press Enter once — should split, not unwrap
    await page.keyboard.press('Enter');
    const htmlAfter1 = await getEditorHTML(page);
    const olCountAfter1 = countOccurrences(htmlAfter1, '<ol>');

    expect(olCountAfter1).toBeGreaterThanOrEqual(olCountBefore);

    // Press Enter again (on empty task item) — may lift out of taskList,
    // but should NOT destroy the parent orderedList
    await page.keyboard.press('Enter');
    const htmlAfter2 = await getEditorHTML(page);

    expect(htmlAfter2).toContain('<ol>');
    expect(htmlAfter2).toContain('ordered item 1');
  });

  test('REGRESSION: Enter after typing text in nested taskItem splits correctly', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    await page.keyboard.type(' more text');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
    expect(html).toContain('nested task 1 more text');
  });

  // ── Empty nested taskItem — should create parent listItem ─────────────

  test('Enter on empty nested taskItem (in orderedList) creates new parent listItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // First Enter: split creates new empty taskItem
    await page.keyboard.press('Enter');

    // Second Enter: empty taskItem should create a new listItem in the parent orderedList
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
    expect(html).toContain('nested task 1');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(1);

    const olItems = page.locator(`${editorSelector} ol > li`);
    expect(await olItems.count()).toBe(3);
  });

  test('Enter on empty nested taskItem (in bulletList) creates new parent listItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_UL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // First Enter: split creates new empty taskItem
    await page.keyboard.press('Enter');

    // Second Enter: empty taskItem should create new listItem in parent bulletList
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('bullet item 1');
    expect(html).toContain('bullet item 2');
    expect(html).toContain('nested task A');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(1);

    const ulItems = page.locator(
      `${editorSelector} ul:not([data-type="taskList"]) > li`,
    );
    expect(await ulItems.count()).toBe(3);
  });

  test('Enter on only empty nested taskItem removes taskList and creates new parent listItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_EMPTY_TASK_IN_OL);

    // Click on the taskItem's div container to place cursor in the empty paragraph
    const taskDiv = page.locator(
      `${editorSelector} li[data-type="taskItem"] div`,
    );
    await taskDiv.click({ position: { x: 5, y: 5 } });

    // Enter on the empty taskItem should create a new listItem in orderedList
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');

    // No more task items — the only one was empty and got lifted
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(0);

    // The orderedList should have 3 direct listItems
    const olItems = page.locator(`${editorSelector} ol > li`);
    expect(await olItems.count()).toBe(3);
  });
});
