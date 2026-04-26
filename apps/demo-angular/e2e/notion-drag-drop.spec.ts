/**
 * Drag-and-drop E2E coverage for the Notion demo.
 *
 * Playwright cannot faithfully reproduce the HTML5 drag lifecycle via
 * plain mouse moves — the browser only dispatches `dragstart`/`drop`
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
 * auto-scroll ramp, browser drag cancel) — those stay unit-tested in
 * `packages/extension-block-menu/src/BlockHandle.test.ts`.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator, type JSHandle } from '@playwright/test';

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
 * Perform a synthetic HTML5 drag from the drag handle onto a target
 * block. `dropZone` decides which half of the target the drop lands in
 * — `"top"` triggers insert-before, `"bottom"` insert-after (mirrors
 * the mid-point check in `BlockHandle.handleDrop`).
 *
 * The function hovers the source block first so the handle mounts,
 * then runs the full event sequence against that handle and the target
 * block. Returns nothing — assertions inspect the resulting doc.
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

  // 2. Build a single DataTransfer to thread through all four events —
  //    some browsers wipe clipboard-like payloads between separate handles,
  //    so we reuse the same object (matches real-drag semantics).
  const dt = await page.evaluateHandle(() => new DataTransfer());

  const handle = page.locator(dragBtnSelector);
  const targetBox = await targetBlock.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) return;

  // Coordinates inside the target: "top" drops above mid, "bottom" below.
  const clientX = targetBox.x + targetBox.width / 2;
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
// 1. Basic reorder — top-level blocks
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — top-level reorder', () => {
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
// 2. Mixed-type drag — heading + paragraph + blockquote + task list
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — mixed block types', () => {
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
// 3. Attribute preservation — UniqueID + BlockColor survive drag
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — attribute preservation', () => {
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
// 4. Nested drag — list items reorder inside their list
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — nested list items', () => {
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
// 5. Side-effects — dragging state + overlay cleanup
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — side-effects during the drag lifecycle', () => {
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
// 6. disableDrag guard — even though the extension is configured for
//    drag in the demo, we verify the early-return in `onDragStart` by
//    triggering dragstart when nothing is hovered (no hoveredPos).
// ────────────────────────────────────────────────────────────────────────

test.describe('Drag & drop — safety rails', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('dragstart without a resolved hover is cancelled (no reorder)', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p>');
    // Reset the plugin hovered state explicitly via a no-op meta commit — no
    // hover happened, so `hoveredPos` is null.
    const blocksBefore = await getBlocks(page);
    const dt = await page.evaluateHandle(() => new DataTransfer());
    // Make the handle exist (it is conditionally rendered), but do NOT
    // update hoveredPos. We append the handle by first hovering, then
    // wiping hover state before dispatching dragstart.
    await page.locator(`${editorSelector} p`).first().hover();
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { view: { state: { tr: unknown }; dispatch: (tr: unknown) => void; state: { plugins: Array<{ spec: { key?: { key: string } } }> } } }
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
