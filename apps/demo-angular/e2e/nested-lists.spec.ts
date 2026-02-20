import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';

/**
 * Helper: set editor content via the exposed __e2eEditor instance and
 * place cursor at the end of the element matching `focusSelector`.
 */
async function setContentAndFocus(
  page: Page,
  html: string,
  focusSelector?: string,
) {
  await page.evaluate(
    ({ html }) => {
      const editor = (window as unknown as Record<string, unknown>)[
        '__e2eEditor'
      ] as { setContent: (c: string) => void; view: { focus: () => void } };
      editor.setContent(html);
      editor.view.focus();
    },
    { html },
  );

  if (focusSelector) {
    // Click at the end of the target element to place cursor there
    const el = page.locator(`${editorSelector} ${focusSelector}`);
    await el.click();
    await page.keyboard.press('End');
  }
}

/**
 * Helper: get the editor's serialised HTML via __e2eEditor.getHTML()
 */
async function getEditorHTML(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)[
      '__e2eEditor'
    ] as { getHTML: () => string };
    return editor.getHTML();
  });
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

    // Click inside the task item text
    const taskDiv = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskDiv.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    // Should have 2 task items now
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
    // Task list wrapper still present
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
    // Should still have <ol> and now 3 <li> items
    expect(html).toContain('<ol>');
    expect(countOccurrences(html, '<li>')).toBeGreaterThanOrEqual(3);
  });

  // ── Debug: capture actual HTML ────────────────────────────────────────

  test('DEBUG: show HTML after keyboard Enter in nested taskItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    const htmlBefore = await getEditorHTML(page);
    console.log('=== HTML BEFORE Enter ===');
    console.log(htmlBefore);

    await page.keyboard.press('Enter');

    const htmlAfter = await getEditorHTML(page);
    console.log('=== HTML AFTER keyboard Enter ===');
    console.log(htmlAfter);
    console.log('=== taskItem count ===', countOccurrences(htmlAfter, 'data-type="taskItem"'));
    console.log('=== has <ol> ===', htmlAfter.includes('<ol>'));

    expect(true).toBe(true);
  });

  // ── Nested taskList in orderedList ───────────────────────────────────

  test('Enter on non-empty nested taskItem (in orderedList) creates new taskItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    // Click inside the nested task item text
    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    // orderedList must still exist
    expect(html).toContain('<ol>');

    // taskList must still exist
    expect(html).toContain('data-type="taskList"');

    // Should now have 2 task items (original + new)
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);

    // orderedList should still have its list items
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
  });

  test('Enter does NOT destroy parent orderedList structure when pressing Enter multiple times', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    // Click inside the nested task item text
    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // Press Enter 3 times
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    // orderedList must still exist after multiple Enters
    expect(html).toContain('<ol>');

    // Original ordered list items must still be present
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
  });

  test('Enter + typing in nested taskItem preserves structure and adds text', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    // Click inside the nested task item text
    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // Press Enter and type new task text
    await page.keyboard.press('Enter');
    await page.keyboard.type('nested task 2');

    const html = await getEditorHTML(page);

    // orderedList must still exist
    expect(html).toContain('<ol>');
    expect(html).toContain('data-type="taskList"');

    // Both task texts present
    expect(html).toContain('nested task 1');
    expect(html).toContain('nested task 2');

    // 2 task items
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

    // bulletList must still exist (either <ul> without data-type, or just <ul>)
    // The outer <ul> should not have data-type="taskList"
    expect(html).toContain('bullet item 1');
    expect(html).toContain('bullet item 2');

    // taskList must still exist
    expect(html).toContain('data-type="taskList"');

    // Should now have 2 task items
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
  });

  // ── Regression: repeated Enter should not unwrap parents one by one ──

  test('REGRESSION: repeated Enter in nested taskItem must not strip parent list levels', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    // Click inside the nested task item text
    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // Snapshot before
    const htmlBefore = await getEditorHTML(page);
    const olCountBefore = countOccurrences(htmlBefore, '<ol>');

    // Press Enter once — should split, not unwrap
    await page.keyboard.press('Enter');
    const htmlAfter1 = await getEditorHTML(page);
    const olCountAfter1 = countOccurrences(htmlAfter1, '<ol>');

    // The <ol> count should NOT decrease
    expect(olCountAfter1).toBeGreaterThanOrEqual(olCountBefore);

    // Press Enter again (now on empty task item) — may lift out of taskList,
    // but should NOT destroy the parent orderedList
    await page.keyboard.press('Enter');
    const htmlAfter2 = await getEditorHTML(page);

    // orderedList must still exist
    expect(htmlAfter2).toContain('<ol>');
    expect(htmlAfter2).toContain('ordered item 1');
  });

  test('REGRESSION: Enter after typing text in nested taskItem splits correctly', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_TASK_IN_OL);

    // Click inside the nested task item
    const taskP = page.locator(
      `${editorSelector} li[data-type="taskItem"] div p`,
    );
    await taskP.click();
    await page.keyboard.press('End');

    // Type additional text
    await page.keyboard.type(' more text');

    // Press Enter — should split the task item at cursor, creating a new taskItem
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    // Must have 2 task items
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);

    // orderedList structure intact
    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');

    // Original text should be in first task item
    expect(html).toContain('nested task 1 more text');
  });

  // ── Empty nested taskItem — should create parent listItem ─────────────

  test('DEBUG: show HTML after Enter on empty nested taskItem', async ({
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
    const htmlAfter1 = await getEditorHTML(page);
    console.log('=== HTML AFTER 1st Enter (split) ===');
    console.log(htmlAfter1);

    // Second Enter: on the empty taskItem
    await page.keyboard.press('Enter');
    const htmlAfter2 = await getEditorHTML(page);
    console.log('=== HTML AFTER 2nd Enter (empty taskItem) ===');
    console.log(htmlAfter2);
    console.log('=== ol > li count ===', await page.locator(`${editorSelector} ol > li`).count());
    console.log('=== taskItem count ===', countOccurrences(htmlAfter2, 'data-type="taskItem"'));

    expect(true).toBe(true);
  });

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

    // orderedList must still exist
    expect(html).toContain('<ol>');

    // Original content preserved
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');
    expect(html).toContain('nested task 1');

    // The original task item should remain (the empty one was lifted)
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(1);

    // The orderedList should now have 3 direct listItems (was 2, + new empty one)
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

    // bulletList content preserved
    expect(html).toContain('bullet item 1');
    expect(html).toContain('bullet item 2');
    expect(html).toContain('nested task A');

    // The original task item should remain
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(1);

    // The bulletList should now have 3 direct listItems
    const ulItems = page.locator(
      `${editorSelector} ul:not([data-type="taskList"]) > li`,
    );
    expect(await ulItems.count()).toBe(3);
  });

  test('Enter on only empty nested taskItem removes taskList and creates new parent listItem', async ({
    page,
  }) => {
    await setContentAndFocus(page, NESTED_EMPTY_TASK_IN_OL);

    // Place cursor inside the empty taskItem programmatically (empty <p> may be unclickable)
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)[
        '__e2eEditor'
      ] as Record<string, unknown>;
      const state = editor['state'] as Record<string, unknown>;
      const view = editor['view'] as Record<string, unknown>;
      const doc = state['doc'] as { descendants: (cb: (node: { type: { name: string } }, pos: number) => boolean | void) => void; resolve: (pos: number) => unknown };
      const selection = state['selection'] as { constructor: { near: (pos: unknown) => unknown } };
      const tr = state['tr'] as { setSelection: (sel: unknown) => unknown };

      let targetPos = -1;
      doc.descendants((node, pos) => {
        if (node.type.name === 'taskItem') {
          targetPos = pos + 2; // inside the paragraph within the taskItem
          return false;
        }
      });

      if (targetPos >= 0) {
        const $pos = doc.resolve(targetPos);
        const sel = selection.constructor.near($pos);
        (view['dispatch'] as (tr: unknown) => void)(tr.setSelection(sel));
        (view['focus'] as () => void)();
      }
    });

    // Enter on the empty taskItem should create a new listItem in orderedList
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);

    // orderedList must still exist
    expect(html).toContain('<ol>');
    expect(html).toContain('ordered item 1');
    expect(html).toContain('ordered item 2');

    // No more task items
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(0);

    // The orderedList should have 3 direct listItems
    const olItems = page.locator(`${editorSelector} ol > li`);
    expect(await olItems.count()).toBe(3);
  });
});
