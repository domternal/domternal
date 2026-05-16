/**
 * E2E coverage for slash-menu commands invoked from a list-item LABEL
 * paragraph. Notion treats these in two distinct ways:
 *
 *   CONVERT (lift + transform the line):
 *     - Heading 1/2/3 (already covered elsewhere)
 *     - Code block   (already covered elsewhere)
 *     - Quote        (new in this fix)
 *     - Expandable   (new in this fix)
 *
 *   INSERT (keep the list item intact, place new content below):
 *     - Divider, Table, Image, TOC
 *     For mid-list cursors, the parent list is SPLIT around the current
 *     item; the inserted block sits at top level between the halves.
 *     For an EMPTY label, the empty item is consumed.
 *
 *   FILTER (slash menu surface):
 *     - "Bulleted list" hides while cursor is inside a bullet list
 *     - "Numbered list" hides inside an ordered list
 *     - "To-do list"    hides inside a task list
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

async function caretInText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | {
          state: { doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
          view: { dispatch: (tr: unknown) => void; dom: HTMLElement; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.isText && n.text === t) { pos = p + t.length; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, text);
}

async function caretAtEmptyP(page: Page, occurrence = 0): Promise<void> {
  await page.evaluate((idx) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | {
          state: { doc: { descendants: (cb: (n: { type: { name: string }; content: { size: number } }, p: number) => boolean | undefined) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
          view: { dispatch: (tr: unknown) => void; dom: HTMLElement; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    let count = 0;
    ed.state.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.type.name === 'paragraph' && n.content.size === 0) {
        if (count === idx) { pos = p + 1; return false; }
        count++;
      }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, occurrence);
}

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } } | undefined;
    const out: string[] = [];
    ed?.state.doc.forEach((n) => out.push(n.type.name));
    return out;
  });
}

async function runCommand(page: Page, name: string): Promise<void> {
  await page.evaluate((cmd) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { commands: Record<string, ((...a: unknown[]) => boolean) | undefined> }
      | undefined;
    ed?.commands[cmd]?.();
  }, name);
}

async function runSetImage(page: Page, src: string): Promise<void> {
  await page.evaluate((s) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { commands: { setImage?: (attrs: { src: string }) => boolean } }
      | undefined;
    ed?.commands.setImage?.({ src: s });
  }, src);
}

// ════════════════════════════════════════════════════════════════════════
// CONVERT: Quote (toggleBlockquote / wrapIn fallback)
// ════════════════════════════════════════════════════════════════════════

test.describe('slash /quote in list-item label', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('cursor in BULLET label: list dissolves, paragraph becomes top-level blockquote', async ({ page }) => {
    await setContent(page, '<ul><li><p>Quote me</p></li></ul>');
    await caretInText(page, 'Quote me');
    await runCommand(page, 'toggleBlockquote');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['blockquote']);
  });

  test('cursor in TASK label: task dissolves, paragraph becomes top-level blockquote', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>Important</p></div></li></ul>',
    );
    await caretInText(page, 'Important');
    await runCommand(page, 'toggleBlockquote');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['blockquote']);
  });

  test('cursor in MID bullet item: list splits around it; quote sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    await caretInText(page, 'B');
    await runCommand(page, 'toggleBlockquote');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'blockquote', 'bulletList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// CONVERT: Details / Expandable (toggleDetails + lift fallback)
// ════════════════════════════════════════════════════════════════════════

test.describe('slash /details in list-item label', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('cursor in BULLET label: list dissolves, paragraph wraps in details', async ({ page }) => {
    await setContent(page, '<ul><li><p>Section</p></li></ul>');
    await caretInText(page, 'Section');
    await runCommand(page, 'toggleDetails');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['details']);
  });

  test('cursor in MID bullet item: list splits, details sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    await caretInText(page, 'B');
    await runCommand(page, 'toggleDetails');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'details', 'bulletList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// INSERT: Divider (setHorizontalRule)
// ════════════════════════════════════════════════════════════════════════

test.describe('slash /divider in list-item label', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('non-empty LAST bullet item: list stays whole, divider sits below', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    await caretInText(page, 'B');
    await runCommand(page, 'setHorizontalRule');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'horizontalRule', 'paragraph']);
  });

  test('non-empty MID bullet item: list splits, divider sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    await caretInText(page, 'B');
    await runCommand(page, 'setHorizontalRule');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'horizontalRule', 'paragraph', 'bulletList']);
  });

  test('EMPTY mid bullet item: empty bullet consumed, divider sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p></p></li><li><p>C</p></li></ul>');
    await caretAtEmptyP(page, 0);
    await runCommand(page, 'setHorizontalRule');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'horizontalRule', 'paragraph', 'bulletList']);
  });

  test('cursor in TASK label: respects taskList wrapper', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>A</p></div></li><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>B</p></div></li></ul>',
    );
    await caretInText(page, 'A');
    await runCommand(page, 'setHorizontalRule');
    await page.waitForTimeout(40);
    // Mid task item: split → [taskList(A), hr, p, taskList(B)]
    expect(await topLevelTypes(page)).toEqual(['taskList', 'horizontalRule', 'paragraph', 'taskList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// INSERT: Table (insertTable)
// ════════════════════════════════════════════════════════════════════════

test.describe('slash /table in list-item label', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('non-empty MID bullet item: list splits, table sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    await caretInText(page, 'B');
    await runCommand(page, 'insertTable');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'table', 'bulletList']);
  });

  test('EMPTY label of single-item list: list dissolves, table replaces it', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtEmptyP(page, 0);
    await runCommand(page, 'insertTable');
    await page.waitForTimeout(40);
    expect((await topLevelTypes(page)).filter((t) => t !== 'paragraph')).toEqual(['table']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// INSERT: Image (setImage)
// ════════════════════════════════════════════════════════════════════════

test.describe('slash /image in list-item label', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('non-empty MID bullet item: list splits, image sits between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    await caretInText(page, 'B');
    await runSetImage(page, 'https://example.com/x.png');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'image', 'paragraph', 'bulletList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// FILTER: hide same-type list option in slash menu
// ════════════════════════════════════════════════════════════════════════

test.describe('slash menu: hide same-type list option when already inside that list', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // The slash trigger requires the `/` to sit at textblock start OR be
  // preceded by whitespace. The tests use empty label paragraphs so
  // typing `/...` activates the popup.

  test('bullet list: "Bulleted list" hidden from slash menu', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.type('/bullet');
    const popover = page.locator('.dm-slash-command-menu').first();
    await popover.waitFor({ state: 'visible', timeout: 2000 });
    const bulletItem = popover.locator('.dm-slash-command-item-label').filter({ hasText: /^Bulleted list$/ });
    await expect(bulletItem).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('ordered list: "Numbered list" hidden from slash menu', async ({ page }) => {
    await setContent(page, '<ol><li><p></p></li></ol>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.type('/numbered');
    const popover = page.locator('.dm-slash-command-menu').first();
    await popover.waitFor({ state: 'visible', timeout: 2000 });
    const item = popover.locator('.dm-slash-command-item-label').filter({ hasText: /^Numbered list$/ });
    await expect(item).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('task list: "To-do list" hidden from slash menu', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p></p></div></li></ul>',
    );
    await caretAtEmptyP(page, 0);
    await page.keyboard.type('/to-do');
    const popover = page.locator('.dm-slash-command-menu').first();
    await popover.waitFor({ state: 'visible', timeout: 2000 });
    const item = popover.locator('.dm-slash-command-item-label').filter({ hasText: /^To-do list$/ });
    await expect(item).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('regression: at top-level (not in a list), all three list options ARE present', async ({ page }) => {
    await setContent(page, '<p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.type('/list');
    const popover = page.locator('.dm-slash-command-menu').first();
    await popover.waitFor({ state: 'visible', timeout: 2000 });
    const labels = popover.locator('.dm-slash-command-item-label');
    await expect(labels.filter({ hasText: /^Bulleted list$/ })).toHaveCount(1);
    await expect(labels.filter({ hasText: /^Numbered list$/ })).toHaveCount(1);
    await expect(labels.filter({ hasText: /^To-do list$/ })).toHaveCount(1);
    await page.keyboard.press('Escape');
  });
});
