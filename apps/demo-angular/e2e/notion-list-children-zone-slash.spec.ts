/**
 * E2E coverage for the children-zone exception in `toggleList`.
 *
 * Bug: when the cursor sits in a paragraph that is a CHILDREN-ZONE block
 * of a list/task item (childIndex > 0, so NOT the first-child label),
 * picking "Bulleted list" / "Numbered list" / "Task list" from the slash
 * menu used to convert the ANCESTOR list (the user's parent bulletList,
 * for example) instead of inserting a new list at the cursor. Notion
 * treats this case as "create a new list right here, leave my parent
 * list alone".
 *
 * The fix lives in `packages/core/src/commands/listCommands.ts` and
 * detects the children-zone via `getListItemCursorContext`. When the
 * cursor is collapsed and `ctx.isInChildrenZone` is true, the toggle
 * wraps the cursor's paragraph in a fresh list of the target type
 * inside the same children-zone, then runs `joinListBackwards/Forwards`
 * so the new list merges with adjacent same-type sibling lists.
 *
 * Test groups:
 *  - Group A: bullet parent + slash "Numbered list" / "Task list"
 *  - Group B: ordered parent + slash "Bulleted list" / "Task list"
 *  - Group C: task parent + slash "Bulleted list" / "Numbered list"
 *  - Group D: regression: LABEL paragraph keeps existing convert behaviour
 *  - Group E: regression: top-level empty p still creates a fresh list
 *  - Group F: edge: adjacent same-type sibling lists merge after wrap
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

async function caretAtNthEmptyP(page: Page, occurrence = 0): Promise<void> {
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

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } } | undefined;
    const out: string[] = [];
    ed?.state.doc.forEach((n) => out.push(n.type.name));
    return out;
  });
}

async function listItemChildren(page: Page, itemIndex: number): Promise<string[]> {
  return page.evaluate((idx) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { state: { doc: { descendants: (cb: (n: { type: { name: string }; childCount: number; content: { content: { type: { name: string } }[] } }) => boolean | undefined) => void } } }
      | undefined;
    if (!ed) return [];
    const items: { type: string; childCount: number; childTypes: string[] }[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
        const childTypes = n.content.content.map((c) => c.type.name);
        items.push({ type: n.type.name, childCount: n.childCount, childTypes });
      }
      return true;
    });
    return items[idx]?.childTypes ?? [];
  }, itemIndex);
}

// Run a slash command by toggling the editor's command directly. This
// matches what the slash menu does when the user picks an item, but
// avoids depending on slash-menu UI specifics.
async function runListCommand(page: Page, name: 'toggleBulletList' | 'toggleOrderedList' | 'toggleTaskList'): Promise<void> {
  await page.evaluate((cmd) => {
    const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
      | { commands: Record<string, (() => boolean) | undefined> }
      | undefined;
    ed?.commands[cmd]?.();
  }, name);
}

// ════════════════════════════════════════════════════════════════════════
// Group A - bullet parent
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - bullet parent', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('A1 empty children-zone p in bullet item: toggleOrderedList inserts NEW ol, parent ul stays bullet', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Outer li now has [paragraph(label), orderedList].
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });

  test('A2 non-empty children-zone p in bullet item: toggleOrderedList wraps that p in a NEW ol', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p>note</p></li></ul>');
    await caretAtEndOfText(page, 'note');
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });

  test('A3 empty children-zone p in bullet item: toggleTaskList inserts NEW taskList', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleTaskList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'taskList']);
  });

  test('A4 user-flow: parent li with [label, nested ul, h2, empty p] -> "Numbered list" wraps empty p only, nested ul stays bullet', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>parent label</p>' +
      '<ul><li><p>child 1</p></li><li><p>child 2</p></li></ul>' +
      '<h2>Things to try</h2><p></p></li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Parent li children: [label, nested bullet ul (UNCHANGED), h2, NEW ordered list].
    expect(await listItemChildren(page, 0)).toEqual([
      'paragraph', 'bulletList', 'heading', 'orderedList',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group B - ordered parent
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - ordered parent', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('B1 empty children-zone p in ordered item: toggleBulletList inserts NEW ul, parent ol stays ordered', async ({ page }) => {
    await setContent(page, '<ol><li><p>label</p><p></p></li></ol>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleBulletList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'bulletList']);
  });

  test('B2 empty children-zone p in ordered item: toggleTaskList inserts NEW taskList', async ({ page }) => {
    await setContent(page, '<ol><li><p>label</p><p></p></li></ol>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleTaskList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'taskList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group C - task parent
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - task parent', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('C1 empty children-zone p in task item: toggleBulletList inserts NEW ul, parent taskList stays', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p><p></p></div></li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleBulletList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'bulletList']);
  });

  test('C2 empty children-zone p in task item: toggleOrderedList inserts NEW ol, parent taskList stays', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p><p></p></div></li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group D - regression guards (label paragraph still converts)
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - label paragraph regression', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('D1 cursor in LABEL paragraph of bullet item: toggleOrderedList CONVERTS the bullet ul to ol (existing behaviour)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p></li></ul>');
    await caretAtEndOfText(page, 'label');
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
  });

  test('D2 cursor in LABEL paragraph of task item: toggleBulletList CONVERTS the taskList to ul', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p></div></li></ul>',
    );
    await caretAtEndOfText(page, 'task');
    await runListCommand(page, 'toggleBulletList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group E - regression guards (top-level empty p)
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - top-level paragraph regression', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('E1 top-level empty p (no list ancestor): toggleOrderedList wraps as new ol (control)', async ({ page }) => {
    await setContent(page, '<p></p>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['orderedList']);
  });

  test('E2 top-level empty p between two existing lists: toggleOrderedList wraps + joinBackwards merges with previous ol of same type', async ({ page }) => {
    await setContent(page, '<ol><li><p>existing</p></li></ol><p></p><h2>after</h2>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    // Adjacent same-type ols merge.
    expect(await topLevelTypes(page)).toEqual(['orderedList', 'heading']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group F - adjacency join inside children-zone
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - adjacency join', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('F1 children-zone empty p between an existing ol and a heading: new ol merges with the sibling ol via joinListBackwards', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>label</p>' +
      '<ol><li><p>existing</p></li></ol>' +
      '<p></p>' +
      '</li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Adjacent ols of same type merge: parent li ends up with [label, ol(2 items)].
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group G - real slash-menu UI flow
// ════════════════════════════════════════════════════════════════════════
//
// These tests exercise the actual user-facing path: focus an empty
// paragraph, type "/", filter the menu, press Enter to pick. Verifies
// that the slash command DOES strip the trigger text + invokes the
// command on the same selection so the children-zone exception fires
// in the real flow (not just via direct command call).

test.describe('toggleList children-zone exception - real slash-menu flow', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  const slashMenuSelector = '.dm-slash-command-menu';

  test('G1 empty children-zone p in bullet item, type "/numbered" + Enter -> NEW ol inserted, parent ul stays', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await page.keyboard.type('/numbered');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });

  test('G2 empty children-zone p in bullet item, type "/bullet" + Enter -> NEW ul inserted (nested bullet inside same parent)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await page.keyboard.type('/bullet');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Outer li now has [paragraph(label), nested bulletList].
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'bulletList']);
  });

  test('G3 empty children-zone p in task item, type "/numbered" + Enter -> NEW ol inserted', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p><p></p></div></li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await page.keyboard.type('/numbered');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });

  test('G4 slash trigger text is stripped after picking (no leftover "/numbered" content)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await page.keyboard.type('/numbered');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(60);
    // Inspect TEXT content (not HTML) so closing-tag slashes / attribute
    // slashes don't muddy the assertion. The trigger leaves behind no
    // visible text from the user's typed query.
    const text = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(text).not.toContain('/numbered');
    expect(text).not.toContain('numbered');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group H - cursor position after wrap
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - cursor position', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('H1 after wrap, cursor lands inside the new list (caret in first li paragraph)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    const sel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { selection: { $from: { parent: { type: { name: string }; textContent: string }; node: (d: number) => { type: { name: string } } } } } } | undefined;
      const $f = ed?.state.selection.$from;
      if (!$f) return null;
      // Walk up to find the wrapping list: should be 'orderedList'.
      const ancestors: string[] = [];
      const $from = $f as unknown as { depth: number; node: (d: number) => { type: { name: string } } };
      for (let d = $from.depth; d >= 0; d--) ancestors.push($from.node(d).type.name);
      return { parentType: $f.parent.type.name, parentText: $f.parent.textContent, ancestors };
    });
    expect(sel?.parentType).toBe('paragraph');
    expect(sel?.parentText).toBe('');
    // Cursor's ancestor chain includes the new orderedList right above its listItem.
    expect(sel?.ancestors).toContain('orderedList');
    expect(sel?.ancestors).toContain('listItem');
  });

  test('H2 after wrap of NON-empty p, cursor stays inside the wrapped paragraph (text intact)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p>content here</p></li></ul>');
    await caretAtEndOfText(page, 'content here');
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    const sel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { selection: { $from: { parent: { textContent: string } } } } } | undefined;
      return ed?.state.selection.$from.parent.textContent ?? '';
    });
    expect(sel).toBe('content here');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group I - undo / redo
// ════════════════════════════════════════════════════════════════════════

const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redoKey = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

test.describe('toggleList children-zone exception - undo/redo', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I1 single Cmd+Z reverts the wrap entirely (one history step)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);

    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);
    // Back to [label, empty p].
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'paragraph']);
  });

  test('I2 redo replays the wrap', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);
    await page.keyboard.press(redoKey);
    await page.waitForTimeout(40);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group J - toggle off after wrap
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - toggle off after wrap', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('J1 cursor inside the freshly-created ol (after wrap), second toggleOrderedList lifts the ol away (PM liftListItem walks out)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'orderedList']);

    // Cursor is in the new ol's first li label paragraph, so the SECOND toggle
    // takes the existing label-path (allInTargetList -> liftListItem). PM's
    // default lift walks the empty p out of both the inner ol AND the outer
    // bullet li, so it ends up at the top level. Either way, the key
    // invariant is: NO orderedList remains anywhere in the doc.
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    const types = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string } }) => boolean | undefined) => void } } } | undefined;
      const seen: string[] = [];
      ed?.state.doc.descendants((n) => { seen.push(n.type.name); return true; });
      return seen;
    });
    expect(types).not.toContain('orderedList');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group K - various preceding block types in children-zone
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - preceded by various blocks', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('K1 preceded by HEADING: empty p after h2, slash + numbered -> new ol (parent bullet ul stays)', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><h2>Section</h2><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'heading', 'orderedList']);
  });

  test('K2 preceded by CODEBLOCK: empty p after pre, slash + numbered -> new ol', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><pre><code>const x = 1;</code></pre><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'codeBlock', 'orderedList']);
  });

  test('K3 preceded by BLOCKQUOTE: empty p after blockquote, slash + numbered -> new ol', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><blockquote><p>quoted</p></blockquote><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'blockquote', 'orderedList']);
  });

  test('K4 preceded by HORIZONTAL RULE: empty p after hr, slash + numbered -> new ol', async ({ page }) => {
    await setContent(page, '<ul><li><p>label</p><hr><p></p></li></ul>');
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'horizontalRule', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group L - deeply nested children-zone
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - deeply nested', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('L1 cursor in children-zone p of a NESTED bullet li (depth 3): toggleOrderedList wraps p in NEW ol inside the inner li, ALL parent lists stay', async ({ page }) => {
    // Structure: outer ul > outer li > [outer label p, inner ul] where
    // inner ul > inner li > [inner label p, EMPTY children-zone p].
    await setContent(
      page,
      '<ul><li><p>outer label</p>' +
      '<ul><li><p>inner label</p><p></p></li></ul>' +
      '</li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // Outer li children: [label, inner bulletList (UNCHANGED)].
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'bulletList']);
    // Inner li children: [inner label, NEW orderedList].
    expect(await listItemChildren(page, 1)).toEqual(['paragraph', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group M - multiple paragraphs in children-zone
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - multiple children-zone paragraphs', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('M1 cursor in MIDDLE empty p with sibling p-s above and below: only middle p is wrapped in new ol; siblings stay paragraphs', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>label</p>' +
      '<p>before</p>' +
      '<p></p>' +
      '<p>after</p>' +
      '</li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await topLevelTypes(page)).toEqual(['bulletList']);
    // li children: [label, "before" p, NEW ol, "after" p].
    expect(await listItemChildren(page, 0)).toEqual([
      'paragraph', 'paragraph', 'orderedList', 'paragraph',
    ]);
  });

  test('M2 cursor in LAST empty p of children-zone with sibling p above: only last p wrapped, sibling stays', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>label</p>' +
      '<p>before</p>' +
      '<p></p>' +
      '</li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    expect(await listItemChildren(page, 0)).toEqual(['paragraph', 'paragraph', 'orderedList']);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group N - taskItem deep structure verification
// ════════════════════════════════════════════════════════════════════════

test.describe('toggleList children-zone exception - taskItem deep structure', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('N1 task children-zone empty p inside taskItem div wrapper: new ol is inserted INSIDE the same div, parent taskList unchanged', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
      '<label contenteditable="false"><input type="checkbox"></label>' +
      '<div><p>task</p><p></p></div></li></ul>',
    );
    await caretAtNthEmptyP(page, 0);
    await runListCommand(page, 'toggleOrderedList');
    await page.waitForTimeout(40);
    // Verify the new ordered list is INSIDE the taskItem (not promoted to top level).
    const placement = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; childCount: number; lastChild: { type: { name: string } } | null }) => boolean | undefined) => void } } }
        | undefined;
      let foundInside = false;
      ed?.state.doc.descendants((n) => {
        if (n.type.name === 'taskItem' && n.lastChild?.type.name === 'orderedList') {
          foundInside = true;
        }
        return true;
      });
      return foundInside;
    });
    expect(placement).toBe(true);
    expect(await topLevelTypes(page)).toEqual(['taskList']);
  });
});
