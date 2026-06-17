/**
 * E2E coverage for the June 2026 list-behavior audit fixes. Unlike the core
 * unit tests (which invoke the keymap functions directly), these drive REAL
 * keydown events through the full plugin keymap chain and assert against the
 * real rendered DOM - so they also verify handler precedence and CSS layout.
 *
 *   #1 cross-type outdent preserves item type + checked (Shift+Tab, Backspace)
 *   #2 Enter at end of a label keeps nested children under the original item
 *   #3 Enter on an empty label with children does not spawn a stray item
 *   #4 OrderedList start is validated (no NaN/null corruption)
 *   #5 GFM / markdown task lists import with checkboxes
 *   #6 mixed <ul> does not fabricate an empty placeholder item
 *   #7 list indent stays consistent when the editor font is scaled
 *   #8 colored task item keeps its checkbox aligned with the label
 *   #9 list markers / checkbox mirror in RTL
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';

async function setContentAndFocus(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as any).__DEMO_EDITOR__;
    if (ed) { ed.setContent(h, false); ed.commands.focus(); }
  }, html);
  await page.waitForTimeout(150);
}
async function getHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}
async function getText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}
async function getJSONString(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify((window as any).__DEMO_EDITOR__.getJSON()));
}
/** Place the caret at the start/end of the first paragraph whose text matches,
 *  then send a REAL keydown so the live keymap chain is exercised. (click+Home
 *  is unreliable for offset 0 inside a nested task structure.) */
async function caretAt(page: Page, text: string, where: 'start' | 'end' = 'start'): Promise<void> {
  await page.evaluate(({ txt, w }) => {
    const ed = (window as any).__DEMO_EDITOR__;
    let pos = -1, size = 0;
    ed.state.doc.descendants((node: any, p: number) => {
      if (pos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === txt) { pos = p; size = node.nodeSize; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const target = w === 'start' ? pos + 1 : pos + size - 1;
    ed.view.dispatch(ed.state.tr.setSelection(TS.create(ed.state.doc, target)));
    ed.view.dom.focus(); ed.view.focus();
  }, { txt: text, w: where });
  await page.waitForTimeout(30);
}

const TASK_IN_BULLET =
  '<ul><li><p>Parent</p><ul data-type="taskList">' +
  '<li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>Child</p></div></li>' +
  '</ul></li></ul>';
const BULLET_IN_TASK =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label>' +
  '<div><p>Task parent</p><ul><li><p>Bullet child</p></li></ul></div></li></ul>';

test.describe('#1 cross-type outdent preserves item type + checked', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Shift+Tab: checked task nested in a bullet survives as a taskList', async ({ page }) => {
    await setContentAndFocus(page, TASK_IN_BULLET);
    await caretAt(page, 'Child', 'start');
    await page.keyboard.press('Shift+Tab');
    const html = await getHTML(page);
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="true"');
    expect(await getText(page)).toContain('Child');
  });

  test('Backspace at start: checked task nested in a bullet survives', async ({ page }) => {
    await setContentAndFocus(page, TASK_IN_BULLET);
    await caretAt(page, 'Child', 'start');
    await page.keyboard.press('Backspace');
    expect(await getHTML(page)).toContain('data-checked="true"');
    expect(await getText(page)).toContain('Child');
  });

  test('Shift+Tab: bullet nested in a task survives as a bulletList', async ({ page }) => {
    await setContentAndFocus(page, BULLET_IN_TASK);
    await caretAt(page, 'Bullet child', 'start');
    await page.keyboard.press('Shift+Tab');
    const html = await getHTML(page);
    expect(html).toContain('Bullet child');
    // bullet item survives (a plain <ul> still present, not dissolved to a bare <p>)
    expect(html).toContain('<ul>');
  });
});

test.describe('#2 / #3 Enter keeps nested children under the original item', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('#2 Enter at end of a parent label drops a sibling, child stays nested', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>');
    await caretAt(page, 'Parent', 'end');
    await page.keyboard.press('Enter');
    // Child stays under the first top-level item; a new empty sibling exists.
    const childUnderParent = await page.locator(`${editorSelector} > ul > li:first-child ul li p`).textContent();
    expect(childUnderParent).toContain('Child');
    const topItems = await page.locator(`${editorSelector} > ul > li`).count();
    expect(topItems).toBe(2);
  });

  test('#3 Enter on an empty label with children spawns no stray empty item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Top</p><ul><li><p></p><ul><li><p>Grandchild</p></li></ul></li></ul></li></ul>');
    const emptyBefore = await page.locator(`${editorSelector} p`).evaluateAll((ps) => ps.filter((p) => !p.textContent).length);
    await caretAt(page, '', 'start');
    await page.keyboard.press('Enter');
    const emptyAfter = await page.locator(`${editorSelector} p`).evaluateAll((ps) => ps.filter((p) => !p.textContent).length);
    expect(emptyAfter).toBe(emptyBefore); // no duplicate empty item
    expect(await getText(page)).toContain('Grandchild');
  });
});

