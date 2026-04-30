/**
 * E2E coverage for the BlockHandle resolution pipeline:
 *
 * 1. **Side gutter hover** (commit `da291e6`) — the hover listener lives on
 *    `.dm-editor`'s parent so the handle surfaces when the cursor sits in
 *    the page margin where the icons visually live, not just over the
 *    text column.
 *
 * 2. **Scoring-based resolution** (current branch) — `clampToContent`
 *    keeps `posAtCoords` honest when cursor is in the gutter / above /
 *    below blocks; `findBestDragTarget` walks ancestors and tie-breaks
 *    by deepest depth; `handleDrop` reuses the same resolver so the drop
 *    target equals the hover target.
 *
 * Tiptap-style edge promotion (`promoteOnEdge: 'left'/'right'/...`) is
 * exercised in unit tests (`findBestDragTarget.test.ts`); the demo
 * itself is locked into Notion mode, so e2e here focuses on
 * Notion-style resolution + drop consistency + edge cases.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';

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

async function getBlocks(page: Page): Promise<Array<{ type: string; text: string; attrs: Record<string, unknown> }>> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    const out: Array<{ type: string; text: string; attrs: Record<string, unknown> }> = [];
    ed?.state.doc.forEach((n) => { out.push({ type: n.type.name, text: n.textContent, attrs: n.attrs }); });
    return out;
  });
}

/**
 * Move the mouse to (x, y) in the viewport AND fire `mousemove` on the
 * page so our hover listener (on `.dm-editor`'s parent) catches it.
 * `page.mouse.move` alone doesn't always reach our listener if no element
 * is under cursor at exactly that point in headless layout.
 */
async function hoverAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  // Force a tick so the rAF in the hover handler fires.
  await page.waitForTimeout(40);
}

/**
 * Returns the bounding box of a block by its visible text via Playwright.
 * Asserts the box exists and returns it (caller can drop the null check).
 */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a bounding box').not.toBeNull();
  if (!box) throw new Error('unreachable');
  return box;
}

/**
 * X coordinate that sits in the LEFT SIDE GUTTER — to the left of the
 * `.dm-editor`'s content column but still inside `<app-notion-demo>`'s
 * width (where the BlockHandle hover listener lives). Picking 10px to
 * the left of the editor box guarantees we're in the gutter without
 * leaving the listener's catchment area.
 */
async function sideGutterX(page: Page): Promise<number> {
  const editorBox = await boxOf(page.locator(editorSelector));
  return Math.max(0, editorBox.x - 10);
}

/**
 * Read what block PM thinks is currently hovered (via plugin state).
 * Robust regardless of where the handle is rendered visually.
 */
async function hoveredPos(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          view: {
            state: {
              plugins: Array<{
                spec?: { key?: { key?: string } };
                getState: (s: unknown) => { hoveredPos?: number | null } | undefined;
              }>;
            };
          };
        }
      | undefined;
    if (!ed) return null;
    const plugin = ed.view.state.plugins.find((p) =>
      typeof p.spec?.key?.key === 'string' && p.spec.key.key.startsWith('blockHandle$'),
    );
    if (!plugin) return null;
    const s = plugin.getState(ed.view.state as unknown);
    return s?.hoveredPos ?? null;
  });
}

/** Returns the block at `pos` (PM nodeAt) — type + text. */
async function blockAt(page: Page, pos: number): Promise<{ type: string; text: string } | null> {
  return page.evaluate((p) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { nodeAt: (p: number) => { type: { name: string }; textContent: string } | null } } }
      | undefined;
    const node = ed?.state.doc.nodeAt(p) ?? null;
    return node ? { type: node.type.name, text: node.textContent } : null;
  }, pos);
}

// ────────────────────────────────────────────────────────────────────────
// 1. Side gutter hover — handle surfaces in the page margin
// ────────────────────────────────────────────────────────────────────────

