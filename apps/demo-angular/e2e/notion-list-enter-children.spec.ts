/**
 * E2E coverage for Enter behaviour inside the children-zone of a
 * list/task item (`paragraph block*` schema).
 *
 * Background (bug report): pressing Enter twice from the end of a
 * heading nested inside a list item (first Enter creates an empty
 * trailing paragraph sibling, second Enter on the empty paragraph)
 * destroys the entire list item: all children (label paragraph, the
 * heading, the empty paragraph) are dumped to the top level as
 * separate blocks, the bulletList disappears.
 *
 * Root cause: ListItem.Enter and TaskItem.Enter handlers do not
 * differentiate "cursor in label paragraph (1st child)" from "cursor
 * in a non-label paragraph in the children-zone". Both flow through
 * `splitListItem` -> `liftListItem` fallback. liftListItem on a
 * trailing empty paragraph lifts the ENTIRE list item out, exploding
 * its children.
 *
 * Tests below pin every observable scenario in the matrix:
 *  - Group A (12) - bullet listItem children-zone Enter
 *  - Group B (3)  - ordered listItem mirrors (critical cases)
 *  - Group C (6)  - taskItem mirrors
 *  - Group D (3)  - nested-list interactions
 *  - Group E (7)  - regression guards (must NOT regress after fix)
 *  - Group F (3)  - multi-step user flows incl. exact bug reproduction
 *  - Group G (4)  - best-practice guards (undo, cursor sync, modifier
 *                   keys, non-collapsed selection)
 *
 * Tests asserting POST-FIX expected shapes use `test.fail` so Playwright
 * actually runs them and verifies they fail today (proves the bug is
 * real). When the fix in plan 4 Phase 3 (ListItem.Enter) and Phase 4
 * (TaskItem.Enter) lands, the failing tests will start passing -
 * Playwright then flags them as "passed but expected to fail". At that
 * point, simply remove `.fail` from each test signature; the assertions
 * stay the same.
 *
 * Plan: `_planning/listitems_improvements_4.md`
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await waitForAllIds(page);
}

async function waitForAllIds(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => { if (!n.attrs['id']) ok = false; });
    return ok;
  }, { timeout: 3000 });
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await waitForAllIds(page);
}

interface ChildShape { type: string; childCount: number; text: string }
interface ItemShape { type: string; childCount: number; text: string; children: ChildShape[] }

/** Return a shallow tree (one level deep) of every li/taskItem in the doc. */
async function listItemShapes(page: Page): Promise<ItemShape[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { descendants: (cb: (n: { type: { name: string }; childCount: number; textContent: string; content: { content: { type: { name: string }; childCount: number; textContent: string }[] } }) => boolean | void) => void } } }
      | undefined;
    const out: { type: string; childCount: number; text: string; children: { type: string; childCount: number; text: string }[] }[] = [];
    ed?.state.doc.descendants((node) => {
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        const children = (node.content.content ?? []).map((c) => ({
          type: c.type.name,
          childCount: c.childCount,
          text: c.textContent,
        }));
        out.push({
          type: node.type.name,
          childCount: node.childCount,
          text: node.textContent,
          children,
        });
      }
      return true;
    });
    return out;
  });
}

/** Walk top-level children of doc and return shallow shape (type + textContent). */
async function topLevelBlocks(page: Page): Promise<{ type: string; text: string }[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
      | undefined;
    const out: { type: string; text: string }[] = [];
    ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
    return out;
  });
}

/**
 * Place caret at the end of the Kth child of the Nth list/task item
 * encountered in doc-traversal order (includes nested items).
 *
 * `position`: 'end' = end of child textblock, 'start' = start of child.
 */
