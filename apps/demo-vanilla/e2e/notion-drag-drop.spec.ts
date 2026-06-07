/**
 * Drag-and-drop E2E coverage for the Notion demo.
 *
 * Playwright cannot faithfully reproduce the HTML5 drag lifecycle via
 * plain mouse moves - the browser only dispatches `dragstart`/`drop`
 * when a real OS drag is in flight. To work around that we install a
 * shared `DataTransfer` (synthesised in the page context) and fire the
 * canonical sequence `dragstart → dragover → drop → dragend` ourselves
 * against the relevant DOM nodes. ProseMirror's `handleDrop` sees the
 * `view.dragging` state our extension sets on `dragstart` and performs
 * the same reorder logic that a real drag would trigger.
 *
 * That synthetic loop covers what we can meaningfully test here:
 * correctness of source/target position math, self-drop safety, nested
 * list-item reorder, and attribute preservation (UniqueID / BlockColor)
 * across the move. It does NOT cover the real-OS pieces (drag image,
 * auto-scroll ramp, browser drag cancel) - those stay unit-tested in
 * `packages/extension-block-menu/src/BlockHandle.test.ts`.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator, type JSHandle } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
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

/**
 * The dragover -> drop-indicator repaint is rAF-coalesced, so a SHOW lands on
 * the next animation frame (hide is synchronous). Flush two frames before
 * reading the indicator state after a synthesised dragover.
 */
async function flushIndicatorRaf(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => {
      requestAnimationFrame(() => requestAnimationFrame(() => { res(); }));
    }),
  );
}

/** Dispatch a document-level dragover at (x,y), flush the rAF, read `data-show`. */
async function probeIndicatorShown(page: Page, x: number, y: number): Promise<boolean> {
  await page.evaluate(({ cx, cy }) => {
    document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  }, { cx: x, cy: y });
  await flushIndicatorRaf(page);
  return page.evaluate(() => document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show') ?? false);
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
 * Perform a synthetic HTML5 drag from the drag handle onto a target
 * block. `dropZone` decides which half of the target the drop lands in
 * - `"top"` triggers insert-before, `"bottom"` insert-after (mirrors
 * the mid-point check in `BlockHandle.handleDrop`).
 *
 * The function hovers the source block first so the handle mounts,
 * then runs the full event sequence against that handle and the target
 * block. Returns nothing - assertions inspect the resulting doc.
 */
async function dragBlock(
  page: Page,
  sourceBlock: Locator,
  targetBlock: Locator,
  dropZone: 'top' | 'bottom' = 'bottom',
): Promise<void> {
  // 1. Surface the drag handle over the source block.
  await sourceBlock.hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  // 2. Build a single DataTransfer to thread through all four events -
  //    some browsers wipe clipboard-like payloads between separate handles,
  //    so we reuse the same object (matches real-drag semantics).
  const dt = await page.evaluateHandle(() => new DataTransfer());

  const handle = page.locator(dragBtnSelector);
  const targetBox = await targetBlock.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) return;

  // Coordinates inside the target: "top" drops above mid, "bottom" below.
  // X is intentionally near the left edge (4px) - this keeps the drop in
  // the SIBLING zone (`clientX < nestThreshold`) so these tests retain
  // their sibling-reorder semantics. Nested-drop coverage lives in
  // `notion-drop-placement-sibling.spec.ts`.
  const clientX = targetBox.x + 4;
  const clientY = dropZone === 'top'
    ? targetBox.y + targetBox.height * 0.2
    : targetBox.y + targetBox.height * 0.8;

  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  // `dragover` on the PM view dom is what lets our auto-scroll tracking and
  // the dropcursor pick up the latest cursor position.
  await page.locator(editorSelector).dispatchEvent('dragover', {
    dataTransfer: dt,
    clientX,
    clientY,
  });
  await page.locator(editorSelector).dispatchEvent('drop', {
    dataTransfer: dt,
    clientX,
    clientY,
  });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });

  // Let the resulting transaction commit + re-render before assertions.
  await page.waitForTimeout(80);
  await cleanupDt(dt);
}

async function cleanupDt(dt: JSHandle<DataTransfer>): Promise<void> {
  await dt.dispose();
}

