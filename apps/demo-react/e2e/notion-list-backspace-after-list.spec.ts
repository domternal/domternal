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
 */
import { test } from './fixtures.js';
import { expect } from '@playwright/test';
import {
  MOD,
  caretAtEmptyP,
  caretInText,
  goNotion,
  listItemTexts,
  selectionAt,
  setContent,
  topLevelTypes,
} from './notion-helpers.js';

const undoKey = `${MOD}+z`;

// ════════════════════════════════════════════════════════════════════════
// Group A - bullet list ping-pong fix
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - bullet list', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('A1 single item: type, Enter, BS, BS -> caret at end of text, no list re-creation', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretInText(page, 'hello');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    expect(await listItemTexts(page)).toEqual(['hello', '']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['hello']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('hello');
  });

  test('A2 multi-item: caret at end of last item, Enter, BS, BS -> caret at end of last text, list intact', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
    await caretInText(page, 'c');
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
    await caretAtEmptyP(page, 0);
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
    await caretInText(page, 'hello');
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
    await caretInText(page, 'hello');
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
    await caretInText(page, 'three');
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
    await caretInText(page, 'hello');
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
    await caretInText(page, 'hello');
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
    await caretInText(page, 'last');
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
    await caretInText(page, 'hello');
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
    await caretAtEmptyP(page, 0);
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
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });

  test('D3 multi-item with children-zone block: caret lands at end of LAST textblock (children-zone p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p>note</p></li></ul><p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('note');
  });

  test('D4 last-block is HEADING in children-zone: caret lands at end of HEADING text', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><h2>Section</h2></li></ul><p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Section');
  });

  test('D5 last-block is CODEBLOCK in children-zone: caret lands at end of code text', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><pre><code>const x = 1;</code></pre></li></ul><p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('const x = 1;');
  });

  test('D6 ordered manual: <ol/><p empty/>, BS in empty p -> caret at end of last text', async ({ page }) => {
    await setContent(page, '<ol><li><p>x</p></li></ol><p></p>');
    await caretAtEmptyP(page, 0);
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
    // Place caret at START of "x" (one position before the text node).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
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
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
  });

  test('E2 empty p between two paragraphs: BS does normal join (control)', async ({ page }) => {
    await setContent(page, '<p>a</p><p></p><p>b</p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['paragraph', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('a');
  });

  test('E3 undo restores BS#2 - delaying between BS so History does not group them', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretInText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);
    await page.keyboard.press('Backspace');
    expect(await topLevelTypes(page)).toEqual(['bulletList']);

    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
  });

  test('E4 BS in empty p preceded by HEADING (not list): normal joinBackward', async ({ page }) => {
    await setContent(page, '<h1>Title</h1><p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['heading']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Title');
  });

  test('E5 list followed by empty p AND non-empty p after: BS in middle empty p -> caret at end of last item text', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><p></p><p>after</p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('x');
  });

  test('E6 two consecutive empty p AFTER list: BS in SECOND empty p -> normal join (with first empty p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><p></p><p></p>');
    await caretAtEmptyP(page, 1);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
  });

  test('E7 selection-non-empty Backspace: our handler does not fire (deletes selection)', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul><p>extra</p>');
    await caretInText(page, 'extra');
    for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
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
    await caretInText(page, 'child');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('child');
  });

  test('F2 manual <ul/><p empty/> at the OUTER doc level when the ul itself contains nested lists: still works', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>parent</p><ul><li><p>child1</p></li><li><p>child2</p></li></ul></li></ul><p></p>',
    );
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
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
    await caretAtEmptyP(page, 0);
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
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList', 'taskList']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('task');
  });

  test('G3 list then heading then empty p: BS does NOT trigger our handler (prev sibling is heading)', async ({ page }) => {
    await setContent(page, '<ul><li><p>x</p></li></ul><h2>Title</h2><p></p>');
    await caretAtEmptyP(page, 0);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
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
    await setContent(page, '<ul><li><p>x</p></li></ul><p>&nbsp;</p>');
    // Caret at start of whitespace p (text node has length > 0 so caretAtEmptyP
    // does not match; inline an evaluate that finds a whitespace-only paragraph).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
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
    const types = await topLevelTypes(page);
    expect(types).toEqual(['bulletList']);
  });

  test('H2 BS#1 only (no second BS): intermediate state is <list/><p empty/>, caret in empty p', async ({ page }) => {
    await setContent(page, '<ul><li><p>hello</p></li></ul>');
    await caretInText(page, 'hello');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group I - middle-of-list Enter+BS+BS: list halves must rejoin into one
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace after-list join - middle-of-list sandwich (bullet)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I1 ul[1,2,3], Enter at end of 2, BS, BS -> single unified ul[1,2,3], caret at end of "2"', async ({ page }) => {
    await setContent(page, '<ul><li><p>first</p></li><li><p>second</p></li><li><p>third</p></li></ul>');
    await caretInText(page, 'second');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    expect(await listItemTexts(page)).toEqual(['first', 'second', '', 'third']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph', 'bulletList']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['first', 'second', 'third']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('second');
  });

  test('I2 ul[a,b], Enter at end of a, BS, BS -> single unified ul[a,b], caret at end of "a"', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li><li><p>b</p></li></ul>');
    await caretInText(page, 'a');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    expect(await listItemTexts(page)).toEqual(['a', '', 'b']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList', 'paragraph', 'bulletList']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['a', 'b']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('a');
  });

  test('I3 ul with bold/italic in items: marks survive the rejoin', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>First item in a list</p></li><li><p>Second item with <strong>bold text</strong></p></li><li><p>Third item with <em>italic text</em></p></li></ul>',
    );
    await caretInText(page, 'bold text');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    const html = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { getHTML: () => string } | undefined;
      return ed?.getHTML() ?? '';
    });
    expect(html).toContain('<strong>bold text</strong>');
    expect(html).toContain('<em>italic text</em>');
    expect((html.match(/<ul/g) ?? []).length).toBe(1);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('Second item with bold text');
  });
});

