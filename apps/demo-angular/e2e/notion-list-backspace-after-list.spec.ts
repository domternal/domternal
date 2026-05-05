/**
 * E2E coverage for the "ping-pong" Backspace bug.
 *
 * Repro: type something inside a list item, press Enter (a new empty
 * list item appears), press Backspace (the empty item disappears,
 * cursor lands in an empty paragraph below the list), press Backspace
 * AGAIN -> the empty list item reappears. The user expects the second
 * Backspace to merge with the previous content (delete the empty
 * paragraph, place caret at end of the last text in the last item).
 *
 * Root cause: PM's `joinBackward` (in `baseKeymap`) at the start of an
 * empty top-level paragraph that is preceded by a list-group node
 * (bulletList/orderedList/taskList) wraps the empty paragraph back
 * into the list as a NEW listItem/taskItem. We override this with a
 * "exit-join" handler that deletes the empty paragraph and places the
 * caret at the end of the last textblock of the previous list.
 *
 * Test groups:
 *  - Group A: bullet list (single, multi, typing-driven, BS#3 char-delete)
 *  - Group B: ordered list
 *  - Group C: task list
 *  - Group D: manual `<list/><p empty/>` shapes (multi-item, children-zone)
 *  - Group E: regression guards (non-empty p, paragraph-only doc, undo, heading)
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await waitForAllIds(page);
}

async function waitForAllIds(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => { if (!n.attrs.id) ok = false; });
    return ok;
  }, { timeout: 3000 });
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await waitForAllIds(page);
}

async function caretAtEndOfText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | {
          state: {
            doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
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

async function caretAtStartOfNthEmptyP(page: Page, occurrence = 0): Promise<void> {
  await page.evaluate((idx) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; content: { size: number } }, p: number) => boolean | undefined) => void };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
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

async function listItemTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }) => boolean | undefined) => void } } } | undefined;
    const out: string[] = [];
    ed?.state.doc.descendants((n) => {
      if (n.type.name === 'listItem' || n.type.name === 'taskItem') out.push(n.textContent);
      return true;
    });
    return out;
  });
}

async function selectionAt(page: Page): Promise<{ from: number; parentText: string }> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { selection: { from: number; $from: { parent: { textContent: string } } } } } | undefined;
    if (!ed) return { from: -1, parentText: '' };
    return { from: ed.state.selection.from, parentText: ed.state.selection.$from.parent.textContent };
  });
}

const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

// ════════════════════════════════════════════════════════════════════════
// Group A - bullet list ping-pong fix
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - bullet list', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('A1 single item: type, Enter, BS, BS -> caret at end of text, no list re-creation', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretAtEndOfText(page, 'hello');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    // Enter created an empty sibling listItem.
    expect(await listItemTexts(page)).toEqual(['hello', '']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // BS#1 lifts the empty li -> intermediate state: [bulletList, paragraph (empty)].
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // BS#2: empty p removed, caret at end of "hello", list intact.
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['hello']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('hello');
  });

  test('A2 multi-item: caret at end of last item, Enter, BS, BS -> caret at end of last text, list intact', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
    await caretAtEndOfText(page, 'c');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['a', 'b', 'c']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('c');
  });

  test('A3 typing-driven flow: type "hello", Enter, BS, BS, type "!" -> "hello!" in single li', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.type('hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['hello!']);
  });

  test('A4 BS#3 after fix becomes a normal char-delete on "hello"', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await listItemTexts(page)).toEqual(['hell']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group B - ordered list
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - ordered list', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('B1 ordered single: type, Enter, BS, BS -> caret at end of text', async ({ page }) => {
    await setContent(page, '<ol><li><p>hello</p></li></ol>');
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    expect(await listItemTexts(page)).toEqual(['hello']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('hello');
  });

  test('B2 ordered multi-item: caret at end of LAST item, Enter, BS, BS -> list intact, caret at end', async ({ page }) => {
    await setContent(page, '<ol><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol>');
    await caretAtEndOfText(page, 'three');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    expect(await listItemTexts(page)).toEqual(['one', 'two', 'three']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('three');
  });

  test('B3 ordered BS#3 -> char-delete on "hello"', async ({ page }) => {
    await setContent(page, '<ol><li><p>hello</p></li></ol>');
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await listItemTexts(page)).toEqual(['hell']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group C - task list
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - task list', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('C1 task single: type, Enter, BS, BS -> caret at end of text', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>hello</p></div></li></ul>',
    );
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemTexts(page)).toEqual(['hello']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('hello');
  });

  test('C2 task multi-item with mixed checked: caret at end of LAST item, Enter, BS, BS -> list intact', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox"></label><div><p>done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>pending</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>last</p></div></li>' +
      '</ul>',
    );
    await caretAtEndOfText(page, 'last');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemTexts(page)).toEqual(['done', 'pending', 'last']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('last');
  });

  test('C3 task BS#3 -> char-delete on "hello", checkbox preserved', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>hello</p></div></li></ul>',
    );
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemTexts(page)).toEqual(['hell']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group D - manual empty paragraph after list
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace at start of empty p preceded by list (manual)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('D1 bullet: existing <ul/><p empty/>, BS in empty p -> caret at end of last text', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });

  test('D2 task: existing taskList + <p empty/>, BS in empty p -> caret at end of last text', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>x</p></div></li></ul><p></p>',
    );
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });

  test('D3 multi-item with children-zone block: caret lands at end of LAST textblock (children-zone p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p>note</p></li></ul><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('note');
  });

  test('D4 last-block is HEADING in children-zone: caret lands at end of HEADING text', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><h2>Section</h2></li></ul><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Section');
  });

  test('D5 last-block is CODEBLOCK in children-zone: caret lands at end of code text', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><pre><code>const x = 1;</code></pre></li></ul><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('const x = 1;');
  });

  test('D6 ordered manual: <ol/><p empty/>, BS in empty p -> caret at end of last text', async ({ page }) => {
    await setContent(page, '<ol><li><p>x</p></li></ol><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group E - regression guards
// ════════════════════════════════════════════════════════════════════════

test.describe('Regression guards', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('E1 NON-empty p after list: BS at start of "x" -> our handler does not fire', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul><p>x</p>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | {
            state: {
              doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void };
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.isText && n.text === 'x') { pos = p; return false; }
        return true;
      });
      if (pos === -1) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
      ed.view.dispatch(tr);
      ed.view.dom.focus();
      ed.view.focus();
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Pre-fix and post-fix BOTH leave PM's joinBackward to wrap "x" into the list.
    // We don't change non-empty handling - documents the boundary of the fix.
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
  });

  test('E2 empty p between two paragraphs: BS does normal join (control)', async ({ page }) => {
    await setContent(page, '<p>a</p><p></p><p>b</p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // PM joinBackward merges with "a".
    expect(await topLevelTypes(page)).toEqual(['paragraph', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('a');
  });

  test('E3 undo restores BS#2 - delaying between BS so History does not group them', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.press('Backspace'); // BS#1 lift
    await page.waitForTimeout(600);
    await page.keyboard.press('Backspace'); // BS#2 our fix runs
    expect(await topLevelTypes(page)).toEqual(['bulletList']);

    // One Cmd+Z reverts BS#2 -> back to [bulletList, empty paragraph].
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
  });

  test('E4 BS in empty p preceded by HEADING (not list): normal joinBackward', async ({ page }) => {
    await setContent(page, '<h1>Title</h1><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Empty p merges with heading.
    expect(await topLevelTypes(page)).toEqual(['heading']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Title');
  });

  test('E5 list followed by empty p AND non-empty p after: BS in middle empty p -> caret at end of last item text', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><p></p><p>after</p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });

  test('E6 two consecutive empty p AFTER list: BS in SECOND empty p -> normal join (with first empty p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><p></p><p></p>');
    // Caret at SECOND empty p (occurrence index 1).
    await caretAtStartOfNthEmptyP(page, 1);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Previous sibling of SECOND empty p is FIRST empty p (paragraph, not list).
    // Our handler does NOT fire; PM joinBackward collapses the two empty p's into one.
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
  });

  test('E7 selection-non-empty Backspace: our handler does not fire (deletes selection)', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul><p>extra</p>');
    // Select the word "extra" via shift+arrow.
    await caretAtEndOfText(page, 'extra');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Selection deleted, leaves an EMPTY top-level p after the list (typical PM
    // behaviour). Our handler must NOT fire on this BS (selection was non-empty).
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group F - nested lists
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - nested lists', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('F1 nested bullet inside bullet: Enter at end of nested item, then BS x3 reaches top-level join', async ({ page }) => {
    await setContent(page, '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li></ul>');
    await caretAtEndOfText(page, 'child');
    await page.keyboard.press('Enter'); // new empty nested li
    await page.keyboard.press('Backspace'); // lift to outer level
    await page.keyboard.press('Backspace'); // lift further (to top level under parent's container)
    await page.keyboard.press('Backspace'); // our fix: empty top-level p preceded by ul -> caret at end of last text
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // After all the lifts, "child" is the last textblock of the last list item.
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('child');
  });

  test('F2 manual <ul/><p empty/> at the OUTER doc level when the ul itself contains nested lists: still works', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>parent</p><ul><li><p>child1</p></li><li><p>child2</p></li></ul></li></ul><p></p>',
    );
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Last textblock of the LAST top-level item (the parent li) is "child2"
    // (deepest text in the last li's subtree, walked by nodesBetween).
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('child2');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group G - mixed list types adjacent
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - mixed list types', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('G1 bullet then ordered: BS in empty p between -> our handler fires for the OL just before', async ({ page }) => {
    await setContent(page, '<ul><li><p>bullet</p></li></ul><ol><li><p>ordered</p></li></ol><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'orderedList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('ordered');
  });

  test('G2 ordered then task: BS in empty p between -> our handler fires for the task list', async ({ page }) => {
    await setContent(
      page,
      '<ol><li><p>ordered</p></li></ol>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p></div></li></ul>' +
      '<p></p>',
    );
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList', 'taskList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('task');
  });

  test('G3 list then heading then empty p: BS does NOT trigger our handler (prev sibling is heading)', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><h2>Title</h2><p></p>');
    await caretAtStartOfNthEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Empty p merges with heading - normal joinBackward.
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'heading']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Title');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group H - additional edge cases
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - additional edges', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('H1 cursor in NON-empty p with whitespace only: handler bails (content.size > 0)', async ({ page }) => {
    // Whitespace-only p: content.size === 1 (a space char), so our branch's
    // `content.size === 0` guard prevents the exit-join from firing. Falls
    // through to PM defaults.
    await setContent(page, '<ul><li><p>x</p></li></ul><p>&nbsp;</p>');
    // Caret at start of whitespace p.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | {
            state: {
              doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | undefined) => void };
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.type.name === 'paragraph' && n.textContent.trim() === '' && n.textContent.length > 0) {
          pos = p + 1;
          return false;
        }
        return true;
      });
      if (pos === -1) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
      ed.view.dispatch(tr);
      ed.view.dom.focus();
      ed.view.focus();
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    // Whitespace p was non-empty, exit-join did not fire. PM joinBackward
    // wraps it back into the list as a new li (current PM behaviour).
    // The test documents the boundary - our fix does not extend to whitespace.
    const types = await topLevelTypes(page);
    expect(types).toEqual(['bulletList']);
  });

  test('H2 BS#1 only (no second BS): intermediate state is <list/><p empty/>, caret in empty p', async ({ page }) => {
    // Documents the intermediate state - prevents accidental "smart lift"
    // regression that would short-circuit BS#1 and change the user-visible
    // single-keystroke behaviour.
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretAtEndOfText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('');
  });
});