test.describe('Side gutter hover', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hover left of editor at paragraph Y → handle shows for that paragraph', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const para = page.locator(`${editorSelector} p:has-text("Bravo")`);
    const pBox = await boxOf(para);

    // Cursor X=20 is well to the LEFT of `.dm-editor` (which sits inside
    // a centered, padded `.notion-page`).
    await hoverAt(page, await sideGutterX(page), pBox.y + pBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect(pos).not.toBeNull();
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.text).toBe('Bravo');
  });

  test('hover left of editor at heading Y → handle shows for heading', async ({ page }) => {
    await setContent(page, '<h2>Title</h2><p>Body</p>');
    const heading = page.locator(`${editorSelector} h2`);
    const hBox = await boxOf(heading);

    await hoverAt(page, await sideGutterX(page), hBox.y + hBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('heading');
  });

  test('hover left of editor at list-item Y → handle shows for that list item, not the whole list', async ({ page }) => {
    await setContent(page, '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>');
    const li = page.locator(`${editorSelector} li`).nth(1);
    const liBox = await boxOf(li);

    await hoverAt(page, await sideGutterX(page), liBox.y + liBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('listItem');
    expect(block?.text).toBe('Second');
  });

  test('mouse moving from text into the side gutter keeps the same target', async ({ page }) => {
    await setContent(page, '<p>The quick brown fox</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    // Start over the text.
    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    const overText = await hoveredPos(page);
    expect(overText).not.toBeNull();

    // Slide left into the side gutter at the same Y.
    await hoverAt(page, await sideGutterX(page), pBox.y + pBox.height / 2);
    const inGutter = await hoveredPos(page);
    expect(inGutter).toBe(overText);
  });

  test('mouse moving across blocks via side gutter updates target as Y crosses block boundaries', async ({ page }) => {
    await setContent(page, '<p>Top</p><p>Middle</p><p>Bottom</p>');
    const top = page.locator(`${editorSelector} p:has-text("Top")`);
    const middle = page.locator(`${editorSelector} p:has-text("Middle")`);
    const bottom = page.locator(`${editorSelector} p:has-text("Bottom")`);
    const tBox = await boxOf(top);
    const mBox = await boxOf(middle);
    const bBox = await boxOf(bottom);

    // Hover gutter at top block's Y.
    await hoverAt(page, await sideGutterX(page), tBox.y + tBox.height / 2);
    const posTop = await hoveredPos(page);
    expect(posTop).not.toBeNull();
    expect((await blockAt(page, posTop ?? 0))?.text).toBe('Top');

    // Slide down to middle block's Y.
    await hoverAt(page, await sideGutterX(page), mBox.y + mBox.height / 2);
    const posMid = await hoveredPos(page);
    expect((await blockAt(page, posMid ?? 0))?.text).toBe('Middle');

    // Continue to bottom.
    await hoverAt(page, await sideGutterX(page), bBox.y + bBox.height / 2);
    const posBot = await hoveredPos(page);
    expect((await blockAt(page, posBot ?? 0))?.text).toBe('Bottom');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Vertical clamp — hover above first / below last
// ────────────────────────────────────────────────────────────────────────

test.describe('Vertical clamp around the doc bounds', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hover above first block (still inside notion-page) anchors handle to first block', async ({ page }) => {
    await setContent(page, '<p>FirstBlock</p><p>SecondBlock</p>');
    const first = page.locator(`${editorSelector} p:has-text("FirstBlock")`);
    const fBox = await boxOf(first);

    // Cursor 20px ABOVE the first block (still inside the page).
    await hoverAt(page, fBox.x + fBox.width / 2, fBox.y - 20);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('FirstBlock');
  });

  test('hover below last block (still inside notion-page) anchors handle to last block', async ({ page }) => {
    await setContent(page, '<p>FirstBlock</p><p>LastBlock</p>');
    const last = page.locator(`${editorSelector} p:has-text("LastBlock")`);
    const lBox = await boxOf(last);

    // 20px BELOW the last block, but still within the editor's vertical
    // hover area (`.notion-page` extends with padding/margin past content).
    await hoverAt(page, lBox.x + lBox.width / 2, lBox.y + lBox.height + 20);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('LastBlock');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Notion-mode resolution invariants — deepest list item wins
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-mode block resolution', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hover over text of a list item resolves to the list item, not the paragraph inside', async ({ page }) => {
    await setContent(page, '<ul><li><p>Hello world</p></li></ul>');
    const li = page.locator(`${editorSelector} li`);
    const liBox = await boxOf(li);

    // Hover squarely on the text — both `<p>` and `<li>` are under the
    // cursor; the resolver must pick the `<li>` (allowedNodes contains
    // `listItem` but not `paragraph`).
    await hoverAt(page, liBox.x + liBox.width / 2, liBox.y + liBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });

  test('hover over a top-level paragraph (not in allowedNodes) falls back to top-level paragraph', async ({ page }) => {
    await setContent(page, '<p>Standalone</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('paragraph');
  });

  test('hover over blockquote (paragraph inside blockquote) resolves to blockquote at top level', async ({ page }) => {
    await setContent(page, '<blockquote><p>Quoted text</p></blockquote>');
    const bq = page.locator(`${editorSelector} blockquote`);
    const bBox = await boxOf(bq);

    await hoverAt(page, bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });

  test('hover over heading resolves to heading', async ({ page }) => {
    await setContent(page, '<h3>Section</h3>');
    const h = page.locator(`${editorSelector} h3`);
    const hBox = await boxOf(h);

    await hoverAt(page, hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('list with two items: hovering each resolves to its own listItem', async ({ page }) => {
    await setContent(page, '<ul><li><p>Apple</p></li><li><p>Banana</p></li></ul>');
    const items = page.locator(`${editorSelector} li`);
    const firstBox = await boxOf(items.nth(0));
    const secondBox = await boxOf(items.nth(1));

    await hoverAt(page, firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    let pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('Apple');

    await hoverAt(page, secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
    pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('Banana');
  });

  test('empty single paragraph still surfaces a handle', async ({ page }) => {
    await setContent(page, '<p></p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    // Empty paragraph has tiny height; aim for top-left corner.
    await hoverAt(page, pBox.x + 10, pBox.y + 5);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('paragraph');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. handleDrop reuses the same resolver — drop target equals hover target
// ────────────────────────────────────────────────────────────────────────

test.describe('Drop position consistency with hover', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drop near left edge of editor (X clamped) still moves the dragged block', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');

    const alpha = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await alpha.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const bravo = page.locator(`${editorSelector} p:has-text("Bravo")`);
    const bBox = await boxOf(bravo);

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Drop X ~5px inside the left edge of the content rect — exercises
    // the edge of `clampToContent`'s clamp without going outside PM's
    // own drop-handler bounds (PM's drop pipeline ignores events whose
    // clientX is wholly outside `view.dom`'s rect).
    const dropY = bBox.y + bBox.height * 0.8;
    const dropX = bBox.x + 5;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('drop on top half of a block inserts BEFORE; bottom half inserts AFTER (mirrors dropcursor)', async ({ page }) => {
    await setContent(page, '<p>One</p><p>Two</p><p>Three</p>');

    // Drag One onto top-half of Three → expect ['Two', 'One', 'Three'].
    const one = page.locator(`${editorSelector} p:has-text("One")`);
    await one.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const three = page.locator(`${editorSelector} p:has-text("Three")`);
    const tBox = await boxOf(three);

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const dropY = tBox.y + tBox.height * 0.2; // top half
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: tBox.x + tBox.width / 2, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: tBox.x + tBox.width / 2, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Two', 'One', 'Three']);
  });

  test('drop on a list item from side-gutter X reorders within the list (not promotion to top-level)', async ({ page }) => {
    await setContent(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    const itemA = page.locator(`${editorSelector} li`).nth(0);
    await itemA.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());

    const itemC = page.locator(`${editorSelector} li`).nth(2);
    const cBox = await boxOf(itemC);

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Drop near the left edge of C's row — exercises the clamp without
    // going outside PM's own drop-handler bounds.
    const dropX = cBox.x + 5;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: cBox.y + cBox.height * 0.8,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: cBox.y + cBox.height * 0.8,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // List should still be one <ul> with the items reordered.
    const lists = await page.locator(`${editorSelector} ul`).count();
    expect(lists).toBe(1);
    const texts = (await page.locator(`${editorSelector} li`).allTextContents()).map((t) => t.trim());
    expect(texts).toEqual(['B', 'C', 'A']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Edge cases that exercise the new resolver
// ────────────────────────────────────────────────────────────────────────

test.describe('Resolver edge cases', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hover at the leftmost edge of the side gutter still resolves the block', async ({ page }) => {
    await setContent(page, '<p>Edge content</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    // The hover listener lives on `.dm-editor`'s parent (`<app-notion-demo>`)
    // — so the leftmost practical X is just inside that container. Hovering
    // outside the parent box reasonably stops surfacing the handle (the
    // listener can't see those mousemoves).
    const x = await sideGutterX(page);
    await hoverAt(page, x, pBox.y + pBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('Edge content');
  });

  test('hover transitions: text → above first → text again resolves consistently', async ({ page }) => {
    await setContent(page, '<p>OnlyOne</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    const a = await hoveredPos(page);

    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y - 30);
    const b = await hoveredPos(page);

    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    const c = await hoveredPos(page);

    expect(a).not.toBeNull();
    expect(b).toBe(a); // clamp keeps target on the only block
    expect(c).toBe(a);
  });

  test('block handle is hidden when the mouse leaves the entire page', async ({ page }) => {
    await setContent(page, '<p>Keep me</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);
    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    // Move mouse far above the demo header, into the empty body area.
    await page.mouse.move(0, 0);
    // The hide is debounced (`hideDelay: 200`). Wait it out.
    await page.waitForTimeout(400);
    await expect(page.locator(blockHandleSelector)).not.toHaveAttribute('data-show', '');
  });

  test('multiple list types adjacent: bullet then ordered then task — each item resolves individually', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet item</p></li></ul>'
      + '<ol><li><p>Numbered item</p></li></ol>'
      + '<ul data-type="taskList"><li data-checked="false"><p>Task item</p></li></ul>',
    );
    const lis = page.locator(`${editorSelector} li`);
    const a = await boxOf(lis.nth(0));
    const b = await boxOf(lis.nth(1));
    const c = await boxOf(lis.nth(2));

    await hoverAt(page, a.x + a.width / 2, a.y + a.height / 2);
    expect((await blockAt(page, (await hoveredPos(page)) ?? 0))?.text).toBe('Bullet item');

    await hoverAt(page, b.x + b.width / 2, b.y + b.height / 2);
    expect((await blockAt(page, (await hoveredPos(page)) ?? 0))?.text).toBe('Numbered item');

    await hoverAt(page, c.x + c.width / 2, c.y + c.height / 2);
    expect((await blockAt(page, (await hoveredPos(page)) ?? 0))?.text).toBe('Task item');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Nested list-in-list resolution — Notion-style spatial Y-walk
// ────────────────────────────────────────────────────────────────────────
//
// Regression coverage for the bug where hovering in the gutter at an
// inner nested-list-item's Y row resolved to the OUTER list item (because
// `posAtCoords` on the gutter-clamped X landed inside the outer's content
// area, before the inner's left indent). The fix replaces `posAtCoords +
// findDraggableBlock` with `findDeepestBlockAtY`, which ignores X and
// picks the smallest (innermost) block whose vertical rect contains the
// cursor's Y.

test.describe('Nested list-in-list resolution', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    // Notion demo's default content already has top-of-page H1 etc — make
    // the inner blocks land in viewport with a tall window for these
    // tests. Other suites use the default 1280x720 viewport.
    await page.setViewportSize({ width: 1280, height: 1500 });
  });

  /**
   * Resolves the block currently anchoring the handle by its text content,
   * via plugin state. Returns null if no block is hovered.
   */
  async function hoveredBlock(page: Page): Promise<{ type: string; text: string } | null> {
    const pos = await hoveredPos(page);
    return pos !== null ? blockAt(page, pos) : null;
  }

  test('gutter hover at INNER item Y resolves to the INNER list item, not outer', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Inner A</p></li><li><p>Inner B</p></li></ul>'
      + '</li></ul>',
    );

    // Use the inner paragraph as the Y anchor — `li:has-text("Inner A")`
    // would match the outer LI too because its textContent includes
    // descendants. The P's Y center is inside the inner LI's rect.
    const innerAP = page.locator(`${editorSelector} p`, { hasText: 'Inner A' });
    const aBox = await boxOf(innerAP);

    // Cursor in the SIDE GUTTER (left of `.dm-editor`), Y aligned with
    // Inner A's row. This was the failing case.
    await hoverAt(page, await sideGutterX(page), aBox.y + aBox.height / 2);
    const block = await hoveredBlock(page);
    expect(block?.type).toBe('listItem');
    expect(block?.text).toBe('Inner A');
  });

  test('hover just inside editor left edge at INNER Y still resolves to INNER', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Inner A</p></li></ul>'
      + '</li></ul>',
    );

    const editorBox = await boxOf(page.locator(editorSelector));
    // Locate the INNER paragraph specifically — `li:has-text("Inner A")`
    // would match the outer LI too (textContent includes descendants).
    // The paragraph's Y center sits inside the inner LI's rect.
    const innerP = page.locator(`${editorSelector} p`, { hasText: 'Inner A' });
    const aBox = await boxOf(innerP);

    // X = editor's left edge + 5px (still left of the inner item's text
    // due to outer + inner indentation). Pre-fix this would have resolved
    // to the OUTER li because `posAtCoords` would land at the outer's
    // left-padded content area.
    await hoverAt(page, editorBox.x + 5, aBox.y + aBox.height / 2);
    const block = await hoveredBlock(page);
    expect(block?.type).toBe('listItem');
    expect(block?.text).toBe('Inner A');
  });

  test('hover at OUTER paragraph row (above nested list) resolves to OUTER', async ({ page }) => {
    // The outer list-item's paragraph row sits ABOVE the nested list. At
    // that Y, only the outer rect contains the cursor — inner items are
    // below — so outer wins by being the only allowed match.
    await setContent(
      page,
      '<ul><li><p>Outer paragraph text</p>'
      + '<ul><li><p>Inner</p></li></ul>'
      + '</li></ul>',
    );

    const outerPara = page.locator(`${editorSelector} li > p`, { hasText: 'Outer paragraph text' }).first();
    const oBox = await boxOf(outerPara);

    await hoverAt(page, await sideGutterX(page), oBox.y + oBox.height / 2);
    const block = await hoveredBlock(page);
    expect(block?.type).toBe('listItem');
    expect(block?.text).toContain('Outer paragraph text');
    // Sanity: the outer's text contains its inner's text ("Inner") too,
    // so a strict equality would fail; substring is the correct check.
    expect(block?.text).toContain('Inner');
  });

  test('three-level nesting: gutter hover at deepest item Y resolves to deepest item', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>L1</p>'
      + '<ul><li><p>L2</p>'
      + '<ul><li><p>L3 deepest</p></li></ul>'
      + '</li></ul>'
      + '</li></ul>',
    );

    // Anchor on the L3 paragraph's rect — every ancestor LI's
    // textContent includes "L3 deepest" so `li:has-text(...)` would
    // match all three.
    const l3P = page.locator(`${editorSelector} p`, { hasText: 'L3 deepest' });
    const l3Box = await boxOf(l3P);

    await hoverAt(page, await sideGutterX(page), l3Box.y + l3Box.height / 2);
    const block = await hoveredBlock(page);
    expect(block?.type).toBe('listItem');
    expect(block?.text).toBe('L3 deepest');
  });

  test('drop from gutter X onto inner item Y reorders inner items, leaves outer intact', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul>'
      + '<li><p>First inner</p></li>'
      + '<li><p>Second inner</p></li>'
      + '<li><p>Third inner</p></li>'
      + '</ul>'
      + '</li></ul>',
    );

    // Hover the FIRST inner item via the gutter to set the drag source.
    // Use the paragraph locator — outer LI's textContent contains all
    // three inner texts, so `li:has-text("First inner")` would match
    // the outer LI by mistake.
    const firstInnerP = page.locator(`${editorSelector} p`, { hasText: 'First inner' });
    const fBox = await boxOf(firstInnerP);
    await hoverAt(page, await sideGutterX(page), fBox.y + fBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    // Sanity: hover resolved to first inner.
    const sourceBlock = await hoveredBlock(page);
    expect(sourceBlock?.text).toBe('First inner');

    // Synthetic HTML5 drag — Playwright's `mouse.down/move/up` doesn't
    // emit native dragstart/drop events in headless Chromium, so we
    // dispatch the events explicitly (same pattern as the earlier
    // "drop on a list item from side-gutter X" test).
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());

    const thirdInnerP = page.locator(`${editorSelector} p`, { hasText: 'Third inner' });
    const tBox = await boxOf(thirdInnerP);

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Wait for the deferred PM dispatch (setTimeout(0) in onDragStart)
    // to land its `setSelection + setMeta(draggedFrom)` transaction.
    await page.waitForTimeout(20);

    // Drop in the bottom half of the third inner's row (X clamped just
    // inside `.ProseMirror`'s left edge to stay within PM's drop bounds).
    const dropX = tBox.x + 5;
    const dropY = tBox.y + tBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // Outer list intact (single top-level bulletList still wraps everything).
    const blocks = await getBlocks(page);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe('bulletList');

    // Inner items reordered to [Second, Third, First] — pre-fix the
    // drop would have promoted "First inner" to a sibling of "Outer"
    // because the resolver returned outer for the gutter hover.
    const innerTexts = (await page
      .locator(`${editorSelector} li li p`)
      .allTextContents()).map((t) => t.trim());
    expect(innerTexts).toEqual(['Second inner', 'Third inner', 'First inner']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Empty-wrapper cleanup on drag — single-child wrappers must not leak
// ────────────────────────────────────────────────────────────────────────
//
// Regression coverage for the bug where dragging the ONLY listItem out
// of a nested list left an empty `<li>` placeholder behind. PM's schema
// fitter retains it to satisfy `bulletList → listItem+`. Fix lives in
// `moveBlock` (expand the delete range outward through single-child
// containers).

test.describe('Empty-wrapper cleanup on drag', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    await page.setViewportSize({ width: 1280, height: 1500 });
  });

  /** Counts list items / task items whose textContent is empty. */
  async function countEmptyListItems(page: Page): Promise<number> {
    return page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }) => boolean | void) => void } } }
        | undefined;
      let n = 0;
      ed?.state.doc.descendants((node) => {
        if (
          (node.type.name === 'listItem' || node.type.name === 'taskItem')
          && node.textContent === ''
        ) n++;
        return true;
      });
      return n;
    });
  }

  /** Synthetic drag from the currently-shown handle to a drop target row. */
  async function dragHandleTo(page: Page, dropX: number, dropY: number): Promise<void> {
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Allow the deferred PM dispatch (setTimeout(0) in onDragStart) to land.
    await page.waitForTimeout(20);
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();
  }

  test('drag the ONLY listItem out of a nested ul → outer LI keeps just its paragraph, no empty <li> ghost', async ({ page }) => {
    await setContent(
      page,
      '<ul>'
      + '<li><p>Outer</p>'
      + '<ul><li><p>Solo inner</p></li></ul>'
      + '</li>'
      + '</ul>'
      + '<p>Tail</p>',
    );

    const innerP = page.locator(`${editorSelector} p`, { hasText: 'Solo inner' });
    const iBox = await boxOf(innerP);
    await hoverAt(page, await sideGutterX(page), iBox.y + iBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const tailP = page.locator(`${editorSelector} p`, { hasText: 'Tail' });
    const tBox = await boxOf(tailP);
    await dragHandleTo(page, tBox.x + 5, tBox.y + tBox.height * 0.8);

    // No empty list-item placeholders survived.
    expect(await countEmptyListItems(page)).toBe(0);

    // Outer LI now has ONLY its paragraph (no nested empty UL).
    const outerLiInfo = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string; childCount: number; firstChild: { type: { name: string } } | null }) => boolean | void) => void } } }
        | undefined;
      let info: { childCount: number; firstChildType: string | undefined } | null = null;
      ed?.state.doc.descendants((node) => {
        if (info !== null) return false;
        if (node.type.name === 'listItem' && node.textContent === 'Outer') {
          info = { childCount: node.childCount, firstChildType: node.firstChild?.type.name };
          return false;
        }
        return true;
      });
      return info;
    });
    expect(outerLiInfo).toEqual({ childCount: 1, firstChildType: 'paragraph' });

    // Dragged item's text survives somewhere in the doc.
    expect((await page.locator(editorSelector).textContent()) ?? '').toContain('Solo inner');
  });

  test('drag the ONLY taskItem out of a nested taskList → no empty taskItem ghost', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Outer task</p>'
      + '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Lone subtask</p></li>'
      + '</ul>'
      + '</li>'
      + '</ul>'
      + '<p>Tail</p>',
    );

    const innerP = page.locator(`${editorSelector} p`, { hasText: 'Lone subtask' });
    const iBox = await boxOf(innerP);
    await hoverAt(page, await sideGutterX(page), iBox.y + iBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const tailP = page.locator(`${editorSelector} p`, { hasText: 'Tail' });
    const tBox = await boxOf(tailP);
    await dragHandleTo(page, tBox.x + 5, tBox.y + tBox.height * 0.8);

    expect(await countEmptyListItems(page)).toBe(0);
    expect((await page.locator(editorSelector).textContent()) ?? '').toContain('Lone subtask');
  });

  test('drag a sibling-having inner item → wrapper UL stays, sibling stays', async ({ page }) => {
    // Regression check: when the source has a sibling, the wrapper UL
    // must NOT be expanded into the deletion (the sibling still needs it).
    await setContent(
      page,
      '<ul>'
      + '<li><p>Outer</p>'
      + '<ul>'
      + '<li><p>First inner</p></li>'
      + '<li><p>Second inner</p></li>'
      + '</ul>'
      + '</li>'
      + '</ul>'
      + '<p>Tail</p>',
    );

    const firstP = page.locator(`${editorSelector} p`, { hasText: 'First inner' });
    const fBox = await boxOf(firstP);
    await hoverAt(page, await sideGutterX(page), fBox.y + fBox.height / 2);

    const tailP = page.locator(`${editorSelector} p`, { hasText: 'Tail' });
    const tBox = await boxOf(tailP);
    await dragHandleTo(page, tBox.x + 5, tBox.y + tBox.height * 0.8);

    // Outer LI still wraps a nested UL containing only "Second inner".
    const innerTexts = (await page.locator(`${editorSelector} li li p`).allTextContents())
      .map((t) => t.trim());
    expect(innerTexts).toEqual(['Second inner']);
    expect(await countEmptyListItems(page)).toBe(0);
  });

  test('drag the ONLY listItem of a TOP-level UL → top-level UL is removed', async ({ page }) => {
    // Source LI is the only child of a top-level UL (not nested). Moving
    // it out should remove the wrapping UL entirely from top level —
    // pre-fix would leave an empty <ul><li></li></ul>.
    await setContent(
      page,
      '<ul><li><p>Solo top</p></li></ul>'
      + '<p>Tail</p>',
    );

    const soloP = page.locator(`${editorSelector} p`, { hasText: 'Solo top' });
    const sBox = await boxOf(soloP);
    await hoverAt(page, await sideGutterX(page), sBox.y + sBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const tailP = page.locator(`${editorSelector} p`, { hasText: 'Tail' });
    const tBox = await boxOf(tailP);
    await dragHandleTo(page, tBox.x + 5, tBox.y + tBox.height * 0.8);

    expect(await countEmptyListItems(page)).toBe(0);
    expect((await page.locator(editorSelector).textContent()) ?? '').toContain('Solo top');
  });

  test('keyboard reorder (Mod-Shift-Down) on the ONLY inner item also cleans up the wrapper', async ({ page }) => {
    // KeyboardReorder uses the same `moveBlock`, so the fix applies
    // here too. Guards against regressions if either path stops
    // routing through the shared helper.
    await setContent(
      page,
      '<ul>'
      + '<li><p>Outer</p>'
      + '<ul><li><p>Solo inner</p></li></ul>'
      + '</li>'
      + '</ul>'
      + '<p>Tail</p>',
    );

    // Place caret inside the solo inner paragraph.
    await page.locator(`${editorSelector} p:has-text("Solo inner")`).click();
    await page.waitForTimeout(50);

    // Mod-Shift-Down moves the current block down by one slot. With the
    // fix, the empty wrapper UL collapses too.
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+Shift+ArrowDown`);
    await page.waitForTimeout(80);

    expect(await countEmptyListItems(page)).toBe(0);
    expect((await page.locator(editorSelector).textContent()) ?? '').toContain('Solo inner');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 8. Drop in inter-block gaps — closest-by-Y + list-wrapper "stick" UX
// ────────────────────────────────────────────────────────────────────────
//
// Regression coverage for the bug where dropping in the small gap between
// a list bottom and the next top-level block silently failed (resolver
// returned null because no top-level block contained the gap Y, and the
// X=0 fallback `posAtCoords` returned null too). The fix:
//
// 1. `resolveTopLevelByY` falls back to closest top-level block by Y
//    distance (instead of the fragile X=0 `posAtCoords` last-resort).
// 2. `handleDrop` adjusts the resolved target when it's a list-wrapper
//    container — descending into the first/last child so drops in the
//    gap above/below stick INSIDE the list (Notion behaviour).

test.describe('Drop in inter-block gaps', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    await page.setViewportSize({ width: 1280, height: 1500 });
  });

  /** Resolve UL bottom + next-block top to compute the gap. */
  async function listAndNextBlockBounds(page: Page): Promise<{
    ulBottom: number; nextTop: number;
    firstLi: { x: number; y: number; height: number };
    lastLi: { x: number; y: number; height: number };
  }> {
    return page.evaluate(() => {
      const ul = document.querySelector('.ProseMirror > ul') as HTMLElement;
      const lis = ul.querySelectorAll(':scope > li');
      const next = ul.nextElementSibling as HTMLElement | null;
      const firstLiR = (lis[0] as HTMLElement).getBoundingClientRect();
      const lastLiR = (lis[lis.length - 1] as HTMLElement).getBoundingClientRect();
      return {
        ulBottom: ul.getBoundingClientRect().bottom,
        nextTop: next ? next.getBoundingClientRect().top : ul.getBoundingClientRect().bottom + 100,
        firstLi: { x: firstLiR.x, y: firstLiR.y, height: firstLiR.height },
        lastLi: { x: lastLiR.x, y: lastLiR.y, height: lastLiR.height },
      };
    });
  }

  /** Ordered helper: hover source, dragstart, dragover+drop, dragend. */
  async function dragHandleTo(page: Page, dropX: number, dropY: number): Promise<void> {
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();
  }

  test('drop in gap 1px BELOW list → A appended to end of list (sticks to list)', async ({ page }) => {
    await setContent(
      page,
      '<ul>'
      + '<li><p>Item A</p></li>'
      + '<li><p>Item B</p></li>'
      + '<li><p>Item C</p></li>'
      + '</ul>'
      + '<h2>Next section</h2>',
    );

    const itemAP = page.locator(`${editorSelector} p`, { hasText: 'Item A' });
    const aBox = await boxOf(itemAP);
    await hoverAt(page, await sideGutterX(page), aBox.y + aBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const bounds = await listAndNextBlockBounds(page);
    // 1px below UL bottom — squarely in the gap, but visually adjacent
    // to the list. Pre-fix: drop did nothing.
    const dropX = bounds.lastLi.x + 5;
    const dropY = bounds.ulBottom + 1;
    await dragHandleTo(page, dropX, dropY);

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim());
    expect(liTexts).toEqual(['Item B', 'Item C', 'Item A']);
  });

  test('drop at midpoint of gap → A still sticks to list (closest top-level wins)', async ({ page }) => {
    await setContent(
      page,
      '<ul>'
      + '<li><p>Item A</p></li>'
      + '<li><p>Item B</p></li>'
      + '<li><p>Item C</p></li>'
      + '</ul>'
      + '<h2>Next section</h2>',
    );

    const itemAP = page.locator(`${editorSelector} p`, { hasText: 'Item A' });
    const aBox = await boxOf(itemAP);
    await hoverAt(page, await sideGutterX(page), aBox.y + aBox.height / 2);

    const bounds = await listAndNextBlockBounds(page);
    const dropX = bounds.lastLi.x + 5;
    const dropY = (bounds.ulBottom + bounds.nextTop) / 2;
    await dragHandleTo(page, dropX, dropY);

    // Midpoint is exactly equidistant — closest-by-Y picks the FIRST
    // matching candidate (the list, traversed first). Result: A goes
    // into the list at the end. (If the gap were asymmetric, the
    // logic still picks whichever side is closer.)
    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim());
    expect(liTexts).toEqual(['Item B', 'Item C', 'Item A']);
  });

  test('drop in gap 1px ABOVE next block → resolver picks next block (cursor closer to it)', async ({ page }) => {
    await setContent(
      page,
      '<ul>'
      + '<li><p>Item A</p></li>'
      + '<li><p>Item B</p></li>'
      + '<li><p>Item C</p></li>'
      + '</ul>'
      + '<h2>Next section</h2>',
    );

    const itemAP = page.locator(`${editorSelector} p`, { hasText: 'Item A' });
    const aBox = await boxOf(itemAP);
    await hoverAt(page, await sideGutterX(page), aBox.y + aBox.height / 2);

    const bounds = await listAndNextBlockBounds(page);
    // 1px above the next block's top — closer to H2 than to UL.
    // Resolver returns H2 (not a list wrapper). Drop processes H2:
    // top-half of H2 → insert before H2. moveBlock inserts the
    // listItem at top level → PM auto-wraps it in a sibling UL.
    const dropX = bounds.lastLi.x + 5;
    const dropY = bounds.nextTop - 1;
    await dragHandleTo(page, dropX, dropY);

    // Top-level layout: original UL[B, C], new UL[A], H2.
    const topLevel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(topLevel).toEqual([
      { type: 'bulletList', text: 'Item BItem C' },
      { type: 'bulletList', text: 'Item A' },
      { type: 'heading', text: 'Next section' },
    ]);
  });

  test('drop ABOVE first item of list → A goes to start of list (above-list gap sticks)', async ({ page }) => {
    await setContent(
      page,
      '<h2>Header above</h2>'
      + '<ul>'
      + '<li><p>Item A</p></li>'
      + '<li><p>Item B</p></li>'
      + '<li><p>Item C</p></li>'
      + '</ul>',
    );

    // Use Item C as the source so we can verify it lands at the start.
    const itemCP = page.locator(`${editorSelector} p`, { hasText: 'Item C' });
    const cBox = await boxOf(itemCP);
    await hoverAt(page, await sideGutterX(page), cBox.y + cBox.height / 2);

    const bounds = await listAndNextBlockBounds(page);
    const headerBottom = await page.evaluate(() => {
      const h = document.querySelector('.ProseMirror > h2') as HTMLElement;
      return h.getBoundingClientRect().bottom;
    });
    // 1px above the first listItem's top — squarely in the gap between
    // header and list. Closer to UL → wrapper detect → first child.
    const dropX = bounds.firstLi.x + 5;
    const dropY = bounds.firstLi.y - 1;
    expect(dropY).toBeGreaterThan(headerBottom); // sanity: gap-Y is below header
    await dragHandleTo(page, dropX, dropY);

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim());
    // C jumped to the start: [C, A, B].
    expect(liTexts).toEqual(['Item C', 'Item A', 'Item B']);
  });

  test('drop in last paragraph bottom-half → A moves out of list, lands after last paragraph', async ({ page }) => {
    // PM only dispatches `drop` events whose clientY lies INSIDE the
    // editor's bounding rect — drops further outside are silently
    // ignored (PM's input scoping, not our bug). We test the realistic
    // drop position: inside the last block, in its bottom half.
    await setContent(
      page,
      '<p>First</p>'
      + '<ul><li><p>Item A</p></li><li><p>Item B</p></li></ul>'
      + '<p>Last paragraph</p>',
    );

    const itemAP = page.locator(`${editorSelector} p`, { hasText: 'Item A' });
    const aBox = await boxOf(itemAP);
    await hoverAt(page, await sideGutterX(page), aBox.y + aBox.height / 2);

    const lastP = page.locator(`${editorSelector} p`, { hasText: 'Last paragraph' });
    const lBox = await boxOf(lastP);
    // Drop in the last paragraph's bottom half (= insert AFTER it).
    await dragHandleTo(page, lBox.x + 5, lBox.y + lBox.height * 0.8);

    const topLevel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    // A is gone from the bullet list, appears after Last paragraph
    // (PM auto-wraps the bare listItem in a sibling bulletList).
    const listEntries = topLevel.filter((e) => e.type === 'bulletList');
    expect(listEntries[0]?.text).toBe('Item B');
    const lastEntry = topLevel[topLevel.length - 1];
    expect(lastEntry?.text).toBe('Item A');
  });

  test('drop in first paragraph top-half → B moves out of list, lands before first paragraph', async ({ page }) => {
    await setContent(
      page,
      '<p>First paragraph</p>'
      + '<ul><li><p>Item A</p></li><li><p>Item B</p></li></ul>',
    );

    const itemBP = page.locator(`${editorSelector} p`, { hasText: 'Item B' });
    const bBox = await boxOf(itemBP);
    await hoverAt(page, await sideGutterX(page), bBox.y + bBox.height / 2);

    const firstP = page.locator(`${editorSelector} p`, { hasText: 'First paragraph' });
    const fBox = await boxOf(firstP);
    // Drop in the first paragraph's top-half (= insert BEFORE it).
    await dragHandleTo(page, fBox.x + 5, fBox.y + fBox.height * 0.2);

    const topLevel = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    // B moved BEFORE "First paragraph" (auto-wrapped in a sibling UL by PM).
    expect(topLevel[0]?.text).toBe('Item B');
    expect(topLevel[1]?.text).toBe('First paragraph');
    // Original list lost B.
    const listEntries = topLevel.filter((e) => e.type === 'bulletList');
    expect(listEntries[1]?.text).toBe('Item A');
  });

  test('drop in gap is consistent: moveBlock target equals what handleDrop computes', async ({ page }) => {
    // Sanity: hovering the source over the gap Y produces the same
    // hovered target as the drop fallback. Without this, hover indicator
    // and drop landing site can disagree (a known dropcursor pitfall).
    await setContent(
      page,
      '<ul><li><p>Source</p></li><li><p>Stay</p></li></ul>'
      + '<p>Below</p>',
    );

    const sourceP = page.locator(`${editorSelector} p`, { hasText: 'Source' });
    const sBox = await boxOf(sourceP);
    await hoverAt(page, await sideGutterX(page), sBox.y + sBox.height / 2);

    // Move to the gap (1px below UL).
    const ulBottom = await page.evaluate(() => {
      const ul = document.querySelector('.ProseMirror > ul') as HTMLElement;
      return ul.getBoundingClientRect().bottom;
    });
    await hoverAt(page, await sideGutterX(page), ulBottom + 1);
    // The hover state should EITHER stay on Source (since cursor moved
    // off any listItem rect → handle keeps last hover) OR re-anchor to
    // the closest listItem. Either way, the drop must work.
    const stillShown = await page.locator(blockHandleSelector).getAttribute('data-show');
    expect(stillShown).not.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 9. Block context menu Delete — must not nuke surrounding structure
// ────────────────────────────────────────────────────────────────────────
//
// Regression coverage: clicking the drag handle on a list item and then
// "Delete" in the context menu deleted the WHOLE list (PM's content fitter
// unwrapped the parent UL because deleting an inner LI from a UL whose
// `tr.doc.childCount === 1` triggered the wrong fallback branch). The fix
// shares the same single-child-wrapper expansion logic with `moveBlock`.

test.describe('BlockContextMenu Delete', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    await page.setViewportSize({ width: 1280, height: 1500 });
  });

  /**
   * Open the context menu on the textblock that contains `text`. Tries
   * common textblock tags so headings / blockquotes / paragraphs all
   * work without per-test custom locators.
   */
  async function openMenuOn(page: Page, text: string): Promise<void> {
    const textblock = page
      .locator(`${editorSelector} :is(p, h1, h2, h3, h4, h5, h6)`, { hasText: text })
      .first();
    const tBox = await boxOf(textblock);
    await hoverAt(page, await sideGutterX(page), tBox.y + tBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    // Click the drag handle (without dragging) → opens BlockContextMenu.
    await page.locator(dragBtnSelector).click();
    await expect(page.locator('.dm-block-context-menu')).toBeVisible();
  }

  test('deleting the FIRST item in a multi-item list keeps the list with the remaining items', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Item A</p></li><li><p>Item B</p></li><li><p>Item C</p></li></ul>',
    );
    await openMenuOn(page, 'Item A');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents())
      .map((t) => t.trim());
    expect(liTexts).toEqual(['Item B', 'Item C']);
  });

  test('deleting the ONLY item of a list with siblings removes the list entirely (no empty <ul>)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Lonely</p></li></ul><p>After</p>');
    await openMenuOn(page, 'Lonely');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([{ type: 'paragraph', text: 'After' }]);
  });

  test('deleting the ONLY item of the ONLY top-level list replaces the doc with an empty paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>Only</p></li></ul>');
    await openMenuOn(page, 'Only');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([{ type: 'paragraph', text: '' }]);
  });

  test('deleting an inner item of a NESTED list keeps both outer and (still-populated) nested wrapper intact', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul>'
      + '<li><p>Inner X</p></li>'
      + '<li><p>Inner Y</p></li>'
      + '</ul>'
      + '</li></ul>',
    );
    await openMenuOn(page, 'Inner X');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    // Outer LI keeps its paragraph + nested UL with the surviving inner item.
    const outerInfo = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; lastChild: { type: { name: string }; childCount: number; firstChild: { textContent: string } | null } | null } | null } | null } } }
        | undefined;
      const outerLi = ed?.state.doc.firstChild?.firstChild;
      return outerLi
        ? {
            childCount: outerLi.childCount,
            nestedType: outerLi.lastChild?.type.name,
            nestedChildCount: outerLi.lastChild?.childCount,
            nestedFirstText: outerLi.lastChild?.firstChild?.textContent,
          }
        : null;
    });
    expect(outerInfo).toEqual({
      childCount: 2,
      nestedType: 'bulletList',
      nestedChildCount: 1,
      nestedFirstText: 'Inner Y',
    });
  });

  test('deleting the ONLY inner item of a nested list collapses the nested UL but keeps outer + the rest', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Lone inner</p></li></ul>'
      + '</li></ul>'
      + '<p>Trailing</p>',
    );
    await openMenuOn(page, 'Lone inner');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    // Outer LI now has only its paragraph (nested UL gone).
    const outerInfo = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const outerLi = ed?.state.doc.firstChild?.firstChild;
      return outerLi
        ? {
            childCount: outerLi.childCount,
            firstType: outerLi.firstChild?.type.name,
            firstText: outerLi.firstChild?.textContent,
          }
        : null;
    });
    expect(outerInfo).toEqual({ childCount: 1, firstType: 'paragraph', firstText: 'Outer' });

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.forEach((n) => out.push(n.type.name));
      return out;
    });
    expect(top).toEqual(['bulletList', 'paragraph']);
  });

  // ── List position coverage ──

  test('deleting the LAST item of a multi-item list keeps the list with the surviving items', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Item A</p></li><li><p>Item B</p></li><li><p>Item C</p></li></ul>',
    );
    await openMenuOn(page, 'Item C');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents())
      .map((t) => t.trim());
    expect(liTexts).toEqual(['Item A', 'Item B']);
  });

  test('deleting the MIDDLE item of a multi-item list keeps order of surrounding items', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Item A</p></li><li><p>Item B</p></li><li><p>Item C</p></li></ul>',
    );
    await openMenuOn(page, 'Item B');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents())
      .map((t) => t.trim());
    expect(liTexts).toEqual(['Item A', 'Item C']);
  });

  // ── List type coverage ──

  test('deleting an ordered list item only removes that item, keeps the OL', async ({ page }) => {
    await setContent(page, '<ol><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ol>');
    await openMenuOn(page, 'Two');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const liTexts = (await page.locator(`${editorSelector} ol li p`).allTextContents())
      .map((t) => t.trim());
    expect(liTexts).toEqual(['One', 'Three']);
  });

  test('deleting a task item only removes that item, keeps the taskList', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Task One</p></li>'
      + '<li data-type="taskItem"><p>Task Two</p></li>'
      + '<li data-type="taskItem"><p>Task Three</p></li>'
      + '</ul>',
    );
    await openMenuOn(page, 'Task Two');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const taskTexts = (await page.locator(`${editorSelector} li[data-type="taskItem"] p`).allTextContents())
      .map((t) => t.trim());
    expect(taskTexts).toEqual(['Task One', 'Task Three']);
  });

  test('deleting the only task item of a task list removes the whole task list', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Solo task</p></li></ul>'
      + '<p>After</p>',
    );
    await openMenuOn(page, 'Solo task');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([{ type: 'paragraph', text: 'After' }]);
  });

  // ── Non-list block regression coverage ──

  test('deleting a top-level paragraph (non-list) only removes that paragraph', async ({ page }) => {
    await setContent(page, '<p>First</p><p>Middle</p><p>Last</p>');
    await openMenuOn(page, 'Middle');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const texts = (await page.locator(`${editorSelector} > p`).allTextContents())
      .map((t) => t.trim());
    expect(texts).toEqual(['First', 'Last']);
  });

  test('deleting a heading only removes that heading', async ({ page }) => {
    await setContent(page, '<p>Above</p><h2>The heading</h2><p>Below</p>');
    await openMenuOn(page, 'The heading');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    expect(top).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'paragraph', text: 'Below' },
    ]);
  });

  test('deleting a blockquote removes the whole blockquote (not just its inner paragraph)', async ({ page }) => {
    await setContent(page, '<p>Above</p><blockquote><p>Quoted</p></blockquote><p>Below</p>');
    await openMenuOn(page, 'Quoted');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    // Blockquote is a single-child wrapper of its paragraph → expansion
    // catches it, so the whole blockquote disappears (no orphan empty
    // blockquote left behind).
    expect(top).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'paragraph', text: 'Below' },
    ]);
  });

  // ── Behavioural invariants ──

  test('undo restores the deleted block in its original position', async ({ page }) => {
    await setContent(page, '<ul><li><p>X</p></li><li><p>Y</p></li><li><p>Z</p></li></ul>');
    await openMenuOn(page, 'Y');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    expect(
      (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim()),
    ).toEqual(['X', 'Z']);

    // Editor must have focus for the keyboard shortcut to reach PM.
    await page.locator(`${editorSelector}`).click();
    const modKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modKey}+z`);
    await page.waitForTimeout(80);

    expect(
      (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim()),
    ).toEqual(['X', 'Y', 'Z']);
  });

  test('multiple consecutive deletes whittle the list down to one item then to an empty paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');

    await openMenuOn(page, 'One');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);
    expect(
      (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim()),
    ).toEqual(['Two']);

    await openMenuOn(page, 'Two');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    // List collapsed (single-child wrapper expansion), then doc-empty
    // fallback inserted a fresh paragraph.
    expect(top).toEqual([{ type: 'paragraph', text: '' }]);
  });

  test('deleting a list item leaves no empty list-item placeholders anywhere in the doc', async ({ page }) => {
    // Sweep across the suite's most-likely edge cases — counting empty
    // placeholders is the single tightest invariant for the regression.
    await setContent(
      page,
      '<ul><li><p>Outer</p>'
      + '<ul><li><p>Solo inner</p></li></ul>'
      + '</li></ul>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Lone task</p></li></ul>'
      + '<p>Tail</p>',
    );
    await openMenuOn(page, 'Solo inner');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);
    await openMenuOn(page, 'Lone task');
    await page.locator('.dm-block-context-menu-item', { hasText: 'Delete' }).click();
    await page.waitForTimeout(80);

    const emptyPlaceholders = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }) => boolean | void) => void } } }
        | undefined;
      let n = 0;
      ed?.state.doc.descendants((node) => {
        if (
          (node.type.name === 'listItem' || node.type.name === 'taskItem')
          && node.textContent === ''
        ) n++;
        return true;
      });
      return n;
    });
    expect(emptyPlaceholders).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 10. Cross-list-type drop — auto-convert listItem ↔ taskItem