test.describe('Backspace after-list join - middle-of-list sandwich (ordered)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I4 ol[1,2,3], Enter at end of 2, BS, BS -> single unified ol[1,2,3]', async ({ page }) => {
    await setContent(page, '<ol><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ol>');
    await caretInText(page, 'two');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList', 'paragraph', 'orderedList']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    expect(await listItemTexts(page)).toEqual(['one', 'two', 'three']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('two');
  });
});

test.describe('Backspace after-list join - middle-of-list sandwich (task)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I5 task[a,b,c], Enter at end of b, BS, BS -> single unified taskList', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p>a</p></div></li><li data-type="taskItem"><label><input type="checkbox"></label><div><p>b</p></div></li><li data-type="taskItem"><label><input type="checkbox"></label><div><p>c</p></div></li></ul>',
    );
    await caretInText(page, 'b');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList', 'paragraph', 'taskList']);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemTexts(page)).toEqual(['a', 'b', 'c']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('b');
  });
});

test.describe('Backspace after-list join - middle-of-list sandwich (cross-type guard)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I6 manual ul + p"" + ol shape: BS deletes p, lists STAY separate (different types)', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li></ul><p></p><ol><li><p>1</p></li></ol>');
    await caretAtEmptyP(page, 0);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    expect(await topLevelTypes(page)).toEqual(['bulletList', 'orderedList']);
    expect(await listItemTexts(page)).toEqual(['a', '1']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('a');
  });

  test('I7 manual ul + p"" + heading shape: BS deletes p, heading remains separate', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li></ul><p></p><h2>title</h2>');
    await caretAtEmptyP(page, 0);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    expect(await topLevelTypes(page)).toEqual(['bulletList', 'heading']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('a');
  });

  test('I8 manual ul + p"" + ul shape (no preceding Enter): BS merges the two same-type uls', async ({ page }) => {
    await setContent(page, '<ul><li><p>a</p></li><li><p>b</p></li></ul><p></p><ul><li><p>c</p></li></ul>');
    await caretAtEmptyP(page, 0);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemTexts(page)).toEqual(['a', 'b', 'c']);
    const sel = await selectionAt(page);
    expect(sel.parentText).toBe('b');
  });
});