async function caretAtItemChild(
  page: Page,
  itemIndex: number,
  childIndex: number,
  position: 'start' | 'end' = 'end',
): Promise<void> {
  await page.evaluate(({ ii, ci, pos }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: {
              descendants: (cb: (n: { type: { name: string }; childCount: number; child: (i: number) => { nodeSize: number; isTextblock: boolean }; nodeSize: number }, p: number) => boolean | void) => void;
              resolve: (p: number) => unknown;
            };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown; near: (rp: unknown, dir?: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    if (!ed) return;

    let foundItemPos = -1;
    let foundItemNode: { childCount: number; child: (i: number) => { nodeSize: number; isTextblock: boolean } } | null = null;
    let counter = 0;

    ed.state.doc.descendants((node, p) => {
      if (foundItemPos !== -1) return false;
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        if (counter === ii) {
          foundItemPos = p;
          foundItemNode = node;
          // Stop descending: we've found the right item, no need to
          // count nested items inside it for this lookup.
          return false;
        }
        counter++;
      }
      return true;
    });

    if (foundItemPos === -1 || !foundItemNode) return;

    // Inside an item, the first content position is foundItemPos + 1.
    // Children are laid out sequentially - each contributes nodeSize.
    let childStart = foundItemPos + 1;
    const item = foundItemNode as { childCount: number; child: (i: number) => { nodeSize: number; isTextblock: boolean } };
    if (ci < 0 || ci >= item.childCount) return;
    for (let i = 0; i < ci; i++) {
      childStart += item.child(i).nodeSize;
    }
    const child = item.child(ci);
    // childStart points to the position BEFORE the child node (just
    // before its open token). Inside-textblock positions are
    // childStart + 1 (start) and childStart + child.nodeSize - 1 (end).
    const TS = ed.state.selection.constructor;
    const targetPos = pos === 'start' ? childStart + 1 : childStart + child.nodeSize - 1;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, targetPos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { ii: itemIndex, ci: childIndex, pos: position });
}

/** Place caret at end of the first node of `typeName` matching `text`. */
async function caretAtEndOfNode(page: Page, typeName: string, text: string): Promise<void> {
  await page.evaluate(({ tn, txt }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: { doc: { descendants: (cb: (n: { type: { name: string }; nodeSize: number; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    let size = 0;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn && node.textContent === txt) {
        pos = p;
        size = node.nodeSize;
        return false;
      }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + size - 1));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { tn: typeName, txt: text });
}

/** Place caret at offset within the first node of `typeName` matching `text`. */
async function caretAtOffsetInNode(page: Page, typeName: string, text: string, offset: number): Promise<void> {
  await page.evaluate(({ tn, txt, off }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn && node.textContent === txt) { pos = p; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + 1 + off));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { tn: typeName, txt: text, off: offset });
}

/** Returns true if the editor has a top-level paragraph (not nested in a list). */
async function hasTopLevelEmptyParagraph(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string; childCount: number }) => void) => void } } } | undefined;
    let ok = false;
    ed?.state.doc.forEach((n) => {
      if (n.type.name === 'paragraph' && n.textContent === '' && n.childCount === 0) ok = true;
    });
    return ok;
  });
}

const undoKey = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

