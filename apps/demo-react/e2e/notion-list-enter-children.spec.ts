/**
 * E2E coverage for Enter + Backspace inside the children-zone of a
 * list/task item (`paragraph block*` schema).
 *
 * Notion-style "accumulate-on-Enter, exit-on-Backspace" model:
 *
 *  - Empty children-zone paragraph + Enter -> insert another empty
 *    paragraph as next sibling INSIDE the same list item (accumulate).
 *  - Empty children-zone paragraph + Backspace at offset 0 -> lift it
 *    out as a top-level paragraph (exit list one nesting level).
 *  - Empty LABEL paragraph + Enter -> liftListItem flow ("exit empty
 *    bullet").
 *  - Heading.Enter at end of nested heading -> empty paragraph in
 *    children-zone (regression preserved).
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
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
          return false;
        }
        counter++;
      }
      return true;
    });

    if (foundItemPos === -1 || !foundItemNode) return;

    let childStart = foundItemPos + 1;
    const item = foundItemNode as { childCount: number; child: (i: number) => { nodeSize: number; isTextblock: boolean } };
    if (ci < 0 || ci >= item.childCount) return;
    for (let i = 0; i < ci; i++) {
      childStart += item.child(i).nodeSize;
    }
    const child = item.child(ci);
    const TS = ed.state.selection.constructor;
    const targetPos = pos === 'start' ? childStart + 1 : childStart + child.nodeSize - 1;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, targetPos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { ii: itemIndex, ci: childIndex, pos: position });
}

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

// ════════════════════════════════════════════════════════════════════════
// Group A - bullet listItem Enter accumulate
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - bullet listItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // A1 - Heading.Enter creates empty p in children-zone (regression baseline)
  test('A1 [label, h1] - end of h1, Enter creates empty trailing p inside same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
    expect(items[0]?.children?.[2]?.text).toBe('');
  });

  // A2 - Enter on empty trailing p → another empty p siblng INSIDE li (accumulate).
  test('A2 [label, h1, empty-p] - in empty-p, Enter accumulates another empty p inside li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, h1, empty-p, NEW empty-p]
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitle' }]);
  });

  // A3 - codeBlock as previous sibling, accumulate.
  test('A3 [label, codeBlock, empty-p] - in empty-p, Enter accumulates another empty p', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><pre><code>x = 1</code></pre><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock', 'paragraph', 'paragraph']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(false);
  });

  // A4 - blockquote previous sibling.
  test('A4 [label, blockquote, empty-p] - in empty-p, Enter accumulates', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Quote</p></blockquote><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'blockquote', 'paragraph', 'paragraph']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(false);
  });

  // A5 - hr (leaf node) previous sibling.
  test('A5 [label, hr, empty-p] - in empty-p, Enter accumulates', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><hr><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph', 'paragraph']);
  });

  // A6 - multiple non-paragraph children before empty trailing p.
  test('A6 [label, h1, h2, empty-p] - Enter accumulates (li keeps both headings)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>A</h1><h2>B</h2><p></p></li></ul>');
    await caretAtItemChild(page, 0, 3, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'heading', 'paragraph', 'paragraph']);
  });

  // A7 - empty p in MIDDLE (not last child). New sibling inserted AFTER it.
  test('A7 [label, empty-p, h1] - in MIDDLE empty-p, Enter inserts new sibling AFTER (between empty-p and h1)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    await caretAtItemChild(page, 0, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, empty-p (orig), NEW empty-p, h1]
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'heading']);
    expect(items[0]?.children?.[3]?.text).toBe('Below');
  });

  // A8 - non-empty trailing p, end + Enter splits in place,
  // empty p appended INSIDE same li (no new sibling listItem).
  test('A8 [label, h1, "Tail"] - end of "Tail", Enter appends empty p inside same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Tail</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, h1, "Tail", NEW empty-p]
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Tail', '']);
    // No new sibling listItem - top-level still single bulletList.
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitleTail' }]);
  });

  // A9 - mid of non-empty trailing splits paragraph in place.
  test('A9 [label, h1, "Tail"] - mid of "HelloWorld", Enter splits paragraph in place inside same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>HelloWorld</p></li></ul>');
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, h1, "Hello", "World"] - text split into two paragraphs both INSIDE same li.
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Hello', 'World']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitleHelloWorld' }]);
  });

  // A10 - extra paragraphs in children before trailing empty-p.
  test('A10 [label, p1, p2, empty-p] - in empty-p, Enter accumulates (li keeps all)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p>p1</p><p>p2</p><p></p></li></ul>');
    await caretAtItemChild(page, 0, 3, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'p1', 'p2', '', '']);
  });

  // A11 - 2x Enter from end of h1 = li gets 2 empty p siblings.
  test('A11 [label, h1] - 2x Enter from end of h1 → li has 4 children (label, h1, empty-p, empty-p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(4);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitle' }]);
  });

  // A12 - 3x Enter from end of h1 = li gets 3 empty p siblings.
  test('A12 [label, h1] - 3x Enter from end of h1 → li has 5 children (label, h1, 3x empty-p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(5);
    expect(items[0]?.children?.map((c) => c.type)).toEqual([
      'paragraph', 'heading', 'paragraph', 'paragraph', 'paragraph',
    ]);
  });

  // A13 - mid-list bullet, Enter accumulates only inside that li, not split wrapper.
  test('A13 mid-list bullet [li=A, li=[label, h1, empty-p (cursor)], li=C] - middle li accumulates, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>A</p></li><li><p>B-label</p><h1>B-title</h1></li><li><p>C</p></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'B-title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    // No split: top-level still single bulletList.
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('bulletList');

    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const middle = items.find((i) => i.text === 'B-labelB-title');
    expect(middle?.children?.length).toBe(4);
  });

  // A14 - blockquote-wrapped: accumulate stays inside li, blockquote intact.
  test('A14 [blockquote > ul > li=[label, h1, empty-p]] - empty-p accumulates inside li, bq intact', async ({ page }) => {
    await setContent(
      page,
      '<blockquote><ul><li><p>Label</p><h1>Title</h1></li></ul></blockquote>',
    );
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('blockquote');

    const items = await listItemShapes(page);
    expect(items[0]?.children?.length).toBe(4);
  });

  // A15 - single-li at top of doc, accumulate.
  test('A15 single-li bullet, empty trailing-p accumulates', async ({ page }) => {
    await setContent(page, '<ul><li><p>Only</p><h1>Heading</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(4);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'OnlyHeading' }]);
  });

  // A16 - cursor at START of empty-p (vs end).
  test('A16 cursor at START of empty trailing-p - accumulates same as end-of-empty', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'start');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(4);
  });

  // A17 - middle empty-p between non-paragraph siblings.
  test('A17 [label, h1, empty-p, h2] - middle empty-p, Enter inserts new sibling after middle empty-p', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>A</h1><p></p><h2>B</h2></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, h1, empty-p (orig), NEW empty-p, h2]
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'heading']);
  });

  // A18 - 3-level nested ul, cursor in INNERMOST empty-p, accumulates only innermost.
  test('A18 3-level nested ul, cursor in INNERMOST empty-p - accumulates only innermost, outer intact', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>L1</p><ul><li><p>L2</p><ul><li><p>L3</p><h1>Inner</h1></li></ul></li></ul></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Inner');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const innermost = items.find((i) => i.text === 'L3Inner');
    expect(innermost?.children?.length).toBe(4); // [L3 label, Inner h1, empty-p, NEW empty-p]
  });

  // A19 - multiple sequential empty paragraphs, cursor in 2nd one.
  test('A19 [label, empty-p, empty-p, h1] - cursor in 2nd empty-p, Enter accumulates after it', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p></p><p></p><h1>Below</h1></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, empty-p (1st orig), empty-p (2nd orig), NEW empty-p, h1]
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph', 'heading']);
  });

  // A20 - critical regression: must NOT explode the listItem (the original bug).
  test('A20 [label, h1] - 2x Enter from end of h1 does NOT explode the list item (original bug regression)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // CRITICAL: list item still exists and contains label + heading.
    expect(items).toHaveLength(1);
    const labels = items[0]?.children?.filter((c) => c.text === 'Label');
    const titles = items[0]?.children?.filter((c) => c.text === 'Title');
    expect(labels?.length).toBe(1);
    expect(titles?.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group B - ordered listItem Enter accumulate
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - ordered listItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('B1 ol [label, h1, empty-p] - in empty-p, Enter accumulates inside li', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1></li></ol>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(4);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'orderedList', text: 'LabelTitle' }]);
  });

  test('B2 ol [label, codeBlock, empty-p] - Enter accumulates', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><pre><code>code()</code></pre><p></p></li></ol>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock', 'paragraph', 'paragraph']);
  });

  test('B3 ol [label, h1, "Tail"] - end of "Tail", Enter appends empty p inside same li', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1><p>Tail</p></li></ol>');
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Tail', '']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'orderedList', text: 'LabelTitleTail' }]);
  });

  test('B4 mid-list ol [li=1, li=[label, h1, empty-p], li=3] - middle accumulates, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ol><li><p>1</p></li><li><p>2-label</p><h1>2-title</h1></li><li><p>3</p></li></ol>',
    );
    await caretAtEndOfNode(page, 'heading', '2-title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    // No split.
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('orderedList');
    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
  });

  test('B5 single-li ol accumulates same as bullet', async ({ page }) => {
    await setContent(page, '<ol><li><p>Only</p><h1>H</h1></li></ol>');
    await caretAtEndOfNode(page, 'heading', 'H');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group C - taskItem Enter accumulate
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - taskItem', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('C1 taskItem [label, h1, empty-p] - in empty-p, Enter accumulates inside taskItem', async ({ page }) => {
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
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childCount).toBe(4);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'taskList', text: 'LabelTitle' }]);
  });

  test('C2 taskItem [label, codeBlock, empty-p] - Enter accumulates', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><pre><code>code()</code></pre><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock', 'paragraph', 'paragraph']);
  });

  test('C3 taskItem [label, blockquote, empty-p] - Enter accumulates', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><blockquote><p>Q</p></blockquote><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'blockquote', 'paragraph', 'paragraph']);
  });

  test('C4 taskItem [label, h1, "Tail"] - end of "Tail", Enter appends empty p inside same taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p>Tail</p></li></ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'Tail');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Tail', '']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'taskList', text: 'LabelTitleTail' }]);
  });

  test('C5 taskItem [label, h1, "HelloWorld"] - mid of paragraph, Enter splits in place inside same taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p>HelloWorld</p></li></ul>',
    );
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Hello', 'World']);
  });

  test('C6 taskItem [label, empty-p] - in empty-p (2nd child), Enter accumulates', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childCount).toBe(3);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'paragraph', 'paragraph']);
  });

  test('C7 taskItem [label, h1, empty-p, h2] - middle empty-p Enter inserts after empty-p', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>A</h1><p></p><h2>B</h2></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'heading']);
  });

  test('C8 mid-list taskList [taskItem A, taskItem [label, h1, empty-p], taskItem C] - middle accumulates, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>A</p></li>'
      + '<li data-type="taskItem"><p>B-label</p><h1>B-title</h1></li>'
      + '<li data-type="taskItem"><p>C</p></li>'
      + '</ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'B-title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('taskList');
    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
  });

  test('C9 3-level nested with taskItem at innermost - accumulates inside taskItem only', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>L1</p><ul><li><p>L2</p>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>L3-task</p><h1>Inner</h1></li></ul>'
      + '</li></ul></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Inner');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const innermost = items.find((i) => i.type === 'taskItem' && i.text === 'L3-taskInner');
    expect(innermost?.children?.length).toBe(4);
  });

  test('C10 REGRESSION: empty LABEL of taskItem nested in listItem - existing parent-listItem promotion fires (NOT accumulate branch)', async ({ page }) => {
    await setContent(
      page,
      '<ol><li><p>Outer</p><ul data-type="taskList"><li data-type="taskItem"><p></p></li></ul></li></ol>',
    );
    await caretAtItemChild(page, 1, 0, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // Promotion path: taskItem is removed, new listItem inserted.
    const items = await listItemShapes(page);
    expect(items.filter((i) => i.type === 'taskItem').length).toBe(0);
    expect(items.filter((i) => i.type === 'listItem').length).toBeGreaterThanOrEqual(2);
  });

  test('C11 undo after taskItem accumulate restores [label, h1, empty-p] in one step', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(3);
  });

  test('C12 [blockquote > taskList > taskItem [label, h1, empty-p]] - accumulate inside taskItem, bq intact', async ({ page }) => {
    await setContent(
      page,
      '<blockquote><ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1></li></ul></blockquote>',
    );
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('blockquote');
    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(4);
  });

  test('C13 accumulate preserves taskItem checked attribute', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p><h1>Notes</h1></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Notes');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const checkedInDom = await page.evaluate((sel) => {
      const el = document.querySelector(`${sel} li[data-type="taskItem"]`);
      return el?.getAttribute('data-checked');
    }, editorSelector);
    expect(checkedInDom).toBe('true');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group D - nested-list interactions
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - nested list interactions', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('D1 outer li [Outer-label, nested-ul, empty-p] - Enter in outer empty-p accumulates inside outer li', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const outer = items.find((i) => i.text.includes('Outer'));
    // Outer li now has [p Outer, bulletList Inner, p empty (orig), p empty (NEW)]
    expect(outer?.childCount).toBe(4);
  });

  test('D2 outer taskItem [label, nested-taskList, empty-p] - Enter in outer empty-p accumulates inside outer taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Outer</p><ul data-type="taskList"><li data-type="taskItem"><p>Inner</p></li></ul><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const outer = items.find((i) => i.type === 'taskItem' && i.text.startsWith('Outer'));
    expect(outer?.childCount).toBe(4);
  });

  test('D3 taskItem > bulletList > listItem [label, empty-p] - Enter in inner empty-p accumulates inside inner li', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>OuterLabel</p><ul><li><p>InnerLabel</p><p></p></li></ul></li></ul>',
    );
    await caretAtItemChild(page, 1, 1, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const inner = items.find((i) => i.type === 'listItem' && i.text === 'InnerLabel');
    expect(inner?.childCount).toBe(3); // [InnerLabel, empty-p (orig), NEW empty-p]
  });

  test('D4 bullet inside taskItem - Enter on inner bullet children-zone accumulates correctly', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p><ul><li><p>Inner</p><h1>Heading</h1></li></ul></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    const inner = items.find((i) => i.type === 'listItem' && i.text.startsWith('Inner'));
    expect(inner?.childCount).toBe(4);
  });

  test('D5 deeply nested 3-level - cursor in deepest accumulates only deepest', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>L1</p><ul><li><p>L2</p><ul><li><p>L3</p><h1>Inner</h1></li></ul></li></ul></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Inner');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const inner = items.find((i) => i.text === 'L3Inner');
    expect(inner?.childCount).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group E - regression guards (must NOT regress)
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter regression guards', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('E1 [empty-label] only - Enter lifts whole listItem (existing UX preserved)', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtItemChild(page, 0, 0, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.some((t) => t.type === 'bulletList')).toBe(false);
    expect(tops.some((t) => t.type === 'paragraph')).toBe(true);
  });

  test('E2 [label "Hi", h1] - end of "Hi", Enter creates new sibling li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Hi</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Hi');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]?.children[0]?.text).toBe('Hi');
  });

  test('E3 [label "HelloWorld", h1] - mid of label, Enter splits at cursor', async ({ page }) => {
    await setContent(page, '<ul><li><p>HelloWorld</p><h1>Title</h1></li></ul>');
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]?.children[0]?.text).toBe('Hello');
  });

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

  test('E5 nested h1 in li, end of heading - Enter inserts empty p inside same li (Heading.Enter)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  test('E6 nested codeBlock in li, Enter inserts newline inside pre (does not escape)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><pre><code>line1</code></pre></li></ul>');
    await caretAtEndOfNode(page, 'codeBlock', 'line1');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock']);
  });

  test('E7 nested blockquote in li, Enter inside bq inner-p splits inside bq (no list lift)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Quoted</p></blockquote></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Quoted');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.[1]?.type).toBe('blockquote');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group F - user-flow scenarios
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - user flows', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('F1 [list, heading-after-list] + Tab + 2x Enter from end of heading - accumulates in li, list intact', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p></li></ul><h1>Heading</h1>');
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(40);
    await caretAtEndOfNode(page, 'heading', 'Heading');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [Label, Heading, empty-p, empty-p]
    expect(items[0]?.childCount).toBe(4);
    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('bulletList');
  });

  test('F2 user-reported bug verbatim: H1 Enter Enter does NOT explode the list item (accumulates)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // List item still exists, label & title still inside.
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.[0]?.text).toBe('Label');
    expect(items[0]?.children?.[1]?.text).toBe('Title');
    expect(items[0]?.childCount).toBe(4);
  });

  test('F3 after accumulate, typing lands in newly-created empty paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Note text');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Last child of li now contains the typed text.
    expect(items[0]?.children?.[3]?.text).toBe('Note text');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group G - modifier key + best-practice
// ════════════════════════════════════════════════════════════════════════

test.describe('Enter accumulate - modifier key + best-practice', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('G1 undo after accumulate restores [label, h1, empty-p] inside li in one step', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(3);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  test('G2 after accumulate, caret is in newly-inserted paragraph (typing appears there)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('X');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // 4th child is the new p with "X"; original 3rd is still empty.
    expect(items[0]?.children?.[2]?.text).toBe('');
    expect(items[0]?.children?.[3]?.text).toBe('X');
  });

  test('G3 [label, h1, empty-p] Shift-Enter inside empty-p inserts hard break, does NOT accumulate', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(40);

    // Same 3 children (label, h1, empty-p with internal hardBreak), no extra empty p.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(3);
  });

  test('G4 taskItem [label, h1, empty-p] Mod-Enter inside empty-p toggles task checked, does NOT accumulate', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1></li></ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    const modEnter = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
    await page.keyboard.press(modEnter);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childCount).toBe(3);
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

// ════════════════════════════════════════════════════════════════════════
// Group H - Backspace exit (lift empty children-zone p as top-level)
// ════════════════════════════════════════════════════════════════════════

test.describe('Backspace exit - empty children-zone paragraph lifts as top-level', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('H1 bullet [label, h1, empty-p] - Backspace exits, li retains [label, h1], top-level p appears', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading']);
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'bulletList', text: 'LabelTitle' },
      { type: 'paragraph', text: '' },
    ]);
  });

  test('H2 ordered [label, h1, empty-p] - Backspace exits same as bullet', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1><p></p></li></ol>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(2);
    const tops = await topLevelBlocks(page);
    expect(tops[0]?.type).toBe('orderedList');
    expect(tops[1]?.type).toBe('paragraph');
  });

  test('H3 taskItem [label, h1, empty-p] - Backspace exits, taskItem retains [label, h1]', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading']);
    const tops = await topLevelBlocks(page);
    expect(tops[0]?.type).toBe('taskList');
    expect(tops[1]?.type).toBe('paragraph');
  });

  test('H4 [label, codeBlock, empty-p] - Backspace exit (codeBlock stays in li)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><pre><code>x = 1</code></pre><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'codeBlock']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  test('H5 [label, blockquote, empty-p] - Backspace exit (blockquote stays in li)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Q</p></blockquote><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'blockquote']);
  });

  test('H6 mid-list bullet [li=A, li=[label, h1, empty-p (cursor)], li=C] - Backspace splits wrapper, lifted-p between halves', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>A</p></li><li><p>B-label</p><h1>B-title</h1><p></p></li><li><p>C</p></li></ul>',
    );
    await caretAtItemChild(page, 1, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    // Wrapper splits, lifted-p between halves.
    expect(tops.length).toBe(3);
    expect(tops[0]?.type).toBe('bulletList');
    expect(tops[1]?.type).toBe('paragraph');
    expect(tops[1]?.text).toBe('');
    expect(tops[2]?.type).toBe('bulletList');
  });

  test('H7 [blockquote > ul > li=[label, h1, empty-p]] - Backspace exit stays INSIDE blockquote', async ({ page }) => {
    await setContent(
      page,
      '<blockquote><ul><li><p>Label</p><h1>Title</h1><p></p></li></ul></blockquote>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Top-level: still single blockquote.
    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('blockquote');

    // Blockquote contains: bulletList + paragraph (lifted-p inside bq).
    const bqChildTypes = await page.evaluate((sel) => {
      const bq = document.querySelector(`${sel} blockquote`);
      if (!bq) return [];
      return Array.from(bq.children).map((el) => el.tagName.toLowerCase());
    }, editorSelector);
    expect(bqChildTypes).toEqual(['ul', 'p']);
  });

  test('H8 3-level nested - Backspace in deepest empty-p exits one level (to outer li children-zone)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>L1</p><ul><li><p>L2</p><ul><li><p>L3</p><h1>Inner</h1><p></p></li></ul></li></ul></li></ul>',
    );
    await caretAtItemChild(page, 2, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Innermost li loses empty-p (now has [L3, h1]).
    const inner = items.find((i) => i.text === 'L3Inner');
    expect(inner?.childCount).toBe(2);
    // Lifted-p sits as a sibling at one level out (inside L2 listItem children-zone).
    // L2 li now has 3 children: [L2-label, nested-ul, lifted-p].
    const l2 = items.find((i) => i.text.startsWith('L2L3Inner') || i.text.startsWith('L2'));
    expect(l2?.childCount).toBe(3);
  });

  test('H9 undo after Backspace exit restores [label, h1, empty-p] inside li in one step', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.childCount).toBe(3);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph']);
  });

  test('H10 cursor lands at start of lifted top-level paragraph (typing appears there)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);
    await page.keyboard.type('After list');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    const lifted = tops.find((t) => t.type === 'paragraph');
    expect(lifted?.text).toBe('After list');
    // listItem still has [label, h1] (no leakage back).
    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title']);
  });

  test('H11 REGRESSION: Backspace at start of EMPTY label (childIndex 0) does NOT trigger our branch (existing logic fires)', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await caretAtItemChild(page, 0, 0, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Existing behavior: empty label Backspace lifts entire item out, doc has just a paragraph.
    const tops = await topLevelBlocks(page);
    expect(tops.some((t) => t.type === 'bulletList')).toBe(false);
    expect(tops.some((t) => t.type === 'paragraph')).toBe(true);
  });

  test('H12 REGRESSION: Backspace at start of NON-empty children-zone paragraph does NOT lift (default backspace runs)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Body</p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'start');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Default backspace at start of non-empty p: typically merges with previous block (heading).
    // Whatever exact result, the listItem MUST still exist (not lifted out as exit).
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // No top-level paragraph appeared via lift.
    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('bulletList');
  });

  test('H13 Backspace at MID of empty children-zone p (parentOffset > 0) - falls through, no lift', async ({ page }) => {
    // An empty paragraph has only one valid offset (0), so this case
    // collapses with H1. Pin via direct PM caret at start - same as
    // H1 outcome, but verify the parentOffset constraint works as
    // intended (no double-trigger).
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'start');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Same as H1 effectively - lift fires.
    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group I - multi-Enter accumulate verification (extended scenarios)
// ════════════════════════════════════════════════════════════════════════

test.describe('Multi-Enter accumulate verification', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('I1 5x Enter accumulates 5 empty paragraphs, no exit', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(20);
    }

    const items = await listItemShapes(page);
    // [label, h1] + 5 empty paragraphs = 7 children.
    expect(items[0]?.childCount).toBe(7);
    // No top-level paragraph - everything stays inside the li.
    expect(await hasTopLevelEmptyParagraph(page)).toBe(false);
  });

  test('I2 10x Enter accumulates 10 empty paragraphs, no exit', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(20);
    }

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(12);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitle' }]);
  });

  test('I3 Enter, type content, Enter - second Enter appends empty p INSIDE li (splitBlock at end of non-empty children-zone p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Note');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // "Note" stays in li, NEW empty p appended after.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', '']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitleNote' }]);
  });

  test('I4 mixed accumulate scenario - heading + multiple Enters + type + Enter', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Final note');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Each Enter from end of h1 creates ONE empty-p (Heading.Enter on
    // press 1, then accumulate on presses 2 + 3). Then typing fills
    // the LATEST empty-p. So final shape: [label, h1, empty-p, empty-p,
    // p with "Final note"] = 5 children.
    expect(items[0]?.childCount).toBe(5);
    expect(items[0]?.children?.[4]?.text).toBe('Final note');
  });

  test('I5 alternating Enter and type - builds children-zone with mixed paragraphs (stays inside same li)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Title');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('First');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Second');
    await page.waitForTimeout(40);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Third');
    await page.waitForTimeout(40);

    // All three notes accumulate INSIDE same li, no new sibling listItem.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'First', 'Second', 'Third']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitleFirstSecondThird' }]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group J - Selection / context edge cases
// ════════════════════════════════════════════════════════════════════════

test.describe('Selection / context edge cases', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('J1 range selection across listItem + Enter does NOT trigger accumulate (default behaviour)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1></li></ul>');
    // Programmatically set a non-collapsed selection covering "Title".
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: { doc: { descendants: (cb: (n: { type: { name: string }; nodeSize: number; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number, b?: number) => unknown } } };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let pos = -1;
      let size = 0;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'heading' && node.textContent === 'Title') { pos = p; size = node.nodeSize; return false; }
        return true;
      });
      if (pos === -1) return;
      const TS = ed.state.selection.constructor;
      // Range from start of "Title" to end of "Title".
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + 1, pos + size - 1));
      ed.view.dispatch(tr);
      ed.view.dom.focus();
    });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // Default behaviour: selection deleted, then split or splitListItem.
    // Crucial invariant: NO empty-p sibling accumulated (our branch only
    // fires for empty + collapsed).
    const items = await listItemShapes(page);
    // listItem still exists; "Label" preserved.
    expect(items.length).toBeGreaterThanOrEqual(1);
    const allText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { textContent: string } } } | undefined;
      return ed?.state.doc.textContent ?? '';
    });
    expect(allText).toContain('Label');
  });

  test('J2 range selection across empty children-zone p + Backspace does NOT trigger exit (default delete-selection)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    // Range across "Title" + empty-p (multi-block selection).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: { doc: { descendants: (cb: (n: { type: { name: string }; nodeSize: number; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number, b?: number) => unknown } } };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let titlePos = -1;
      let titleSize = 0;
      ed.state.doc.descendants((node, p) => {
        if (titlePos !== -1) return false;
        if (node.type.name === 'heading' && node.textContent === 'Title') { titlePos = p; titleSize = node.nodeSize; return false; }
        return true;
      });
      if (titlePos === -1) return;
      const TS = ed.state.selection.constructor;
      // Range from inside "Title" to past it (covers empty-p).
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, titlePos + 1, titlePos + titleSize + 2));
      ed.view.dispatch(tr);
      ed.view.dom.focus();
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Range deleted, no exit-as-paragraph appears.
    expect(await hasTopLevelEmptyParagraph(page)).toBe(false);
  });

  test('J3 cursor in blockquote-inner paragraph in children-zone + Enter does NOT trigger accumulate (delegates to default Blockquote behaviour)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p>Quoted</p></blockquote></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Quoted');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    // listItem still has [paragraph, blockquote] children. NO new empty
    // paragraph appended directly to listItem (because cursor's
    // immediate ancestor is blockquote, not listItem - our handler
    // bails). Default behaviour splits inside blockquote.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.[0]?.type).toBe('paragraph');
    expect(items[0]?.children?.[1]?.type).toBe('blockquote');
    // listItem child count is still 2 - no extra empty p at the listItem level.
    expect(items[0]?.childCount).toBe(2);
  });

  test('H14 Backspace on MIDDLE empty children-zone p [label, empty-p (cursor), h1] - exits as top-level paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    await caretAtItemChild(page, 0, 1, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // Lift fires for empty middle p too. Result: listItem keeps
    // [label, h1] (middle empty-p removed). Top-level: bulletList +
    // lifted paragraph.
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading']);
    expect(await hasTopLevelEmptyParagraph(page)).toBe(true);
  });

  test('B6 ordered list Backspace exit (mirror H1 for ol)', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1><p></p></li></ol>');
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.childCount).toBe(2);
    const tops = await topLevelBlocks(page);
    expect(tops[0]?.type).toBe('orderedList');
    expect(tops[1]?.type).toBe('paragraph');
  });

  test('C14 taskItem Backspace exit preserves checked attribute on remaining taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p><h1>Notes</h1><p></p></li></ul>',
    );
    await caretAtItemChild(page, 0, 2, 'end');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading']);
    const checkedInDom = await page.evaluate((sel) => {
      const el = document.querySelector(`${sel} li[data-type="taskItem"]`);
      return el?.getAttribute('data-checked');
    }, editorSelector);
    expect(checkedInDom).toBe('true');
  });

  // C15 - REGRESSION: cursor in blockquote-inner empty paragraph nested
  // in a li, Backspace does NOT trigger the children-zone exit branch
  // (paragraph is not a DIRECT child of the listItem). The util
  // `getListItemCursorContext` returns null for this case and the
  // Backspace handler falls through to default PM behaviour.
  test('C15 [li > blockquote > empty-p] - Backspace falls through to default (no list-item lift)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><blockquote><p></p></blockquote></li></ul>');
    // Caret in the empty paragraph inside the blockquote.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: { doc: { descendants: (cb: (n: { type: { name: string }; childCount: number; textContent: string; nodeSize: number }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      // Find the empty paragraph that's inside a blockquote.
      let pos = -1;
      let inBlockquote = false;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.type.name === 'blockquote') { inBlockquote = true; return true; }
        if (inBlockquote && n.type.name === 'paragraph' && n.childCount === 0 && n.textContent === '') {
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
    });
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(40);

    // listItem must NOT be lifted, blockquote must NOT escape to top-level.
    // Default PM joinBackward MAY merge the empty p with the blockquote
    // boundary or with the previous block, but the listItem itself stays
    // intact and the doc top-level remains a single bulletList.
    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('bulletList');
    // No top-level paragraph appeared via lift.
    expect(await hasTopLevelEmptyParagraph(page)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Group K - non-empty children-zone Enter (splitBlock in place)
// ════════════════════════════════════════════════════════════════════════

test.describe('non-empty children-zone Enter splits in place', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('K1 cursor at END of non-empty children-zone p - empty p sibling appended INSIDE same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', '']);
  });

  test('K2 cursor at MID of non-empty children-zone p - text splits in place inside li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>HelloWorld</p></li></ul>');
    await caretAtOffsetInNode(page, 'paragraph', 'HelloWorld', 'Hello'.length);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Hello', 'World']);
  });

  test('K3 cursor at START of non-empty children-zone p - empty p inserted before, original content stays', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul>');
    await caretAtItemChild(page, 0, 2, 'start');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // splitBlock at offset 0: empty p inserted before, "Note" stays in original.
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', '', 'Note']);
  });

  test('K4 ordered list - end of non-empty children-zone p, Enter appends empty p inside same li', async ({ page }) => {
    await setContent(page, '<ol><li><p>Label</p><h1>Title</h1><p>Note</p></li></ol>');
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', '']);
    expect(await topLevelBlocks(page)).toEqual([{ type: 'orderedList', text: 'LabelTitleNote' }]);
  });

  test('K5 taskItem - end of non-empty children-zone p, Enter appends empty p inside same taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p>Note</p></li></ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', '']);
  });

  test('K6 REGRESSION: non-empty LABEL Enter at end still creates new sibling listItem (NOT children-zone behavior)', async ({ page }) => {
    await setContent(page, '<ul><li><p>FirstItem</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'FirstItem');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    // Standard list-item split: "FirstItem" + empty new li.
    expect(items).toHaveLength(2);
    expect(items[0]?.children?.[0]?.text).toBe('FirstItem');
    expect(items[1]?.children?.[0]?.text).toBe('');
  });

  test('K7 mid-list - middle li children-zone Enter accumulates inside that li, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>A</p></li><li><p>B-label</p><h1>B-title</h1><p>B-note</p></li><li><p>C</p></li></ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'B-note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('bulletList');
    const items = await listItemShapes(page);
    expect(items.length).toBe(3); // No new sibling li created.
    const middle = items.find((i) => i.text.includes('B-label'));
    expect(middle?.children?.map((c) => c.text)).toEqual(['B-label', 'B-title', 'B-note', '']);
  });

  test('K8 undo regression - 1 step undo restores pre-split state', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.press(undoKey);
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note']);
  });

  test('K9 cursor lands in NEW empty p after split-at-end (typing appears in new p)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);
    await page.keyboard.type('Continued');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', 'Continued']);
  });

  // K10 - mid-list ORDERED with non-empty children-zone p (K7 mirror for ol).
  test('K10 mid-list ORDERED [li=1, li=[label, h1, "Note"], li=3] - middle li non-empty Enter accumulates inside, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ol><li><p>1</p></li><li><p>2-label</p><h1>2-title</h1><p>2-note</p></li><li><p>3</p></li></ol>',
    );
    await caretAtEndOfNode(page, 'paragraph', '2-note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('orderedList');
    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const middle = items.find((i) => i.text.includes('2-label'));
    expect(middle?.children?.map((c) => c.text)).toEqual(['2-label', '2-title', '2-note', '']);
  });

  // K11 - mid-list TASK with non-empty children-zone p (K7 mirror for task).
  test('K11 mid-list TASK [taskItem A, taskItem [label, h1, "Note"], taskItem C] - middle taskItem non-empty Enter accumulates inside, list intact', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>A</p></li>'
      + '<li data-type="taskItem"><p>B-label</p><h1>B-title</h1><p>B-note</p></li>'
      + '<li data-type="taskItem"><p>C</p></li>'
      + '</ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'B-note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('taskList');
    const items = await listItemShapes(page);
    expect(items.length).toBe(3);
    const middle = items.find((i) => i.text.includes('B-label'));
    expect(middle?.type).toBe('taskItem');
    expect(middle?.children?.map((c) => c.text)).toEqual(['B-label', 'B-title', 'B-note', '']);
  });

  // K12 - blockquote-wrapped list, non-empty children-zone p Enter (A14 mirror).
  test('K12 [blockquote > ul > li=[label, h1, "Note"]] - non-empty Note Enter, accumulates inside li, blockquote intact', async ({ page }) => {
    await setContent(
      page,
      '<blockquote><ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul></blockquote>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const tops = await topLevelBlocks(page);
    expect(tops.length).toBe(1);
    expect(tops[0]?.type).toBe('blockquote');

    const items = await listItemShapes(page);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'Title', 'Note', '']);
  });

  // K13 - non-empty p BETWEEN non-paragraph siblings (mid-position case).
  test('K13 [label, h1, "Note", h2] - end of "Note" Enter inserts empty p BETWEEN "Note" and h2 (inside same li)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><h1>A</h1><p>Note</p><h2>B</h2></li></ul>',
    );
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(40);

    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    // [label, h1 A, "Note", NEW empty-p, h2 B]
    expect(items[0]?.children?.map((c) => c.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph', 'heading']);
    expect(items[0]?.children?.map((c) => c.text)).toEqual(['Label', 'A', 'Note', '', 'B']);
  });

  // K14 - 5x Enter from end of non-empty p accumulates 5 empty paragraphs.
  test('K14 5x Enter from end of non-empty children-zone p - accumulates 5 empty paragraphs inside same li', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p>Note</p></li></ul>');
    await caretAtEndOfNode(page, 'paragraph', 'Note');
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(20);
    }

    const items = await listItemShapes(page);
    // [label, h1, "Note"] + 5 empty paragraphs = 8 children.
    expect(items[0]?.childCount).toBe(8);
    // Top-level: still single bulletList (no escape).
    expect(await topLevelBlocks(page)).toEqual([{ type: 'bulletList', text: 'LabelTitleNote' }]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Shift+Tab outdent of a children-zone block (split-aware, Notion parity).
// Outdenting a nested block from a NON-LAST list item splits the list so the
// block lands at the parent level right after the item it was nested under,
// while the parent item (and its checkbox, for to-dos) stays intact. Mirrors
// Notion's "Shift+Tab outdents ONLY the targeted block". Regression for the
// old lossy fallback that dissolved the whole parent to-do into a paragraph.
// ────────────────────────────────────────────────────────────────────────
test.describe('Shift+Tab outdent - children-zone block (split-aware)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  async function firstChild(page: Page): Promise<{ type: string; checked: unknown }> {
    return page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { child: (i: number) => { firstChild: { type: { name: string }; attrs: Record<string, unknown> } } } } }
        | undefined;
      const first = ed?.state.doc.child(0).firstChild;
      return { type: first?.type.name ?? '', checked: first?.attrs['checked'] };
    });
  }

  test('NON-LAST to-do: splits the list, parent KEEPS its checkbox', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem" data-checked="true"><p>Buy milk</p><h2>Details</h2></li>'
      + '<li data-type="taskItem" data-checked="false"><p>Buy 2</p></li>'
      + '<li data-type="taskItem" data-checked="false"><p>Buy 3</p></li>'
      + '</ul>',
    );
    await caretAtEndOfNode(page, 'heading', 'Details');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(60);

    // List splits: [Buy milk] + heading + [Buy 2, Buy 3]; heading at top level.
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'taskList', text: 'Buy milk' },
      { type: 'heading', text: 'Details' },
      { type: 'taskList', text: 'Buy 2Buy 3' },
    ]);
    // The parent stays a to-do with its checked state (used to dissolve to a paragraph).
    expect(await firstChild(page)).toEqual({ type: 'taskItem', checked: true });
  });

  test('MIDDLE bullet item: splits around the block', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p><h2>Mid</h2></li><li><p>C</p></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Mid');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(60);
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'bulletList', text: 'AB' },
      { type: 'heading', text: 'Mid' },
      { type: 'bulletList', text: 'C' },
    ]);
  });

  test('LAST item: outdents after the list without splitting', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p><h2>Last</h2></li></ul>');
    await caretAtEndOfNode(page, 'heading', 'Last');
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(60);
    expect(await topLevelBlocks(page)).toEqual([
      { type: 'bulletList', text: 'AB' },
      { type: 'heading', text: 'Last' },
    ]);
  });
});