test.describe('#4 OrderedList start is validated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('malformed start does not corrupt JSON or HTML', async ({ page }) => {
    await setContentAndFocus(page, '<ol start="abc"><li><p>x</p></li></ol>');
    expect(await getJSONString(page)).not.toContain('"start":null');
    expect(await getHTML(page)).not.toContain('NaN');
  });
  test('valid start is preserved', async ({ page }) => {
    await setContentAndFocus(page, '<ol start="5"><li><p>x</p></li></ol>');
    expect(await getJSONString(page)).toContain('"start":5');
  });
});

test.describe('#5 / #6 import / parse fixes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('#5 GFM task list imports as a real task list with checked state', async ({ page }) => {
    await setContentAndFocus(page, '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked> Done</li><li class="task-list-item"><input type="checkbox"> Todo</li></ul>');
    const html = await getHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(await getText(page)).toContain('Done');
  });
  test('#6 mixed ul does not fabricate a leading empty bullet item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li data-type="taskItem" data-checked="true"><label contenteditable="false"><input type="checkbox" checked></label><div><p>tasktext</p></div></li><li><p>plain</p></li></ul>');
    const text = await getText(page);
    expect(text).toContain('tasktext');
    expect(text).toContain('plain');
    // first top-level node is not an empty placeholder list
    const firstEmpty = await page.locator(`${editorSelector} > *:first-child`).evaluate((el) => {
      const li = el.querySelector('li');
      return !!li && (li.textContent ?? '').trim() === '' && el.querySelectorAll('li').length === 1;
    });
    expect(firstEmpty).toBe(false);
  });
});

test.describe('#7 / #8 / #9 layout fixes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('#8 coloring a task item does not shift its checkbox out of alignment', async ({ page }) => {
    await setContentAndFocus(page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>plain task</p></div></li></ul>' +
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false" data-bg-color="blue"><label contenteditable="false"><input type="checkbox"></label><div><p>colored task</p></div></li></ul>');
    const dy = await page.evaluate((sel) => {
      const lis = Array.from(document.querySelectorAll(`${sel} li[data-type="taskItem"]`));
      const measure = (li: Element) => {
        const cb = li.querySelector('input')!.getBoundingClientRect();
        const p = li.querySelector('p')!.getBoundingClientRect();
        return ((cb.top + cb.bottom) / 2) - ((p.top + p.bottom) / 2);
      };
      return Math.abs(measure(lis[0]) - measure(lis[1]));
    }, editorSelector);
    expect(dy).toBeLessThan(1.0); // colored vs uncolored checkbox alignment matches
  });

  test('#9 RTL: checkbox hangs on the reading-start (right) side', async ({ page }) => {
    await setContentAndFocus(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"></label><div><p>rtl task</p></div></li></ul>');
    await page.evaluate((sel) => { (document.querySelector(sel) as HTMLElement).setAttribute('dir', 'rtl'); }, editorSelector);
    await page.waitForTimeout(100);
    const checkboxRightOfText = await page.evaluate((sel) => {
      const li = document.querySelector(`${sel} li[data-type="taskItem"]`)!;
      const cb = li.querySelector('input')!.getBoundingClientRect();
      const p = li.querySelector('p')!.getBoundingClientRect();
      return cb.left > p.right;
    }, editorSelector);
    expect(checkboxRightOfText).toBe(true);
  });

  test('#7 nested list and children-zone note align at a scaled editor font', async ({ page }) => {
    await page.evaluate((sel) => { (document.querySelector(sel.replace(' .ProseMirror', '')) as HTMLElement).style.setProperty('--dm-editor-font-size', '1.6rem'); }, editorSelector);
    await setContentAndFocus(page, '<ul><li><p>Label</p><p>note</p><ul><li><p>sub</p></li></ul></li></ul>');
    const spread = await page.evaluate((sel) => {
      const item = document.querySelector(`${sel} > ul > li`)!;
      const note = item.querySelectorAll(':scope > p')[1]!.getBoundingClientRect().left;
      const sub = item.querySelector(':scope > ul li p')!.getBoundingClientRect().left;
      return Math.abs(note - sub);
    }, editorSelector);
    expect(spread).toBeLessThan(1.0);
  });
});