// ────────────────────────────────────────────────────────────────────────
//
// Regression coverage for the bug where dropping a `listItem` into a
// `taskList` produced an empty checkbox containing the bullet item
// (PM's content fitter wrapping the wrong-type child to satisfy
// `taskItem+`). The fix adapts the dragged item's wrapper type to
// match the target parent's content rule — Notion-style.

test.describe('Cross-list-type drop auto-converts wrapper', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    await page.setViewportSize({ width: 1280, height: 1500 });
  });

  /** Hover a paragraph + dragstart + drop on another paragraph's bottom-half. */
  async function dragFromTo(page: Page, sourceText: string, targetText: string): Promise<void> {
    const sourceP = page.locator(`${editorSelector} p`, { hasText: sourceText }).first();
    const sBox = await boxOf(sourceP);
    await hoverAt(page, await sideGutterX(page), sBox.y + sBox.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const targetP = page.locator(`${editorSelector} p`, { hasText: targetText }).first();
    const tBox = await boxOf(targetP);
    const dropX = tBox.x + 5;
    const dropY = tBox.y + tBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt, clientX: dropX, clientY: dropY,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();
  }

  /** Returns the type name of every listItem/taskItem in the doc, in order. */
  async function itemTypes(page: Page): Promise<Array<{ type: string; text: string; checked: unknown }>> {
    return page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string; attrs: Record<string, unknown> }) => boolean | void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string; checked: unknown }> = [];
      ed?.state.doc.descendants((node) => {
        if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
          out.push({ type: node.type.name, text: node.textContent, checked: node.attrs['checked'] });
        }
        return true;
      });
      return out;
    });
  }

  // ── Bullet → Task ──

  test('drag a bullet item into a task list → converts to taskItem (unchecked)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet source</p></li></ul>'
      + '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Existing task</p></li>'
      + '</ul>',
    );
    await dragFromTo(page, 'Bullet source', 'Existing task');

    const items = await itemTypes(page);
    // Only `Existing task` and the converted `Bullet source` (now a taskItem).
    // `Bullet source` is below `Existing task` because we dropped on the
    // bottom half.
    expect(items).toEqual([
      { type: 'taskItem', text: 'Existing task', checked: false },
      { type: 'taskItem', text: 'Bullet source', checked: false },
    ]);
  });

  test('drag a bullet item into the MIDDLE of a task list → still converts to taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet source</p></li></ul>'
      + '<ul data-type="taskList">'
      + '<li data-type="taskItem" data-checked="true"><p>Task A</p></li>'
      + '<li data-type="taskItem"><p>Task B</p></li>'
      + '</ul>',
    );
    // Drop on Task A's bottom-half → lands between A and B (still inside taskList).
    await dragFromTo(page, 'Bullet source', 'Task A');

    const items = await itemTypes(page);
    expect(items.map((i) => i.type)).toEqual(['taskItem', 'taskItem', 'taskItem']);
    expect(items.map((i) => i.text)).toEqual(['Task A', 'Bullet source', 'Task B']);
    // Existing checked state preserved on Task A; new converted item is unchecked.
    expect(items[0]?.checked).toBe(true);
    expect(items[1]?.checked).toBe(false);
  });

  // ── Task → Bullet/Ordered ──

  test('drag a task item into a bullet list → converts to listItem (drops checked)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem" data-checked="true"><p>Task source</p></li>'
      + '</ul>'
      + '<ul><li><p>Existing bullet</p></li></ul>',
    );
    await dragFromTo(page, 'Task source', 'Existing bullet');

    const items = await itemTypes(page);
    // listItem schema doesn't carry `checked`, so attr is stripped.
    expect(items).toEqual([
      { type: 'listItem', text: 'Existing bullet', checked: undefined },
      { type: 'listItem', text: 'Task source', checked: undefined },
    ]);
  });

  test('drag a task item into an ordered list → converts to listItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList">'
      + '<li data-type="taskItem"><p>Task source</p></li>'
      + '</ul>'
      + '<ol><li><p>Existing numbered</p></li></ol>',
    );
    await dragFromTo(page, 'Task source', 'Existing numbered');

    const items = await itemTypes(page);
    expect(items.map((i) => i.type)).toEqual(['listItem', 'listItem']);
    expect(items.map((i) => i.text)).toEqual(['Existing numbered', 'Task source']);
  });

  // ── No-op cases ──

  test('drag a bullet item into another bullet list → no conversion', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>From here</p></li></ul>'
      + '<ul><li><p>To here</p></li></ul>',
    );
    await dragFromTo(page, 'From here', 'To here');
    const items = await itemTypes(page);
    expect(items.map((i) => i.type)).toEqual(['listItem', 'listItem']);
  });

  test('drag a bullet item into an ordered list → still listItem (no conversion needed, same item type)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet source</p></li></ul>'
      + '<ol><li><p>Numbered target</p></li></ol>',
    );
    await dragFromTo(page, 'Bullet source', 'Numbered target');
    const items = await itemTypes(page);
    // Both lists use `listItem`, so no wrapper conversion is needed —
    // the source just lands inside the ordered list as a listItem.
    expect(items.map((i) => i.type)).toEqual(['listItem', 'listItem']);
  });

  // ── Top-level drop unaffected ──

  test('drag a bullet item to a top-level paragraph → wraps in fresh bulletList (no auto-convert)', async ({ page }) => {
    // Top-level drop has parent = doc (not a list wrapper) → conversion
    // helper short-circuits, source stays a listItem and PM auto-wraps.
    await setContent(
      page,
      '<ul><li><p>Source</p></li></ul>'
      + '<p>Target paragraph</p>',
    );
    await dragFromTo(page, 'Source', 'Target paragraph');

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      return out;
    });
    // Source bulletList disappeared (single-child wrapper expanded on
    // delete). Target paragraph + new wrapped bulletList AFTER it.
    expect(top).toEqual([
      { type: 'paragraph', text: 'Target paragraph' },
      { type: 'bulletList', text: 'Source' },
    ]);
  });

  // ── Inner content preserved during conversion ──

  // ── Arbitrary-block wrap (heading, paragraph, codeBlock, blockquote, hr) ──

  test('drag a top-level H1 into a bulletList → heading is wrapped in a fresh listItem inside the list', async ({ page }) => {
    await setContent(page, '<h1>Big title</h1><ul><li><p>Existing</p></li></ul>');

    const h1 = page.locator(`${editorSelector} h1`, { hasText: 'Big title' });
    const h1Box = await boxOf(h1);
    await hoverAt(page, await sideGutterX(page), h1Box.y + h1Box.height / 2);
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p`, { hasText: 'Existing' });
    const tBox = await boxOf(target);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // Expect: bulletList with TWO listItems — first the original
    // paragraph "Existing", second a wrapped heading "Big title".
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; firstChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null; childCount: number } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      return {
        topCount: ed?.state.doc.childCount,
        ulType: ul?.type.name,
        ulChildCount: ul?.childCount,
        firstItemType: ul?.child(0)?.firstChild?.type.name,
        firstItemText: ul?.child(0)?.firstChild?.textContent,
        secondItemType: ul?.child(1)?.firstChild?.type.name,
        secondItemText: ul?.child(1)?.firstChild?.textContent,
        secondItemLevel: ul?.child(1)?.firstChild?.attrs['level'],
      };
    });
    expect(tree).toEqual({
      topCount: 1,
      ulType: 'bulletList',
      ulChildCount: 2,
      firstItemType: 'paragraph',
      firstItemText: 'Existing',
      secondItemType: 'heading',
      secondItemText: 'Big title',
      secondItemLevel: 1,
    });
  });

  test('drag a top-level H2 into a taskList → heading wrapped in a fresh taskItem (checked=false)', async ({ page }) => {
    await setContent(
      page,
      '<h2>Section heading</h2>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );

    const h2 = page.locator(`${editorSelector} h2`, { hasText: 'Section heading' });
    const h2Box = await boxOf(h2);
    await hoverAt(page, await sideGutterX(page), h2Box.y + h2Box.height / 2);

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p`, { hasText: 'Task' });
    const tBox = await boxOf(target);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; attrs: Record<string, unknown>; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const tl = ed?.state.doc.firstChild;
      const second = tl?.child(1);
      return {
        ulType: tl?.type.name,
        ulChildCount: tl?.childCount,
        secondType: second?.type.name,
        secondChecked: second?.attrs['checked'],
        secondInner: second?.firstChild?.type.name,
        secondInnerText: second?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      ulType: 'taskList',
      ulChildCount: 2,
      secondType: 'taskItem',
      secondChecked: false,
      secondInner: 'heading',
      secondInnerText: 'Section heading',
    });
  });

  test('drag a top-level paragraph into a bulletList → wrapped in listItem (most common case)', async ({ page }) => {
    await setContent(page, '<p>Standalone para</p><ul><li><p>Existing</p></li></ul>');

    const para = page.locator(`${editorSelector} > p`, { hasText: 'Standalone para' });
    const pBox = await boxOf(para);
    await hoverAt(page, await sideGutterX(page), pBox.y + pBox.height / 2);

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p`, { hasText: 'Existing' });
    const tBox = await boxOf(target);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const liTexts = (await page.locator(`${editorSelector} li p`).allTextContents()).map((t) => t.trim());
    expect(liTexts).toEqual(['Existing', 'Standalone para']);

    const top = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string } } | null } } }
        | undefined;
      return { count: ed?.state.doc.childCount, firstType: ed?.state.doc.firstChild?.type.name };
    });
    expect(top).toEqual({ count: 1, firstType: 'bulletList' });
  });

  test('drag a top-level codeBlock into a bulletList → wrapped in listItem (preserves code text)', async ({ page }) => {
    await setContent(
      page,
      '<pre><code>console.log("hi")</code></pre>'
      + '<ul><li><p>Existing</p></li></ul>',
    );

    const code = page.locator(`${editorSelector} pre`, { hasText: 'console.log' });
    const cBox = await boxOf(code);
    await hoverAt(page, await sideGutterX(page), cBox.y + cBox.height / 2);

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p`, { hasText: 'Existing' });
    const tBox = await boxOf(target);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { firstChild: { type: { name: string }; textContent: string } | null } | null } | null; childCount: number } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      return {
        topCount: ed?.state.doc.childCount,
        ulChildCount: ul?.childCount,
        secondInner: ul?.child(1)?.firstChild?.type.name,
        secondText: ul?.child(1)?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 1,
      ulChildCount: 2,
      secondInner: 'codeBlock',
      secondText: 'console.log("hi")',
    });
  });

  test('drag a top-level blockquote into a bulletList → wrapped in listItem (blockquote keeps its inner paragraph)', async ({ page }) => {
    await setContent(
      page,
      '<blockquote><p>Quoted text</p></blockquote>'
      + '<ul><li><p>Existing</p></li></ul>',
    );

    const bq = page.locator(`${editorSelector} blockquote`);
    const bqBox = await boxOf(bq);
    await hoverAt(page, await sideGutterX(page), bqBox.y + bqBox.height / 2);

    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    const target = page.locator(`${editorSelector} li p`, { hasText: 'Existing' });
    const tBox = await boxOf(target);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: tBox.x + 5, clientY: tBox.y + tBox.height * 0.8 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { firstChild: { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } | null; childCount: number } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const second = ul?.child(1);
      return {
        topCount: ed?.state.doc.childCount,
        ulChildCount: ul?.childCount,
        secondWrapper: second?.firstChild?.type.name,
        secondInnerInner: second?.firstChild?.firstChild?.type.name,
        secondInnerText: second?.firstChild?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 1,
      ulChildCount: 2,
      secondWrapper: 'blockquote',
      secondInnerInner: 'paragraph',
      secondInnerText: 'Quoted text',
    });
  });

  // ── Inner content preserved during conversion ──

  test('converted item retains its inner paragraph + nested lists', async ({ page }) => {
    // Source: a bullet item that itself contains a nested task list.
    // Drop into a task list. Outer wrapper: listItem → taskItem.
    // Inner nested taskList: stays a taskList (already correct type).
    await setContent(
      page,
      '<ul><li>'
      + '<p>Outer source</p>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Inner kept</p></li></ul>'
      + '</li></ul>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Existing task</p></li></ul>',
    );
    await dragFromTo(page, 'Outer source', 'Existing task');

    // Outer item is now a taskItem, and its first child is the paragraph,
    // its second child is the (still) nested taskList.
    const structure = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string; childCount: number; firstChild: { type: { name: string } } | null; lastChild: { type: { name: string } } | null }) => boolean | void) => void } } }
        | undefined;
      const out: Array<{ type: string; text: string; childCount: number; firstChildType: string | undefined; lastChildType: string | undefined }> = [];
      ed?.state.doc.descendants((node) => {
        if (node.type.name === 'taskItem' && node.textContent.includes('Outer source')) {
          out.push({
            type: node.type.name,
            text: node.textContent,
            childCount: node.childCount,
            firstChildType: node.firstChild?.type.name,
            lastChildType: node.lastChild?.type.name,
          });
        }
        return true;
      });
      return out;
    });
    expect(structure).toHaveLength(1);
    expect(structure[0]).toMatchObject({
      type: 'taskItem',
      childCount: 2,
      firstChildType: 'paragraph',
      lastChildType: 'taskList',
    });
  });
});