// ────────────────────────────────────────────────────────────────────────
// 1. Basic reorder - top-level blocks
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - top-level reorder', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag first paragraph onto (below mid of) second → swaps order', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const second = page.locator(`${editorSelector} p:has-text("Bravo")`);
    await dragBlock(page, first, second, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('drag last paragraph onto (above mid of) first → moves to top', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const last = page.locator(`${editorSelector} p:has-text("Charlie")`);
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await dragBlock(page, last, first, 'top');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  test('drag middle block to (bottom half of) last block → moves to end', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p><p>C</p>');
    const middle = page.locator(`${editorSelector} p:has-text("B")`);
    const last = page.locator(`${editorSelector} p:has-text("C")`);
    await dragBlock(page, middle, last, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['A', 'C', 'B']);
  });

  test('drop on the source block itself is a no-op (self-drop guard)', async ({ page }) => {
    await setContent(page, '<p>First</p><p>Second</p>');
    const source = page.locator(`${editorSelector} p:has-text("First")`);
    await dragBlock(page, source, source, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['First', 'Second']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Mixed-type drag - heading + paragraph + blockquote + task list
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - mixed block types', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag a heading below a paragraph (type survives move)', async ({ page }) => {
    await setContent(page, '<h2>Title</h2><p>Body</p>');
    const heading = page.locator(`${editorSelector} h2`);
    const body = page.locator(`${editorSelector} p:has-text("Body")`);
    await dragBlock(page, heading, body, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.text).toBe('Body');
    expect(blocks[1]?.type).toBe('heading');
    expect(blocks[1]?.attrs['level']).toBe(2);
    expect(blocks[1]?.text).toBe('Title');
  });

  test('drag a blockquote into the middle of a paragraph list', async ({ page }) => {
    await setContent(page, '<p>One</p><p>Two</p><blockquote><p>Quote</p></blockquote>');
    const quote = page.locator(`${editorSelector} blockquote`);
    const one = page.locator(`${editorSelector} p:has-text("One")`);
    await dragBlock(page, quote, one, 'top');
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('blockquote');
    expect(blocks[1]?.text).toBe('One');
    expect(blocks[2]?.text).toBe('Two');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Attribute preservation - UniqueID + BlockColor survive drag
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - attribute preservation', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('dragged block keeps its UniqueID (move, not duplicate)', async ({ page }) => {
    await setContent(page, '<p>Stable</p><p>Other</p>');
    const idBefore = (await getBlocks(page))[0]?.attrs['id'] as string | undefined;
    expect(idBefore).toBeTruthy();
    const source = page.locator(`${editorSelector} p:has-text("Stable")`);
    const target = page.locator(`${editorSelector} p:has-text("Other")`);
    await dragBlock(page, source, target, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Other', 'Stable']);
    // The moved block at its new position still carries the original id.
    expect(blocks[1]?.attrs['id']).toBe(idBefore);
  });

  test('block colors travel with the dragged block', async ({ page }) => {
    await setContent(page, '<p data-bg-color="yellow">Bright</p><p>Plain</p>');
    const source = page.locator(`${editorSelector} p:has-text("Bright")`);
    const target = page.locator(`${editorSelector} p:has-text("Plain")`);
    await dragBlock(page, source, target, 'bottom');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Plain', 'Bright']);
    expect(blocks[1]?.attrs['bgColor']).toBe('yellow');
    expect(blocks[0]?.attrs['bgColor']).toBeNull();
  });

  test('no new ids are generated (total id set is stable across a move)', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p><p>C</p>');
    const idsBefore = new Set((await getBlocks(page)).map((b) => b.attrs['id'] as string));
    const source = page.locator(`${editorSelector} p:has-text("A")`);
    const target = page.locator(`${editorSelector} p:has-text("C")`);
    await dragBlock(page, source, target, 'bottom');
    const idsAfter = new Set((await getBlocks(page)).map((b) => b.attrs['id'] as string));
    expect(idsAfter.size).toBe(3);
    expect(idsAfter).toEqual(idsBefore);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Nested drag - list items reorder inside their list
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - nested list items', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag second list item above first → reorders without breaking the list', async ({ page }) => {
    await setContent(page, '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>');
    const second = page.locator(`${editorSelector} li`).nth(1);
    const first = page.locator(`${editorSelector} li`).nth(0);
    await dragBlock(page, second, first, 'top');
    const liTexts = await page.locator(`${editorSelector} li`).allTextContents();
    expect(liTexts.map((t) => t.trim())).toEqual(['Second', 'First', 'Third']);
    // List itself is still a single <ul>.
    expect(await page.locator(`${editorSelector} ul`).count()).toBe(1);
  });

  test('drag third item below first → between first and second', async ({ page }) => {
    await setContent(page, '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>');
    const third = page.locator(`${editorSelector} li`).nth(2);
    const first = page.locator(`${editorSelector} li`).nth(0);
    await dragBlock(page, third, first, 'bottom');
    const liTexts = await page.locator(`${editorSelector} li`).allTextContents();
    expect(liTexts.map((t) => t.trim())).toEqual(['First', 'Third', 'Second']);
  });

  test('ordered list item reorders same-list without merging with neighbour', async ({ page }) => {
    await setContent(page, '<ol><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ol>');
    const third = page.locator(`${editorSelector} ol li`).nth(2);
    const first = page.locator(`${editorSelector} ol li`).nth(0);
    await dragBlock(page, third, first, 'top');
    const texts = (await page.locator(`${editorSelector} ol li`).allTextContents()).map((t) => t.trim());
    expect(texts).toEqual(['Three', 'One', 'Two']);
    expect(await page.locator(`${editorSelector} ol`).count()).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Side-effects - dragging state + overlay cleanup
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - side-effects during the drag lifecycle', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('`view.dragging` is set on dragstart and cleared on dragend', async ({ page }) => {
    await setContent(page, '<p>One</p><p>Two</p>');
    const source = page.locator(`${editorSelector} p:has-text("One")`);
    const target = page.locator(`${editorSelector} p:has-text("Two")`);

    await source.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const draggingDuring = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { view: { dragging: unknown } } | undefined;
      return ed?.view.dragging !== null && ed?.view.dragging !== undefined;
    });
    expect(draggingDuring).toBe(true);

    const box = await target.boundingBox();
    if (!box) throw new Error('target not measurable');
    await page.locator(editorSelector).dispatchEvent('drop', {
      dataTransfer: dt,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height * 0.8,
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(60);

    const draggingAfter = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { view: { dragging: unknown } } | undefined;
      return ed?.view.dragging ?? null;
    });
    expect(draggingAfter).toBeNull();
    await dt.dispose();
  });

  test('dragstart emits `dm:dismiss-overlays` so any open context menu closes', async ({ page }) => {
    await setContent(page, '<p>First</p><p>Second</p>');
    // Open the context menu on "Second".
    const second = page.locator(`${editorSelector} p:has-text("Second")`);
    await second.hover();
    await page.click(dragBtnSelector);
    await expect(page.locator('.dm-block-context-menu')).toHaveAttribute('data-show', '');

    // Now start a drag on "First"; the overlay should dismiss.
    const first = page.locator(`${editorSelector} p:has-text("First")`);
    await first.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await expect(page.locator('.dm-block-context-menu')).not.toHaveAttribute('data-show', '', { timeout: 1000 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('handle hides once dragstart fires (it is in use, not hovered)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const source = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await source.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await expect(page.locator(blockHandleSelector)).not.toHaveAttribute('data-show', '', { timeout: 1000 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. disableDrag guard - even though the extension is configured for
//    drag in the demo, we verify the early-return in `onDragStart` by
//    triggering dragstart when nothing is hovered (no hoveredPos).
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop - safety rails', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drop indicator hides when cursor leaves the editor drop zone (top edge)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const editorBox = await page.locator('.dm-editor').boundingBox();
    expect(editorBox).not.toBeNull();
    if (!editorBox) return;

    // Just inside top → shows
    expect(await probeIndicatorShown(page, editorBox.x + editorBox.width / 2, editorBox.y + 5)).toBe(true);

    // Far above editor → hides
    expect(await probeIndicatorShown(page, editorBox.x + editorBox.width / 2, editorBox.y - 100)).toBe(false);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop indicator hides when cursor leaves the editor drop zone (bottom edge)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const editorBox = await page.locator('.dm-editor').boundingBox();
    expect(editorBox).not.toBeNull();
    if (!editorBox) return;

    // Far below editor → hides
    const belowEditor = await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y }));
      return document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show');
    }, { x: editorBox.x + editorBox.width / 2, y: editorBox.y + editorBox.height + 200 });
    expect(belowEditor).toBe(false);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop indicator hides when cursor leaves the editor drop zone (right edge)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const editorBox = await page.locator('.dm-editor').boundingBox();
    expect(editorBox).not.toBeNull();
    if (!editorBox) return;

    // Far right of editor → hides
    const rightOfEditor = await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y }));
      return document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show');
    }, { x: editorBox.x + editorBox.width + 200, y: editorBox.y + editorBox.height / 2 });
    expect(rightOfEditor).toBe(false);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop indicator shows in the handle gutter (left of editor padding box)', async ({ page }) => {
    // The handle visually lives in a left gutter outside .dm-editor's
    // padding box (negative `left` in CSS). The drop zone gate must
    // include this gutter - otherwise dragging FROM the handle would
    // hide the indicator the moment the cursor sat over the handle.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const editorBox = await page.locator('.dm-editor').boundingBox();
    expect(editorBox).not.toBeNull();
    if (!editorBox) return;

    // 40px left of editor (within handle gutter, ≤ 80px tolerance) → shows
    expect(await probeIndicatorShown(page, editorBox.x - 40, editorBox.y + editorBox.height / 2)).toBe(true);

    // 200px left of editor (way past the gutter) → hides
    expect(await probeIndicatorShown(page, editorBox.x - 200, editorBox.y + editorBox.height / 2)).toBe(false);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop indicator round-trips: inside → outside → inside restores it', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const insideBox = await first.boundingBox();
    expect(insideBox).not.toBeNull();
    if (!insideBox) return;

    const probe = (x: number, y: number): Promise<boolean> => probeIndicatorShown(page, x, y);

    // Show
    expect(await probe(insideBox.x + insideBox.width / 2, insideBox.y + insideBox.height * 0.8)).toBe(true);
    // Hide
    expect(await probe(5, 5)).toBe(false);
    // Show again
    expect(await probe(insideBox.x + insideBox.width / 2, insideBox.y + insideBox.height * 0.8)).toBe(true);
    // Hide again
    expect(await probe(5, 5)).toBe(false);
    // Show again
    expect(await probe(insideBox.x + insideBox.width / 2, insideBox.y + insideBox.height * 0.8)).toBe(true);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop indicator hides when cursor leaves the editor drop zone (and reappears on re-entry)', async ({ page }) => {
    // The dragover listener is document-wide (so it catches cursor in the
    // side gutter where the handle lives). But the browser only fires the
    // `drop` event on the element under the cursor at release - if that's
    // outside `.dm-editor`, PM's handleDrop never runs and nothing
    // happens. We must NOT promise a drop when one cannot succeed.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await first.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    // 1. Cursor INSIDE editor → indicator shows.
    const insideBox = await first.boundingBox();
    expect(insideBox).not.toBeNull();
    if (!insideBox) return;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: insideBox.x + insideBox.width / 2,
      clientY: insideBox.y + insideBox.height * 0.8,
    });
    await expect(page.locator('.dm-block-drop-indicator')).toHaveAttribute('data-show', '');

    // 2. Cursor FAR OUTSIDE editor (top-left corner of viewport) →
    // indicator hidden. Synthesise the dragover via document.dispatchEvent
    // so the document-level listener attached during dragstart receives
    // it regardless of which element happens to be under the cursor.
    const afterOutside = await page.evaluate(() => {
      const evt = new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
      document.dispatchEvent(evt);
      return document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show');
    });
    expect(afterOutside).toBe(false);

    // 3. Cursor BACK inside editor → indicator restored.
    const afterInside = await probeIndicatorShown(
      page,
      insideBox.x + insideBox.width / 2,
      insideBox.y + insideBox.height * 0.8,
    );
    expect(afterInside).toBe(true);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop in the handle gutter (outside .ProseMirror, inside drop zone) reorders the block', async ({ page }) => {
    // The user's bug: cursor was in the left gutter (where the BlockHandle
    // visually sits at `left: -3.5rem`), the indicator showed a "drop will
    // land here" line, but releasing the mouse did nothing. Browser's
    // `drop` event fires on the element under the cursor - in the gutter,
    // that's `.notion-page` or `body`, NOT `.ProseMirror`, so PM's
    // `handleDrop` never ran. Fix: document-level drop listener performs
    // the move when the cursor is in our drop zone but outside PM's view.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Let the `setTimeout(0)` inside `onDragStart` commit `draggedFrom`
    // to plugin state. Without it `performBlockDrop` reads null and bails.
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const thirdBox = await third.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(thirdBox).not.toBeNull();
    if (!editorBox || !thirdBox) return;

    // Cursor is 40px LEFT of `.dm-editor` (in the handle gutter), at the
    // vertical mid-point of "Charlie" - so insertAfter is true and the
    // block should land at the end of the doc.
    const gutterX = editorBox.x - 40;
    const targetY = thirdBox.y + thirdBox.height * 0.8;

    // Multiple separate `evaluate` round-trips are CRITICAL: the
    // dragstart handler scheduled a `setTimeout(0)` that commits
    // `draggedFrom` to plugin state. Each await between Playwright calls
    // yields back to the browser long enough for that timer to fire.
    // Single combined evaluate would race ahead of the commit and
    // `performBlockDrop` would bail with `draggedFrom === null`.
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    await dt.dispose();
  });

  test('drop in the gutter targets a block ABOVE the dragged source (insert before)', async ({ page }) => {
    // Companion to the previous test (which dropped AFTER the third block).
    // Here we drop in the gutter at a Y above the source - expect the block
    // to land BEFORE that target. Verifies insertAfter=false path of the
    // document drop listener.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const second = page.locator(`${editorSelector} p:has-text("Bravo")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await third.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const secondBox = await second.boundingBox();
    expect(editorBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    if (!editorBox || !secondBox) return;

    // Cursor in left gutter at the upper half of "Bravo" → insertAfter=false
    // → after gap normalization, lands AFTER the previous sibling
    // ("Alpha"), which is structurally identical to "before Bravo".
    const gutterX = editorBox.x - 40;
    const targetY = secondBox.y + secondBox.height * 0.2;

    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Alpha', 'Charlie', 'Bravo']);
    await dt.dispose();
  });

  test('gutter drop preserves block id (UniqueID survives the move)', async ({ page }) => {
    // The doc-level drop path uses the same `moveBlock` helper as PM's
    // handleDrop - `transformAttrs` is not invoked, so the source's
    // UniqueID must remain intact. Critical because Copy-link relies
    // on stable ids; a doc-listener-induced regen would silently break
    // shared block links.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const idsBefore = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
        | undefined;
      const ids: string[] = [];
      ed?.state.doc.forEach((n) => { ids.push((n.attrs['id'] as string) ?? ''); });
      return ids;
    });

    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const thirdBox = await third.boundingBox();
    if (!editorBox || !thirdBox) return;

    const gutterX = editorBox.x - 40;
    const targetY = thirdBox.y + thirdBox.height * 0.8;
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    const idsAfter = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
        | undefined;
      const ids: string[] = [];
      ed?.state.doc.forEach((n) => { ids.push((n.attrs['id'] as string) ?? ''); });
      return ids;
    });

    // Same set of ids, just reordered - Alpha's id moved to position 2.
    expect(new Set(idsAfter)).toEqual(new Set(idsBefore));
    expect(idsAfter[2]).toBe(idsBefore[0]);
    await dt.dispose();
  });

  test('drop in the right-side gutter (margin between editor right edge and page edge) reorders', async ({ page }) => {
    // Mirror of the left-gutter case - the drop zone tolerance applies
    // on the right side too (16px). Notion-style demos often have
    // visible margin to the right of the centered editor; users can
    // drag into that margin and expect the drop to "stick".
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const thirdBox = await third.boundingBox();
    if (!editorBox || !thirdBox) return;

    // 8px right of `.dm-editor` (within the 16px right tolerance).
    const rightGutterX = editorBox.x + editorBox.width + 8;
    const targetY = thirdBox.y + thirdBox.height * 0.8;
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: rightGutterX, y: targetY });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: rightGutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    await dt.dispose();
  });

  test('two consecutive gutter drops in the same drag session - only the FIRST one moves the block', async ({ page }) => {
    // Once `drop` is processed, the drag is over (browser also fires
    // `dragend`). A subsequent `drop` event in the same session has no
    // `view.dragging` payload - the doc listener must bail. This guards
    // against a stale-state regression where a second synthesised drop
    // would still trigger another move using cached plugin state.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const thirdBox = await third.boundingBox();
    if (!editorBox || !thirdBox) return;

    const gutterX = editorBox.x - 40;
    const targetY = thirdBox.y + thirdBox.height * 0.8;
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    // First drop - should move.
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    // Second drop fired AFTER dragend - listeners are gone, view.dragging
    // is cleared. Should be a no-op.
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await page.waitForTimeout(80);

    const blocks = await getBlocks(page);
    // Single move only: Alpha at end.
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    await dt.dispose();
  });

  test('drop event arriving when no drag is active is silently ignored (defensive)', async ({ page }) => {
    // Spurious drop events (other UI sending `drop` to document, browser
    // bubble from an OS file drag, etc.) must not move a block when
    // `view.dragging` is null. Guards against the cleanup window between
    // dragend and the next user interaction.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const blocksBefore = await getBlocks(page);
    const editorBox = await page.locator('.dm-editor').boundingBox();
    if (!editorBox) return;

    // No dragstart fired - view.dragging is null. Dispatch a drop that
    // would otherwise look "valid" (in zone, valid coords).
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: editorBox.x - 30, y: editorBox.y + 100 });
    await page.waitForTimeout(80);

    const blocksAfter = await getBlocks(page);
    expect(blocksAfter.map((b) => b.text)).toEqual(blocksBefore.map((b) => b.text));
  });

  test('gutter drop reorders nested list items inside the same list', async ({ page }) => {
    // Verifies the new doc-listener path works for nested lists -
    // dragging via the per-item handle (with nested:true config) and
    // dropping in the gutter should reorder INSIDE the list, not promote
    // the item to a top-level sibling.
    await setContent(page, '<ul><li><p>Alpha</p></li><li><p>Bravo</p></li><li><p>Charlie</p></li></ul>');
    const first = page.locator(`${editorSelector} li:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} li:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);

    const editorBox = await page.locator('.dm-editor').boundingBox();
    const thirdBox = await third.boundingBox();
    if (!editorBox || !thirdBox) return;

    const gutterX = editorBox.x - 40;
    const targetY = thirdBox.y + thirdBox.height * 0.8;
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }, { x: gutterX, y: targetY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    // Doc still has ONE bulletList with three items reordered (no
    // promotion to top-level siblings).
    const blocks = await getBlocks(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('bulletList');
    // Order: Alpha moved to end.
    const liTexts = await page.locator(`${editorSelector} li`).allTextContents();
    expect(liTexts).toEqual(['Bravo', 'Charlie', 'Alpha']);
    await dt.dispose();
  });

  test('drop in .ProseMirror is handled exactly once (no double-drop with document listener)', async ({ page }) => {
    // Both PM's handleDrop AND the document-level drop listener could
    // theoretically run for the same release when the cursor is over PM.
    // PM runs first (target = view.dom), preventDefault is called, our
    // doc listener sees `defaultPrevented === true` and bails. End state
    // is one block move, not two.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const third = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const thirdBox = await third.boundingBox();
    expect(thirdBox).not.toBeNull();
    if (!thirdBox) return;

    // Drop directly on .ProseMirror (PM's normal handleDrop path).
    const cx = thirdBox.x + thirdBox.width / 2;
    const cy = thirdBox.y + thirdBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX: cx, clientY: cy });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX: cx, clientY: cy });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);

    const blocks = await getBlocks(page);
    // Single move: Alpha goes after Charlie. NOT double-moved.
    expect(blocks.map((b) => b.text)).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(blocks).toHaveLength(3);
    await dt.dispose();
  });

  test('drop OUTSIDE drop zone is a no-op even with the new document drop listener', async ({ page }) => {
    // Far outside the editor (corner of viewport) - gate fails, doc
    // listener bails, dragend fires without a move. Critical: the new
    // global drop listener must not "rescue" drops that the user
    // intentionally cancelled by dragging way out of the editor.
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const blocksBefore = await getBlocks(page);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.evaluate(() => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    const blocksAfter = await getBlocks(page);
    expect(blocksAfter.map((b) => b.text)).toEqual(blocksBefore.map((b) => b.text));
    await dt.dispose();
  });

  test('release outside the drop zone is a no-op (cancel gesture)', async ({ page }) => {
    // Companion to the test above: when the user drops outside the
    // editor, the document is unchanged. This pairs with the indicator
    // gate to make "drag out → release" a natural cancel motion (matches
    // Notion, Google Docs, Finder file drag).
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const first = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const blocksBefore = await getBlocks(page);
    await first.hover();
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    // Drop event on `body` (outside the editor) - PM's handleDrop never
    // runs because the event doesn't bubble through `.dm-editor`.
    await page.locator('body').dispatchEvent('drop', { dataTransfer: dt, clientX: 5, clientY: 5 });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    const blocksAfter = await getBlocks(page);
    expect(blocksAfter.map((b) => b.text)).toEqual(blocksBefore.map((b) => b.text));
    await dt.dispose();
  });

  test('drop indicator stays anchored at the same Y across the entire inter-block gap', async ({ page }) => {
    // Two top-level blocks with native CSS margins (h2 → p). The user's
    // bug report: dragging in the gap between them showed two distinct
    // indicator lines as the cursor crossed the gap midpoint, even
    // though both resolve to the SAME drop slot. Fix canonicalises the
    // resolved placement to the upper block + insertAfter=true, so the
    // indicator's `top` should stay constant anywhere in the gap.
    await setContent(page, '<h2>Heading</h2><p>Paragraph</p><p>Tail</p>');
    const heading = page.locator(`${editorSelector} h2:has-text("Heading")`);
    const paragraph = page.locator(`${editorSelector} p:has-text("Paragraph")`);

    await heading.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const handle = page.locator(dragBtnSelector);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const headingBox = await heading.boundingBox();
    const paragraphBox = await paragraph.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(paragraphBox).not.toBeNull();
    if (!headingBox || !paragraphBox) return;

    const gapTop = headingBox.y + headingBox.height;
    const gapBottom = paragraphBox.y;
    expect(gapBottom).toBeGreaterThan(gapTop);
    const gapMid = (gapTop + gapBottom) / 2;

    // Three cursor positions: heading's lower half, mid-gap, paragraph's
    // upper half. Pre-fix the indicator jumped between heading.bottom
    // and paragraph.top across these three points.
    const samples = [
      headingBox.y + headingBox.height * 0.8,
      gapMid,
      paragraphBox.y + paragraphBox.height * 0.2,
    ];
    const observedTops: string[] = [];
    for (const clientY of samples) {
      const clientX = headingBox.x + headingBox.width / 2;
      await page.locator(editorSelector).dispatchEvent('dragover', {
        dataTransfer: dt,
        clientX,
        clientY,
      });
      const top = await page.locator('.dm-block-drop-indicator').evaluate((el) => (el as HTMLElement).style.top);
      observedTops.push(top);
    }

    // All three samples should yield the EXACT same indicator Y - the
    // fix collapses both halves of the gap to a single canonical line.
    expect(new Set(observedTops).size).toBe(1);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('dragstart without a resolved hover is cancelled (no reorder)', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p>');
    // Reset the plugin hovered state explicitly via a no-op meta commit - no
    // hover happened, so `hoveredPos` is null.
    const blocksBefore = await getBlocks(page);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    // Make the handle exist (it is conditionally rendered), but do NOT
    // update hoveredPos. We append the handle by first hovering, then
    // wiping hover state before dispatching dragstart.
    await page.locator(`${editorSelector} p`).first().hover();
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { view: { state: { tr: unknown; plugins: Array<{ spec: { key?: { key: string } } }> }; dispatch: (tr: unknown) => void } }
        | undefined;
      if (!ed) return;
      // Find the BlockHandle plugin key and null out its hoveredPos.
      type PluginLike = { spec: { key?: { key: string } }; key?: unknown };
      const plugin = ed.view.state.plugins.find((p) => {
        const k = (p as unknown as PluginLike).spec.key?.key ?? '';
        return typeof k === 'string' && k.startsWith('blockHandle$');
      }) as PluginLike | undefined;
      if (!plugin) return;
      const key = (plugin as unknown as { key: unknown }).key ?? (plugin.spec.key as unknown);
      const tr = (ed.view.state.tr as { setMeta: (k: unknown, m: unknown) => unknown }).setMeta(
        key,
        { hoveredPos: null },
      );
      ed.view.dispatch(tr);
    });
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    const blocksAfter = await getBlocks(page);
    expect(blocksAfter.map((b) => b.text)).toEqual(blocksBefore.map((b) => b.text));
    await dt.dispose();
  });
});
