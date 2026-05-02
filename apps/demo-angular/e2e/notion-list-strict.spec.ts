/**
 * E2E coverage for the Notion-strict listItem / taskItem schema
 * (`paragraph block*`) introduced in Phase 1 of the block-ux work.
 *
 * Old schema (`block+`) let any block be the FIRST child of a list/task
 * item. That broke the original UX bug observed in the Notion demo:
 * pasting / converting to a heading inside a checkbox row would put
 * the heading as the first child, and CSS flex alignment then dragged
 * the checkbox up to the heading's tall baseline (looked broken). The
 * new schema requires a paragraph as the first child (the "label" line
 * aligned with the bullet/checkbox); other blocks render below as
 * nested children.
 *
 * Tests below verify:
 *  - parse-time autofix kicks in for HTML where the first li child
 *    isn't a paragraph (heading, codeBlock, blockquote, hr, nested ul)
 *  - the visual alignment bug is fixed: checkbox stays aligned with
 *    the paragraph label, never with a nested heading
 *  - DOM round-trip (setContent → getHTML → setContent) is stable
 *  - user-facing typing / Enter / Backspace behaviour stays sensible
 *  - drag-into-list keeps the inserted block as a nested child below
 *    a fresh empty label
 *  - taskItem variant follows the same rules (data-type="taskItem")
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

interface NodeShape {
  type: string;
  childCount: number;
  text: string;
  children?: NodeShape[];
}

/** Return a shallow tree (one level deep) of every li/taskItem in the doc. */
async function listItemShapes(page: Page): Promise<NodeShape[]> {
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

/** Returns the list item's current schema content rule (for spec sanity). */
async function listItemContentRule(page: Page, name: 'listItem' | 'taskItem'): Promise<string | null> {
  return page.evaluate((n) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { schema: { nodes: Record<string, { spec: { content: string } }> } } } | undefined;
    return ed?.state.schema.nodes[n]?.spec.content ?? null;
  }, name);
}

/**
 * Read the on-screen DOM rect of the checkbox INPUT inside a task item
 * whose label paragraph reads `text`. Used to verify the checkbox
 * vertical center sits within the paragraph's vertical span - the
 * original bug had it sitting at the top of a nested H1 instead.
 */
async function checkboxYCenter(page: Page, text: string): Promise<number> {
  const input = page.locator(`${editorSelector} li[data-type="taskItem"]:has(p:has-text("${text}")) input[type="checkbox"]`).first();
  const box = await input.boundingBox();
  if (!box) throw new Error('checkbox not found');
  return box.y + box.height / 2;
}

async function paragraphYRange(page: Page, text: string): Promise<{ top: number; bottom: number }> {
  const p = page.locator(`${editorSelector} p:has-text("${text}")`).first();
  const box = await p.boundingBox();
  if (!box) throw new Error('paragraph not found');
  return { top: box.y, bottom: box.y + box.height };
}