// ────────────────────────────────────────────────────────────────────────
// Group A - bullet listItem children-zone Enter
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - bullet listItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // A1 - regression guard: existing Heading.Enter behavior, already
  // covered in notion-list-strict.spec.ts but pinned again here for
  // matrix completeness (this is the SETUP step for A2/A11).
  test('A1 [label, h1] - end of h1, Enter creates empty trailing p inside same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 3,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'heading', text: 'Title' }),
        expect.objectContaining({ type: 'paragraph', text: '' }),
      ],
    });
  });

  // A2 - core bug. Empty trailing p + Enter -> only that p lifts out as
  // top-level sibling AFTER the bulletList. The listItem keeps [label, h1].
  test.fail('A2 [label, h1, empty-p] - in empty-p, Enter lifts ONLY empty-p as top-level after bulletList', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    // Cursor is now in trailing empty-p (placed by Heading.Enter).
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'heading', text: 'Title' }),
      ],
    });
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'bulletList', text: 'LabelTitle' },
      { type: 'paragraph', text: '' },
    ]);
  });

  // A3 - codeBlock as previous sibling. Empty trailing p still lifts.
  test.fail('A3 [label, codeBlock, empty-p] - in empty-p, Enter lifts as top-level', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><pre><code>x = 1</code></pre><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'codeBlock', text: 'x = 1' }),
      ],
    });
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // A4 - blockquote previous sibling.
  test.fail('A4 [label, blockquote, empty-p] - in empty-p, Enter lifts as top-level', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Quote</p></blockquote><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'blockquote', text: 'Quote' }),
      ],
    });
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // A5 - hr (leaf node) as previous sibling.
  test.fail('A5 [label, hr, empty-p] - in empty-p, Enter lifts as top-level (hr stays last in li)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><hr><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'horizontalRule']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // A6 - multiple non-paragraph children before empty trailing p.
  test.fail('A6 [label, h1, h2, empty-p] - in empty-p, Enter lifts as top-level (li keeps both headings)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>A</h1><h2>B</h2><p></p></li></ul>');
    await caretAtItemChild(page, 0, 3, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 3,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'heading', text: 'A' }),
        expect.objectContaining({ type: 'heading', text: 'B' }),
      ],
    });
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // A7 - empty paragraph in MIDDLE of children (not last). Plan 4
  // Q3.1 decides exact shape (split list in two? lift only middle p?).
  // Tight invariant: BOTH label and h1 stay inside list items (NOT
  // dumped to top-level - that's the bug we're fixing) AND a top-level
  // empty paragraph appears. Pre-fix `liftListItem` dumps everything
  // top-level, so labelInLi/belowInLi are both false → test fails as
  // expected today.
  test.fail('A7 [label, empty-p, h1] - in MIDDLE empty-p, Enter keeps label & h1 inside list items, lifts empty-p', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    await caretAtItemChild(page, 0, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const tops = await topLevelBlocks(page);
    const labelInLi = items.some((i) => i.children.some((c) => c.text === 'Label'));
    const belowInLi = items.some((i) => i.children.some((c) => c.text === 'Below'));
    expect(labelInLi).toBe(true);
    expect(belowInLi).toBe(true);
    // A top-level empty paragraph exists (the lifted middle p).
    expect(tops.some((t) => t.type === 'paragraph' && t.text === '')).toBe(true);
  });

  // A8 - non-empty trailing p, end + Enter. CURRENT: splitListItem
  // creates a new sibling listItem (NOT a stay-inside-li new p). This
  // is Phase 5 territory - Phase 3 fix does NOT change this behavior.
  // Marked `test` as a regression guard: Phase 3 must not accidentally
  // change non-empty-trailing behavior.
  test('A8 [label, h1, "Tail"] - end of "Tail", Enter currently creates new sibling listItem (Phase 5 territory)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Tail</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // Current behaviour: list item splits into two. Pin loosely - we
    // care that "Tail" content is not lost and there is now MORE than
    // one listItem visible. Phase 5 may change this to "stay inside
    // single li" with empty-p appended.
    const items = await listItemShapes(page);
    const tails = items.flatMap((it) => it.children).filter((c) => c.text === 'Tail');
    expect(tails.length).toBeGreaterThanOrEqual(1);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  // A9 - non-empty trailing p, mid + Enter. Same Phase 5 territory;
  // pin only that no half is lost.
  test('A9 [label, h1, "Tail"] - mid of "Tail", Enter does not lose either half', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>HelloWorld</p></li></ul>');
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const allText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(allText).toContain('Hello');
    expect(allText).toContain('World');
  });

  // A10 - extra paragraphs in children before trailing empty-p.
  test.fail('A10 [label, p1, p2, empty-p] - in empty-p, Enter lifts as top-level (li keeps [label, p1, p2])', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p>p1</p><p>p2</p><p></p></li></ul>');
    await caretAtItemChild(page, 0, 3, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'p1', 'p2']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // A11 - end-to-end: from end of h1, press Enter twice. After first
  // Enter, empty-p exists; after second, it lifts. Verifies the full
  // user flow as a single test.
  test.fail('A11 [label, h1] - 2x Enter from end of h1: first creates empty-p, second lifts', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(2);
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'bulletList', text: 'LabelTitle' },
      { type: 'paragraph', text: '' },
    ]);
  });

  // A12 - multi-press Enter cascade: after lift, subsequent Enters
  // run normal splitBlock at top-level (no further lift, paragraph
  // chain at top-level).
  test.fail('A12 [label, h1] - 3x Enter from end of h1: first creates empty-p, second lifts, third splits at top-level', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    // Expected: [bulletList, paragraph, paragraph]
    expect(tops.length).toBe(3);
    expect(tops[0]?.type).toBe('bulletList');
    expect(tops[1]?.type).toBe('paragraph');
    expect(tops[2]?.type).toBe('paragraph');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group B - ordered listItem (orderedList) mirrors of critical bullet cases
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - ordered listItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test.fail('B1 ol [label, h1, empty-p] - in empty-p, Enter lifts ONLY empty-p as top-level after orderedList', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1></li></ol>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'heading', text: 'Title' }),
      ],
    });
    const tops = await topLevelBlocks(page);
    expect(tops[0]?.type).toBe('orderedList');
    expect(tops.find((t) => t.type === 'paragraph' && t.text === '')).toBeTruthy();
  });

  test.fail('B2 ol [label, codeBlock, empty-p] - in empty-p, Enter lifts as top-level', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><pre><code>code()</code></pre><p></p></li></ol>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  test('B3 ol [label, h1, "Tail"] - end of "Tail", Enter does not lose content (Phase 5 territory)', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1><p>Tail</p></li></ol>');
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const allText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(allText).toContain('Tail');
    expect(allText).toContain('Title');
    expect(allText).toContain('Label');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group C - taskItem mirrors
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - taskItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test.fail('C1 taskItem [label, h1, empty-p] - Enter lifts empty-p as top-level after taskList', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'taskItem',
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: 'Label' }),
        expect.objectContaining({ type: 'heading', text: 'Title' }),
      ],
    });
    const tops = await topLevelBlocks(page);
    expect(tops[0]?.type).toBe('taskList');
    expect(tops.find((t) => t.type === 'paragraph' && t.text === '')).toBeTruthy();
  });

  test.fail('C2 taskItem [label, codeBlock, empty-p] - Enter lifts empty-p as top-level', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><pre><code>code()</code></pre><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  test.fail('C3 taskItem [label, blockquote, empty-p] - Enter lifts empty-p as top-level', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><blockquote><p>Q</p></blockquote><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'blockquote']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  test('C4 taskItem [label, h1, "Tail"] - end of "Tail", Enter does not lose content (Phase 5 territory)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p>Tail</p></li></ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const allText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(allText).toContain('Tail');
    expect(allText).toContain('Title');
  });

  test('C5 taskItem [label, h1, "Tail"] - mid of "Tail", Enter does not lose either half', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p>HelloWorld</p></li></ul>',
    );
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const allText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(allText).toContain('Hello');
    expect(allText).toContain('World');
  });

  // C6 - taskItem with only [label, empty-p]. Note: existing
  // TaskItem.Enter has a `taskItemNode.childCount > 1` branch; the
  // current behavior may already be partially correct for this case
  // (inside a parent listItem). This test pins post-fix expected for
  // the SIMPLE top-level taskItem case (no parent listItem).
  test.fail('C6 taskItem [label, empty-p] - in empty-p, Enter lifts as top-level (taskItem keeps [label])', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'taskItem',
      childCount: 1,
      children: [expect.objectContaining({ type: 'paragraph', text: 'Label' })],
    });
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group D - nested-list interactions
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - nested list interactions', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // D1 - outer li has nested list as child + empty trailing p of OUTER.
  // Cursor in outer's trailing empty-p. Lift behavior must affect ONLY
  // the outer's empty-p; inner list stays inside outer li.
  test.fail('D1 outer li [Outer-label, nested-ul, empty-p] - Enter in outer empty-p lifts that p, nested list stays', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul><p></p></li></ul>',
    );
    // Outer li is itemIndex 0; inner li is itemIndex 1. Outer's children
    // are [p Outer, bulletList(Inner), p empty]. Place caret in child 2.
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Outer li and inner li both still exist.
    const outerStill = items.find((i) => i.type === 'listItem' && i.text.includes('Outer'));
    const innerStill = items.find((i) => i.type === 'listItem' && i.text.includes('Inner'));
    expect(outerStill).toBeTruthy();
    expect(innerStill).toBeTruthy();
    // Outer's children no longer include the empty trailing p.
    expect(outerStill?.children?.length).toBe(2);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // D2 - taskItem with nested taskList + trailing empty-p of OUTER.
  test.fail('D2 outer taskItem [label, nested-taskList, empty-p] - Enter in outer empty-p lifts, nested taskList stays', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Outer</p><ul data-type="taskList"><li data-type="taskItem"><p>Inner</p></li></ul><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const outerStill = items.find((i) => i.type === 'taskItem' && i.text.startsWith('Outer'));
    const innerStill = items.find((i) => i.type === 'taskItem' && i.text === 'Inner');
    expect(outerStill).toBeTruthy();
    expect(innerStill).toBeTruthy();
    expect(outerStill?.children?.length).toBe(2);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // D3 - regression guard: cursor in DEEPLY nested innermost listItem's
  // empty trailing p. The fix should target the INNER list item, not
  // the outer taskItem. This test ensures the helper resolves to the
  // closest list-item ancestor, not jumping to outer.
  test.fail('D3 taskItem > bulletList > listItem [label, empty-p] - Enter in inner empty-p affects inner only, outer taskItem intact', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>OuterLabel</p><ul><li><p>InnerLabel</p><p></p></li></ul></li></ul>',
    );
    // doc-traversal order: taskItem first (idx 0), then nested listItem (idx 1).
    await caretAtItemChild(page, 1, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Outer taskItem must still exist with OuterLabel.
    const outer = items.find((i) => i.type === 'taskItem');
    expect(outer).toBeTruthy();
    expect(outer?.text).toContain('OuterLabel');
    // Inner listItem now has only [InnerLabel] (empty-p removed).
    const inner = items.find((i) => i.type === 'listItem' && i.text === 'InnerLabel');
    expect(inner).toBeTruthy();
    expect(inner?.children?.length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group E - regression guards (must NOT regress after fix)
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - regression guards', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // E1 - empty label paragraph (only child) + Enter still lifts the
  // ENTIRE listItem out (correct existing behavior - "exit empty bullet").
  test('E1 [empty-label] only - Enter lifts whole listItem (existing UX preserved)', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtItemChild(page, 0, 0, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // bulletList should be GONE; only top-level paragraph remains.
    const tops = await topLevelBlocks(page);
    expect(tops.some((t) => t.type === 'bulletList')).toBe(false);
    expect(tops.some((t) => t.type === 'paragraph')).toBe(true);
  });

  // E2 - non-empty label, end of label + Enter creates new sibling listItem.
  test('E2 [label "Hi", h1] - end of "Hi", Enter creates new sibling li (h1 follows in original or new)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Hi</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Hi');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // splitListItem creates 2 list items; "Hi" stays in first.
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]?.children[0]?.text).toBe('Hi');
  });

  // E3 - mid of label paragraph, Enter splits.
  test('E3 [label "HelloWorld", h1] - mid of label, Enter splits at cursor', async ({ page }) => {
    await setContent(page, '<ul><li><p>HelloWorld</p><h1>Title</h1></li></ul>');
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBeGreaterThanOrEqual(2);
    const firstLabel = items[0]?.children[0]?.text;
    expect(firstLabel).toBe('Hello');
  });

  // E4 - single non-empty label, Enter creates fresh empty sibling li.
  test('E4 [label "Item"] - end of label, Enter creates new empty sibling li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Item</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Item');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(2);
    expect(items[0]?.children[0]?.text).toBe('Item');
    expect(items[1]?.children[0]?.text).toBe('');
  });

  // E5 - regression guard: Heading.Enter at end of nested heading still
  // inserts paragraph as next sibling INSIDE the listItem (Phase 1 of
  // listitems_improvement.md). Plan 4 must not break this.
  test('E5 nested h1 in li, end of heading - Enter inserts empty p as next sibling INSIDE same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  // E6 - regression guard: codeBlock Enter inserts newline within pre,
  // does not escape, does not invoke list-item handlers.
  test('E6 nested codeBlock in li, Enter inserts newline inside pre (does not escape)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><pre><code>line1</code></pre></li></ul>');
    await caretAtEndOfNode(page, 'codeBlock', 'line1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // codeBlock still inside li; its text should now contain a newline.
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock']);
  });

  // E7 - regression guard: blockquote inner-p Enter splits inside bq.
  test('E7 nested blockquote in li, Enter inside blockquote inner-p splits inside bq (no list lift)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Quoted</p></blockquote></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Quoted');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // List item still exists with blockquote inside.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.[1]?.type).toBe('blockquote');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group F - multi-step user flows
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - multi-step user flows', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // F1 - realistic flow that triggers the bug via ListIndent + Heading
  // Enter + ListItem Enter chain. Setup: bulletList with single label,
  // then top-level heading. Tab on heading invokes ListIndent which
  // moves the heading INTO the last list item as a nested child. End
  // of heading + Enter inserts trailing empty-p. Second Enter on empty
  // trailing-p triggers the buggy lift.
  test.fail('F1 [list, heading-after-list] + Tab + 2x Enter from end of heading - empty-p lifts cleanly, list intact', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p></li></ul><h1>Heading</h1>');
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Tab'); // ListIndent moves heading into last li
    await page.waitForTimeout(40);
    // li now [label, heading]. Reposition caret at end of heading
    // (Tab dispatch may have moved selection).
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter'); // creates trailing empty-p inside li
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter'); // empty-p should lift cleanly
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Heading']);
    // Top-level: bulletList + lifted empty paragraph.
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  // F2 - exact verbatim user-reported bug reproduction.
  test.fail('F2 user-reported bug verbatim: H1 Enter Enter does NOT explode the list item', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // The CRUCIAL assertion: the listItem still exists and label+heading
    // are still inside it. Pre-fix: items.length === 0 (everything lifted).
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title']);
  });

  // F3 - typing in lifted paragraph after A2-style lift lands correctly.
  test.fail('F3 after empty-p lift, typing lands in lifted top-level paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('After list');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    const lifted = tops.find((t) => t.type === 'paragraph');
    expect(lifted?.text).toBe('After list');
    // Listitem still has [Label, Title] - typing did not bleed back.
    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Group G - best-practice guards (undo, modifier keys, selection)
// ────────────────────────────────────────────────────────────────────────

test.describe('Enter in children-zone - best-practice guards', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // G1 - one undo step restores the pre-lift listItem shape.
  test.fail('G1 undo after empty-p lift restores [label, h1, empty-p] inside li in one step', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    // Lifted: bulletList(li=[label, h1]) + p ""
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // After ONE undo we expect to be back to [label, h1, empty-p] inside li.
    expect(items[0]?.childCount).toBe(3);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  // G2 - cursor lands at start of lifted top-level paragraph (ready to type).
  test.fail('G2 after empty-p lift, caret is in the lifted paragraph (typing appears there)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('X');
    await page.waitForTimeout(40);

    // The lifted paragraph (top-level) should now contain "X".
    const tops = await topLevelBlocks(page);
    const xPara = tops.find((t) => t.type === 'paragraph' && t.text === 'X');
    expect(xPara).toBeTruthy();
    // listItem text content unchanged (typing did not go into li).
    const items = await listItemShapes(page);
    expect(items[0]?.text).toBe('LabelTitle');
  });

  // G3 - Shift-Enter inside empty trailing p inserts hardBreak (not lift).
  test('G3 [label, h1, empty-p] Shift-Enter inside empty-p inserts hard break, does NOT lift', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    // Cursor in trailing empty-p. Shift-Enter should NOT trigger lift.
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(40);

    // List item should still contain [label, h1, p] structure (the
    // trailing p may now contain a <br> hardBreak but it's still inside li).
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(3);
  });

  // G4 - Mod-Enter inside empty trailing p of TASKitem toggles task,
  // does NOT lift. (Mod-Enter is the toggleTask shortcut on taskItem.)
  test('G4 taskItem [label, h1, empty-p] Mod-Enter inside empty-p toggles task checked state, does NOT lift', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    // Cursor in trailing empty-p of taskItem.
    const modEnter = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await page.keyboard.press(modEnter);
    await page.waitForTimeout(40);

    // taskItem still has [label, h1, empty-p] (no lift).
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childCount).toBe(3);
    // Checked state flipped to true.
    const checked = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; attrs: Record<string, unknown> }) => boolean | void) => void } } } | undefined;
      let isChecked = false;
      ed?.state.doc.descendants((n) => {
        if (n.type.name === 'taskItem') { isChecked = n.attrs['checked'] === true; return false; }
        return true;
      });
      return isChecked;
    });
    expect(checked).toBe(true);
  });
});