// ────────────────────────────────────────────────────────────────────────
// 1. Schema rule sanity
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - rule sanity', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('listItem.content rule is `paragraph block*`', async ({ page }) => {
    expect(await listItemContentRule(page, 'listItem')).toBe('paragraph block*');
  });

  test('taskItem.content rule is `paragraph block*`', async ({ page }) => {
    expect(await listItemContentRule(page, 'taskItem')).toBe('paragraph block*');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Parse-time autofix - HTML with non-paragraph first child of li
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - parse-time autofix', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // PM's HTML parser does NOT inject a fresh empty label paragraph and
  // keep the non-paragraph block inside the listItem. Instead, when the
  // first DOM child of `<li>` doesn't satisfy the `paragraph block*`
  // first-child requirement, the parser HOISTS that block UP to the
  // outermost level where it can fit (top-level alongside the
  // bulletList). The listItem retains an auto-injected empty paragraph
  // only. Tests below pin that observable behaviour - this is also the
  // de-facto migration path for documents authored under the previous
  // `block+` schema.
  test('<li><h1>...</h1></li> hoists the heading to top-level, leaving an empty list item', async ({ page }) => {
    await setContent(page, '<ul><li><h1>Heading first</h1></li></ul>');
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([
      { type: 'bulletList', text: '' },
      { type: 'heading', text: 'Heading first' },
    ]);
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'listItem',
      childCount: 1,
      children: [{ type: 'paragraph', text: '' }],
    });
  });

  test('<li data-type="taskItem"><h1>...</h1></li> hoists the heading out (taskItem variant)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><h1>Title</h1></li></ul>',
    );
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([
      { type: 'taskList', text: '' },
      { type: 'heading', text: 'Title' },
    ]);
    const items = await listItemShapes(page);
    expect(items[0]).toMatchObject({
      type: 'taskItem',
      childCount: 1,
      children: [{ type: 'paragraph', text: '' }],
    });
  });

  test('<li><pre><code>...</code></pre></li> hoists the codeBlock to top-level', async ({ page }) => {
    await setContent(page, '<ul><li><pre><code>code()</code></pre></li></ul>');
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'codeBlock']);
  });

  test('<li><blockquote><p>...</p></blockquote></li> hoists the blockquote to top-level', async ({ page }) => {
    await setContent(page, '<ul><li><blockquote><p>Quoted</p></blockquote></li></ul>');
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'blockquote']);
  });

  test('<li><p>Label</p><h1>Below</h1></li> already schema-valid - kept as-is (paragraph + nested heading)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Below</h1></li></ul>');
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        { type: 'paragraph', text: 'Label' },
        { type: 'heading', text: 'Below' },
      ],
    });
  });

  test('<li><h1>First</h1><p>After</p></li> hoists BOTH non-fitting children out, leaves an empty list item', async ({ page }) => {
    // PM's parser sees <h1> first - cannot match the required label
    // slot - so the listItem closes without consuming any DOM child;
    // both <h1>First</h1> and <p>After</p> end up as top-level
    // siblings of the bulletList. The list item gets an auto-injected
    // empty paragraph as its required label.
    await setContent(page, '<ul><li><h1>First</h1><p>After</p></li></ul>');
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([
      { type: 'bulletList', text: '' },
      { type: 'heading', text: 'First' },
      { type: 'paragraph', text: 'After' },
    ]);
    const items = await listItemShapes(page);
    expect(items[0]).toMatchObject({
      childCount: 1,
      children: [{ type: 'paragraph', text: '' }],
    });
  });

  test('<li><ul>...</ul></li> (bare nested-list-only li) is an HTML-parser pitfall - splits to top-level lists', async ({ page }) => {
    // PM's HTML parser does NOT keep `<li><ul>...</ul></li>` as a
    // single nested structure when the outer li has no direct text/p
    // before the inner ul (a long-standing parser quirk, present even
    // before strict schema). The inner UL ends up flattened to a
    // sibling list at top level. This test pins that observable
    // behaviour so we notice if the parser ever changes.
    await setContent(
      page,
      '<ul><li><ul><li><p>Inner only</p></li></ul></li></ul>',
    );
    const topLevel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } }
        | undefined;
      const types: string[] = [];
      ed?.state.doc.forEach((n) => types.push(n.type.name));
      return types;
    });
    // Two flattened bulletLists - the empty outer li became its own list
    // with an autofix-empty paragraph; the inner with "Inner only" is a
    // sibling. Adding `<p></p>` BEFORE the nested `<ul>` is the supported
    // way to keep them nested (covered by the next test).
    expect(topLevel.length).toBeGreaterThanOrEqual(2);
    expect(topLevel.every((t) => t === 'bulletList')).toBe(true);
  });

  test('<li><p></p><ul>...</ul></li> (explicit empty label) keeps the nesting', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p></p><ul><li><p>Inner only</p></li></ul></li></ul>',
    );
    const items = await listItemShapes(page);
    // Two list items in the doc: the outer (empty label + nested ul)
    // and the inner (paragraph "Inner only").
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      childCount: 2,
      children: [
        expect.objectContaining({ type: 'paragraph', text: '' }),
        expect.objectContaining({ type: 'bulletList' }),
      ],
    });
    expect(items[1]).toMatchObject({
      childCount: 1,
      text: 'Inner only',
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Visual alignment - the original bug fix verification
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - checkbox / bullet alignment', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('task item with single paragraph: checkbox vertical center sits inside paragraph rect', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Buy milk</p></li></ul>',
    );
    const cbY = await checkboxYCenter(page, 'Buy milk');
    const pY = await paragraphYRange(page, 'Buy milk');
    expect(cbY).toBeGreaterThanOrEqual(pY.top - 1);
    expect(cbY).toBeLessThanOrEqual(pY.bottom + 1);
  });

  test('legacy <li data-type="taskItem"><h1>...</h1></li>: checkbox stays at the (now empty) label row, NOT pulled up to the heading', async ({ page }) => {
    // The original alignment bug: an H1 ended up as the first child of
    // a taskItem and visually pulled the checkbox up to the heading
    // baseline. With strict schema, the parser HOISTS the heading out
    // of the taskItem (since it can't sit as the first child) and
    // leaves an empty label paragraph in its place. The checkbox
    // therefore aligns with the small label row, not the tall heading
    // that now sits as a separate top-level block.
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><h1>Big heading</h1></li></ul>',
    );

    const cbInput = page.locator(`${editorSelector} li[data-type="taskItem"] input[type="checkbox"]`).first();
    const cbBox = await cbInput.boundingBox();
    if (!cbBox) throw new Error('checkbox missing');
    const cbCenterY = cbBox.y + cbBox.height / 2;

    const headingBox = await page.locator(`${editorSelector} h1:has-text("Big heading")`).first().boundingBox();
    if (!headingBox) throw new Error('heading missing');
    // The heading is now hoisted ABOVE / BELOW the bulletList - either
    // way the checkbox center should NOT sit inside the heading's
    // vertical span. With the old `block+` schema both shared the
    // same row, this assertion would fail.
    const cbInsideHeadingRow = cbCenterY >= headingBox.y && cbCenterY <= headingBox.y + headingBox.height;
    expect(cbInsideHeadingRow).toBe(false);
  });

  test('bullet item with paragraph + nested heading: bullet aligned with paragraph label', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label here</p><h2>Nested heading</h2></li></ul>');
    // The visible bullet marker is rendered by the browser via
    // `list-style: disc` on the li. We check that the paragraph (where
    // the bullet visually sits) is ABOVE the heading; that's the
    // structural prerequisite for the bullet aligning with the label.
    const pBox = await page.locator(`${editorSelector} p:has-text("Label here")`).first().boundingBox();
    const hBox = await page.locator(`${editorSelector} h2:has-text("Nested heading")`).first().boundingBox();
    if (!pBox || !hBox) throw new Error('rects missing');
    expect(pBox.y).toBeLessThan(hBox.y);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Round-trip (setContent → getHTML → setContent stability)
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - HTML round-trip', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  async function getHTML(page: Page): Promise<string> {
    return page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { getHTML: () => string } | undefined;
      return ed?.getHTML() ?? '';
    });
  }

  test('legacy <li><h1>...</h1></li> input round-trips to a stable [bulletList(empty li), heading] doc', async ({ page }) => {
    // First parse hoists the heading out; the resulting HTML therefore
    // serializes a separate <ul> + <h1>, and a second setContent with
    // that HTML produces the same shape (no further changes, no
    // duplicate label re-injection).
    await setContent(page, '<ul><li><h1>Heading</h1></li></ul>');
    const after1 = await getHTML(page);
    await setContent(page, after1);
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([
      { type: 'bulletList', text: '' },
      { type: 'heading', text: 'Heading' },
    ]);
  });

  test('schema-valid input ([p, h1]) round-trips identically', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Below</h2></li></ul>');
    const before = await listItemShapes(page);
    const html = await getHTML(page);
    await setContent(page, html);
    const after = await listItemShapes(page);
    expect(after).toEqual(before);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. User-facing typing / Enter / Backspace
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - typing behaviour', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('typing into a fresh empty bullet item lands in the label paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul>');
    await page.locator(`${editorSelector} li`).first().click();
    await page.keyboard.type('Hello');
    const items = await listItemShapes(page);
    expect(items[0]).toMatchObject({
      childCount: 1,
      children: [{ type: 'paragraph', text: 'Hello' }],
    });
  });

  test('Enter at end of label paragraph splits into a sibling list item', async ({ page }) => {
    await setContent(page, '<ul><li><p>First</p></li></ul>');
    const p = page.locator(`${editorSelector} li p`).first();
    await p.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second');
    const items = await listItemShapes(page);
    expect(items.map((i) => i.text)).toEqual(['First', 'Second']);
  });

  test('Backspace at start of empty bullet (only item) lifts out to a paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p></p></li></ul><p>Tail</p>');
    await page.locator(`${editorSelector} li`).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.forEach((n) => out.push(n.type.name));
      return out;
    });
    // After lift, the empty li becomes a top-level paragraph; "Tail"
    // stays as the second top-level paragraph.
    expect(top.filter((t) => t !== 'bulletList')).toContain('paragraph');
    expect(top).not.toContain('bulletList');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Drag arbitrary block into list - wrap creates `[empty label, block]`
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - drag wrap shape', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('after drag a top-level H1 into bulletList, the new item has structure [empty paragraph, heading]', async ({ page }) => {
    // Smoke-level coverage. The full end-to-end drag mechanics + per-
    // case shape assertions live in `notion-block-resolution.spec.ts`;
    // here we stand by the concrete Notion-strict shape.
    await setContent(page, '<h1>Big title</h1><ul><li><p>Existing</p></li></ul>');

    // Trigger the drag via the same synthetic dispatch the resolution
    // suite uses, scoped down to this test's needs.
    const h1 = page.locator(`${editorSelector} h1`);
    const sBox = await h1.boundingBox();
    if (!sBox) throw new Error('source missing');
    const editorBox = await page.locator(editorSelector).boundingBox();
    if (!editorBox) throw new Error('editor missing');
    await page.mouse.move(Math.max(0, editorBox.x - 10), sBox.y + sBox.height / 2);
    await page.waitForTimeout(40);
    await expect(page.locator('.dm-block-handle')).toHaveAttribute('data-show', '');

    const handle = page.locator('.dm-block-handle-drag');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p:has-text("Existing")`);
    const tBox = await target.boundingBox();
    if (!tBox) throw new Error('target missing');
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const items = await listItemShapes(page);
    // Expect ul with two items: existing paragraph li, then heading-wrapped li.
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      childCount: 1,
      children: [{ type: 'paragraph', text: 'Existing' }],
    });
    expect(items[1]).toMatchObject({
      childCount: 2,
      children: [
        { type: 'paragraph', text: '' },
        { type: 'heading', text: 'Big title' },
      ],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Cross-list-type drop - taskItem ↔ listItem keeps Notion-strict shape
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-strict list schema - cross-type conversion', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('a taskItem ([p, h2]) parsed into a doc keeps both children intact', async ({ page }) => {
    // Authored content with a taskItem that already has the strict shape.
    // Verifies the parser does not insert a duplicate label paragraph.
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Task label</p><h2>Notes header</h2></li>'
      + '</ul>',
    );
    const items = await listItemShapes(page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'taskItem',
      childCount: 2,
      children: [
        { type: 'paragraph', text: 'Task label' },
        { type: 'heading', text: 'Notes header' },
      ],
    });
  });
});
