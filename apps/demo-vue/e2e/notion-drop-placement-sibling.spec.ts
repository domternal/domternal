/**
 * E2E coverage for the drop-indent contract:
 *
 *   "Drags into the sibling zone (left half of the target) produce a
 *    `mode: 'sibling'` placement; the indicator stays solid + full-width.
 *    Drags into the nested zone (right of the X-threshold) flip to
 *    `mode: 'nested'` with a dashed indented indicator and dispatch the
 *    nested-child insert path."
 *
 * Assertions cover:
 *   1. Drop indicator is visible during a real drag-over.
 *   2. Sibling drops carry no `data-mode="nested"`; computed
 *      `border-top-style` is `solid`, not `dashed`.
 *   3. Each scenario's resulting doc structure matches the sibling-mode
 *      shape (reorder, cross-list-type adapt, nested handle lift, hr drag).
 *   4. Nested-zone X over a listItem flips `mode` to `'nested'` with the
 *      expected `targetItemPos` / `wrapperPos` set, and the actual drop
 *      transaction appends the dragged block as the target's last child.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator, type JSHandle } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '[data-testid="mode-notion"]';
const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';
const indicatorSelector = '.dm-block-drop-indicator';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await waitForStampedIds(page);
}

/**
 * The dragover -> drop-indicator repaint is rAF-coalesced, so the indicator
 * DOM updates on the NEXT animation frame, not synchronously after the
 * `dragover` event. Tests that read the indicator immediately must flush two
 * frames first (one for the coalescer's rAF to run, one to settle the write).
 */
async function flushIndicatorRaf(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((res) => {
      requestAnimationFrame(() => requestAnimationFrame(() => { res(); }));
    }),
  );
}

/**
 * Wait until every STAMPED top-level node has a UniqueID. UniqueID
 * doesn't stamp every node type (table, details), so we only block on
 * the well-known stamped ones.
 */
async function waitForStampedIds(page: Page): Promise<void> {
  const STAMPED = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule'];
  await page.waitForFunction((stamped) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => {
      if (stamped.includes(n.type.name) && !n.attrs['id']) ok = false;
    });
    return ok;
  }, STAMPED, { timeout: 3000 });
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await waitForStampedIds(page);
}

interface BlockSnapshot { type: string; text: string; attrs: Record<string, unknown> }

async function getBlocks(page: Page): Promise<BlockSnapshot[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    const out: BlockSnapshot[] = [];
    ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent, attrs: n.attrs }));
    return out;
  });
}

interface ListItemChildSnapshot { type: string; text: string; level?: number }

/** Children of the FIRST list item in the doc as `{type,text,level?}` records. */
async function firstListItemChildren(page: Page): Promise<ListItemChildSnapshot[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
      | undefined;
    const li = ed?.state.doc.firstChild?.firstChild;
    const out: ListItemChildSnapshot[] = [];
    for (let i = 0; i < (li?.childCount ?? 0); i++) {
      const c = li?.child(i);
      if (!c) continue;
      const rec: ListItemChildSnapshot = { type: c.type.name, text: c.textContent };
      if (c.type.name === 'heading') rec.level = c.attrs['level'] as number;
      out.push(rec);
    }
    return out;
  });
}

async function listItemTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { type: { name: string } } | null } | null } } }
      | undefined;
    const list = ed?.state.doc.firstChild;
    const out: string[] = [];
    for (let i = 0; i < (list?.childCount ?? 0); i++) {
      const li = list?.child(i);
      if (li) out.push(li.type.name);
    }
    return out;
  });
}

/**
 * Synthetic drag with explicit clientX so we can target sibling-zone
 * (left side) vs nested-zone (right side) deliberately.
 * `dropZone` decides Y bucket on the target (top vs bottom half).
 * `xZone` decides X bucket: 'left' lands on the sibling side; 'center'
 * is the existing default; 'right' targets the nested side.
 */
async function dragBlock(
  page: Page,
  sourceBlock: Locator,
  targetBlock: Locator,
  dropZone: 'top' | 'bottom' = 'bottom',
  xZone: 'left' | 'center' | 'right' = 'left',
): Promise<void> {
  await sourceBlock.hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);
  const targetBox = await targetBlock.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) return;

  const clientX =
    xZone === 'left' ? targetBox.x + 4
      : xZone === 'right' ? targetBox.x + targetBox.width - 4
        : targetBox.x + targetBox.width / 2;
  const clientY = dropZone === 'top'
    ? targetBox.y + targetBox.height * 0.2
    : targetBox.y + targetBox.height * 0.8;

  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
  await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(80);
  await dt.dispose();
}

/**
 * Drag-over WITHOUT dropping. Used to assert indicator state mid-drag.
 * Caller is responsible for ending the drag with `dragend` to clean up.
 */
async function startDragOver(page: Page, sourceBlock: Locator, targetBlock: Locator): Promise<{ handle: Locator; dt: JSHandle<DataTransfer> }> {
  await sourceBlock.hover();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);
  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  const targetBox = await targetBlock.boundingBox();
  if (!targetBox) throw new Error('target has no bounding box');
  const clientX = targetBox.x + 4;
  const clientY = targetBox.y + targetBox.height * 0.8;
  await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
  await flushIndicatorRaf(page);
  return { handle, dt };
}

async function endDrag(handle: Locator, dt: JSHandle<DataTransfer>): Promise<void> {
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await dt.dispose();
}

// ────────────────────────────────────────────────────────────────────────
// 1. Sibling-mode reorder produces same doc state as pre-Phase-2
// ────────────────────────────────────────────────────────────────────────

test.describe('drop placement - sibling-mode reorder', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('top-level paragraph reorder lands at sibling position (insertAfter)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const alpha = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const bravo = page.locator(`${editorSelector} p:has-text("Bravo")`);
    await dragBlock(page, alpha, bravo, 'bottom', 'left');
    expect((await getBlocks(page)).map((b) => b.text)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('top-level paragraph reorder lands at sibling position (insertBefore via canonical "after upper")', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const charlie = page.locator(`${editorSelector} p:has-text("Charlie")`);
    const alpha = page.locator(`${editorSelector} p:has-text("Alpha")`);
    await dragBlock(page, charlie, alpha, 'top', 'left');
    expect((await getBlocks(page)).map((b) => b.text)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });

  test('list item reorder within a bulletList stays inside same wrapper', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>');
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'top', 'left');

    // Doc still has ONE top-level block (the bulletList).
    expect((await getBlocks(page)).length).toBe(1);
    // List items reordered: [Two, One, Three].
    const texts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { forEach: (cb: (n: { textContent: string }) => void) => void } | null } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => out.push(n.textContent));
      return out;
    });
    expect(texts).toEqual(['Two', 'One', 'Three']);
  });

  test('cross-list-type drag (bullet item into task list) auto-converts to taskItem', async ({ page }) => {
    await setContent(page,
      '<ul><li><p>Bullet</p></li></ul>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );
    const bullet = page.locator(`${editorSelector} ul:not([data-type]) li`);
    const task = page.locator(`${editorSelector} ul[data-type="taskList"] li`);
    await dragBlock(page, bullet, task, 'top', 'left');

    // Two top-level lists, but the bullet item migrated into the task list as taskItem.
    const blocks = await getBlocks(page);
    const taskList = blocks.find((b) => b.type === 'taskList');
    expect(taskList).toBeDefined();
    // Confirm task list now holds two taskItems (Bullet adapted, Task stays).
    const taskListItems = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void }) => void) => void } } }
        | undefined;
      const out: { type: string; text: string }[] = [];
      ed?.state.doc.forEach((n) => {
        if (n.type.name === 'taskList') {
          n.forEach((li) => out.push({ type: li.type.name, text: li.textContent }));
        }
      });
      return out;
    });
    expect(taskListItems.every((x) => x.type === 'taskItem')).toBe(true);
    expect(taskListItems.map((x) => x.text)).toContain('Bullet');
    expect(taskListItems.map((x) => x.text)).toContain('Task');
  });

  test('horizontalRule (atom) drags to sibling slot', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><hr><p>Bravo</p>');
    const hr = page.locator(`${editorSelector} hr`);
    const bravo = page.locator(`${editorSelector} p:has-text("Bravo")`);
    await dragBlock(page, hr, bravo, 'bottom', 'left');
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'horizontalRule']);
    expect(blocks.map((b) => b.text)).toEqual(['Alpha', 'Bravo', '']);
  });

  test('heading drag preserves level and lands as sibling', async ({ page }) => {
    await setContent(page, '<h2>Title</h2><p>Body</p>');
    const heading = page.locator(`${editorSelector} h2`);
    const body = page.locator(`${editorSelector} p:has-text("Body")`);
    await dragBlock(page, heading, body, 'bottom', 'left');
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.text).toBe('Body');
    expect(blocks[1]?.type).toBe('heading');
    expect(blocks[1]?.attrs['level']).toBe(2);
    expect(blocks[1]?.text).toBe('Title');
  });

  test('inter-block gap drop canonicalises to "after upper sibling" (one indicator line, one drop slot)', async ({ page }) => {
    await setContent(page, '<p>One</p><p>Two</p><p>Three</p>');
    const three = page.locator(`${editorSelector} p:has-text("Three")`);
    const two = page.locator(`${editorSelector} p:has-text("Two")`);
    // Drop on UPPER quarter of "Two" - canonical path picks "One" with insertAfter.
    await dragBlock(page, three, two, 'top', 'left');
    expect((await getBlocks(page)).map((b) => b.text)).toEqual(['One', 'Three', 'Two']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Drop indicator visual state - solid line, NO data-mode="nested"
// ────────────────────────────────────────────────────────────────────────

test.describe('drop placement - indicator visual contract', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('indicator becomes visible during a drag-over inside the editor', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
    );
    await expect(page.locator(indicatorSelector)).toHaveAttribute('data-show', '');
    await endDrag(handle, dt);
  });

  test('indicator carries data-mode="sibling" on top-level paragraph target (X-detection only fires on list items)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
    );
    // `data-mode` is set so e2e + theme CSS can read placement mode.
    // Top-level paragraph targets always stay sibling because X-threshold
    // detection only fires when the resolved target is a list item.
    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('sibling');
    await endDrag(handle, dt);
  });

  test('indicator computed border-top-style is solid (not dashed) - dashed is reserved for nested mode', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
    );

    const styleInfo = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      const cs = getComputedStyle(el);
      return {
        borderTopStyle: cs.borderTopStyle,
        backgroundColor: cs.backgroundColor,
      };
    });
    expect(styleInfo).not.toBeNull();
    expect(styleInfo?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator hides after drop completes', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    await dragBlock(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
      'bottom',
      'left',
    );
    // After drop, the indicator's data-show flips off.
    const visible = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show'),
    );
    expect(visible).toBe(false);
  });

  test('indicator left/width measure the resolved block (sibling = full block width, NOT indented)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
    );

    const measure = await page.evaluate(() => {
      const ind = document.querySelector('.dm-block-drop-indicator');
      const target = document.querySelector('.dm-editor .ProseMirror');
      if (!(ind instanceof HTMLElement) || !(target instanceof HTMLElement)) return null;
      const indStyle = ind.style;
      return {
        // Sibling-mode indicator left/width come from the resolved block's
        // rect (full width). Nested mode shrinks width and offsets left.
        leftPx: parseFloat(indStyle.left),
        widthPx: parseFloat(indStyle.width),
      };
    });
    expect(measure).not.toBeNull();
    // Width is positive and substantial (full block width column).
    expect(measure!.widthPx).toBeGreaterThan(50);
    await endDrag(handle, dt);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2b. Indicator visual contract across DIFFERENT TARGET TYPES
//     Indicator must stay solid + carry NO data-mode="nested" no matter
//     which `computeDropPlacement` return path produced the placement.
// ────────────────────────────────────────────────────────────────────────

test.describe('drop placement - indicator contract across target types', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('indicator over a LIST ITEM target with X in sibling-zone stays solid + data-mode="sibling"', async ({ page }) => {
    await setContent(page, '<p>Top</p><ul><li><p>Item</p></li></ul>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Top")`),
      page.locator(`${editorSelector} li:has-text("Item")`),
    );
    const info = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      return {
        show: el.hasAttribute('data-show'),
        mode: el.getAttribute('data-mode'),
        borderTopStyle: getComputedStyle(el).borderTopStyle,
      };
    });
    expect(info?.show).toBe(true);
    // startDragOver lands clientX at targetBox.x + 4 (left of bullet marker),
    // well below the default 28px nestThreshold - placement stays sibling.
    expect(info?.mode).toBe('sibling');
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator over a NESTED HEADING (inside list item) resolves to nesting into the parent item', async ({ page }) => {
    // List item with [label paragraph, nested h2]. The slot model does not
    // make the nested heading an independent row, so its region belongs to the
    // parent list item: a drop there nests into the item (dashed) at the child
    // slot next to the heading. startDragOver lands X at the heading's own
    // indent, which is already past the nest threshold relative to the item.
    await setContent(page, '<p>Top</p><ul><li><p>Label</p><h2>Nested</h2></li></ul>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Top")`),
      page.locator(`${editorSelector} h2:has-text("Nested")`),
    );
    const info = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      return {
        show: el.hasAttribute('data-show'),
        mode: el.getAttribute('data-mode'),
        borderTopStyle: getComputedStyle(el).borderTopStyle,
      };
    });
    expect(info?.show).toBe(true);
    expect(info?.mode).toBe('nested');
    await endDrag(handle, dt);
  });

  test('indicator over a TASK LIST target with X in sibling-zone stays solid + data-mode="sibling"', async ({ page }) => {
    await setContent(page,
      '<p>Top</p><ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Top")`),
      page.locator(`${editorSelector} li[data-type="taskItem"]`),
    );
    const info = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      return {
        show: el.hasAttribute('data-show'),
        mode: el.getAttribute('data-mode'),
        borderTopStyle: getComputedStyle(el).borderTopStyle,
      };
    });
    expect(info?.show).toBe(true);
    // startDragOver lands clientX at targetBox.x + 4 (left of bullet marker),
    // well below the default 28px nestThreshold - placement stays sibling.
    expect(info?.mode).toBe('sibling');
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator when dragging FROM a nested handle source onto a top-level paragraph stays sibling', async ({ page }) => {
    // Plan-2 nested handle: hover the nested heading to surface its own
    // handle, then drag onto a top-level paragraph. Paragraph target is
    // not in LIST_ITEM_TYPES so X-detection skips and mode stays sibling
    // regardless of clientX.
    await setContent(page, '<ul><li><p>Label</p><h2>Nested</h2></li></ul><p>Bottom</p>');
    const nested = page.locator(`${editorSelector} h2:has-text("Nested")`);
    const target = page.locator(`${editorSelector} p:has-text("Bottom")`);
    const { handle, dt } = await startDragOver(page, nested, target);
    const info = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      return {
        show: el.hasAttribute('data-show'),
        mode: el.getAttribute('data-mode'),
        borderTopStyle: getComputedStyle(el).borderTopStyle,
      };
    });
    expect(info?.show).toBe(true);
    // startDragOver lands clientX at targetBox.x + 4 (left of bullet marker),
    // well below the default 28px nestThreshold - placement stays sibling.
    expect(info?.mode).toBe('sibling');
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('drop ABOVE the first block (closest-by-Y fallback) produces sibling placement', async ({ page }) => {
    // Cursor above the first block triggers the closest-by-Y fallback
    // inside resolveTopLevelByY. That return path also commits to
    // mode='sibling'. We assert via the resulting reorder.
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const bravo = page.locator(`${editorSelector} p:has-text("Bravo")`);
    const alpha = page.locator(`${editorSelector} p:has-text("Alpha")`);
    // Y above Alpha's mid (top-zone) - closest-by-Y resolves to Alpha.
    await dragBlock(page, bravo, alpha, 'top', 'left');
    expect((await getBlocks(page)).map((b) => b.text)).toEqual(['Bravo', 'Alpha']);
  });

  test('drop BELOW the last block (closest-by-Y fallback) produces sibling placement', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    const alpha = page.locator(`${editorSelector} p:has-text("Alpha")`);
    const charlie = page.locator(`${editorSelector} p:has-text("Charlie")`);
    await dragBlock(page, alpha, charlie, 'bottom', 'left');
    expect((await getBlocks(page)).map((b) => b.text)).toEqual(['Bravo', 'Charlie', 'Alpha']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// X-threshold detection flips mode to "nested"
//     The placement carries `mode: 'nested'` (visible on the indicator
//     via `data-mode='nested'`) when the cursor sits >= 28px from the
//     left edge of a listItem / taskItem rect.
// ────────────────────────────────────────────────────────────────────────

test.describe('X-detection - nested mode flip on list-item targets', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  /**
   * Helper: read the indicator's data-mode after a synthetic drag-over
   * at an exact clientX (px from the target's left edge).
   */
  async function modeAtX(
    page: Page,
    sourceLocator: Locator,
    targetLocator: Locator,
    xOffsetFromLeft: number,
  ): Promise<{ mode: string | null; show: boolean }> {
    await sourceLocator.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await targetLocator.boundingBox();
    if (!targetBox) throw new Error('target has no bounding box');
    const clientX = targetBox.x + xOffsetFromLeft;
    // Lower half = the "after" gap, where the slot model offers nesting into
    // the target item (the gap-first model nests at an item's bottom edge).
    const clientY = targetBox.y + targetBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await flushIndicatorRaf(page);
    const result = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return { mode: null, show: false };
      return { mode: el.getAttribute('data-mode'), show: el.hasAttribute('data-show') };
    });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
    return result;
  }

  test('X >= 28px (default threshold) over a bulletList listItem flips data-mode to "nested"', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
      40, // well past 28px threshold
    );
    expect(result.show).toBe(true);
    expect(result.mode).toBe('nested');
  });

  test('X < 28px (sibling zone) over a listItem keeps data-mode "sibling"', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
      4, // before bullet marker
    );
    expect(result.show).toBe(true);
    expect(result.mode).toBe('sibling');
  });

  test('X just past threshold (30px) flips to nested - boundary precision in unit suite', async ({ page }) => {
    // Real browser layout has CSS padding / margin that makes the
    // listItem rect.left fuzzy by a pixel or two relative to Playwright's
    // boundingBox.x. Use 30 (clearly past 28) here; the >= 28 boundary
    // semantics are pinned by unit tests where rect.left is mocked to 0.
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
      30,
    );
    expect(result.mode).toBe('nested');
  });

  test('X >= 28px over a TASK ITEM flips data-mode to "nested" (parity with bulletList)', async ({ page }) => {
    await setContent(page,
      '<p>Source</p><ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li[data-type="taskItem"]`),
      40,
    );
    expect(result.mode).toBe('nested');
  });

  test('X >= 28px over an ORDERED list item flips data-mode to "nested"', async ({ page }) => {
    await setContent(page, '<p>Source</p><ol><li><p>One</p></li></ol>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} ol li:has-text("One")`),
      40,
    );
    expect(result.mode).toBe('nested');
  });

  test('X >= 28px over a HEADING (not a list item) keeps data-mode "sibling"', async ({ page }) => {
    // X-detection only fires when the resolved target type is in
    // LIST_ITEM_TYPES. Heading targets stay sibling regardless of X.
    await setContent(page, '<p>Source</p><h2>Title</h2>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} h2`),
      80,
    );
    expect(result.mode).toBe('sibling');
  });

  test('X >= 28px over a top-level PARAGRAPH keeps data-mode "sibling"', async ({ page }) => {
    await setContent(page, '<p>Source</p><p>Target</p>');
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} p:has-text("Target")`),
      80,
    );
    expect(result.mode).toBe('sibling');
  });

  test('mode flips realtime within a single drag (sibling X then nested X then sibling X)', async ({ page }) => {
    // Single dragstart, multiple dragovers at different X. Verifies the
    // indicator updates each tick (no debouncing / cache).
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');

    async function readMode(xOffset: number): Promise<string | null> {
      await page.locator(editorSelector).dispatchEvent('dragover', {
        dataTransfer: dt,
        clientX: targetBox!.x + xOffset,
        clientY: targetBox!.y + targetBox!.height * 0.8,
      });
      await flushIndicatorRaf(page);
      return page.evaluate(
        () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode') ?? null,
      );
    }

    expect(await readMode(4)).toBe('sibling'); // sibling zone
    expect(await readMode(40)).toBe('nested'); // nested zone
    expect(await readMode(10)).toBe('sibling'); // back to sibling
    expect(await readMode(60)).toBe('nested'); // back to nested

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('drop with X in nested zone: source becomes a NESTED CHILD of the target list item', async ({ page }) => {
    // The drop handler reads `placement.mode` and dispatches via
    // `insertAsListItemChild`. Source paragraph is appended as the LAST
    // child of the target listItem - the bulletList still has exactly
    // one listItem, but that listItem now holds [label, source].
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    const clientX = targetBox.x + 50; // nested zone
    const clientY = targetBox.y + targetBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // Doc state: single bulletList → single listItem → [label, nested paragraph].
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { childCount: number; firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const li = ul?.firstChild;
      const out: { topCount: number | undefined; ulItems: number | undefined; liChildren: { type: string; text: string }[] } = {
        topCount: ed?.state.doc.childCount,
        ulItems: ul?.childCount,
        liChildren: [],
      };
      for (let i = 0; i < (li?.childCount ?? 0); i++) {
        const c = li?.child(i);
        if (c) out.liChildren.push({ type: c.type.name, text: c.textContent });
      }
      return out;
    });
    expect(tree.topCount).toBe(1);
    expect(tree.ulItems).toBe(1); // SINGLE listItem - source merged as nested child
    expect(tree.liChildren).toEqual([
      { type: 'paragraph', text: 'Target' },
      { type: 'paragraph', text: 'Source' },
    ]);
  });

  test('source = NESTED HANDLE (heading inside listItem) drag onto different listItem with nested-zone X flips to nested', async ({ page }) => {
    // Cross-cutting test: plan 2 nested handle (drag source = nested
    // heading inside list item) AND plan 3 X-detection (drop target =
    // different list item with X in nested zone). Both contracts must
    // compose: handle resolves to the inner heading; placement on the
    // other list item commits to nested mode.
    await setContent(page,
      '<ul><li><p>A label</p><h2>Nested heading</h2></li><li><p>B label</p></li></ul>',
    );
    const result = await modeAtX(
      page,
      page.locator(`${editorSelector} h2:has-text("Nested heading")`),
      page.locator(`${editorSelector} li:has-text("B label")`),
      40, // nested-zone X
    );
    expect(result.mode).toBe('nested');
  });

  test('target = listItem WITH nested children ([label, h2]) flips to nested when X in nested zone', async ({ page }) => {
    // The nested-mode target check looks at the TOP-LEVEL listItem rect
    // and only requires the resolved type to be in LIST_ITEM_TYPES. A
    // listItem that already holds nested children (label + h2) is still
    // a list item; clientY landing on the LABEL portion (rather than
    // the nested heading) keeps the resolver on the listItem.
    await setContent(page,
      '<p>Source</p><ul><li><p>Label</p><h2>Existing</h2></li></ul>',
    );
    const target = page.locator(`${editorSelector} li:has-text("Label")`);
    await page.locator(`${editorSelector} p:has-text("Source")`).hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    // Aim Y at the item's lower band (its "after" gap), X past threshold, so
    // the slot model nests into the item.
    const clientX = targetBox.x + 40;
    const clientY = targetBox.y + targetBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await flushIndicatorRaf(page);

    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('nested');

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('gap-aware nesting: lower-half + right-zone X nests into the target; upper-half is a sibling before it', async ({ page }) => {
    // The slot model is position-aware: nesting into an item is offered at its
    // AFTER gap (lower half). The upper half is the "before" gap, a plain
    // sibling. So Y-mid is NOT ignored (unlike the old append-last model).
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>');
    const third = page.locator(`${editorSelector} li:has-text("Three")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);

    // Lower-half + right-zone X: Three nests into One (One gains a nested list).
    await dragBlock(page, third, first, 'bottom', 'right');
    const lowerHalfResult = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; firstChild: { childCount: number; lastChild: { type: { name: string } } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const firstLi = ul?.firstChild;
      return {
        ulItems: ul?.childCount,
        firstLiLastChildType: firstLi?.lastChild?.type.name,
      };
    });
    expect(lowerHalfResult.ulItems).toBe(2); // One (now with sublist), Two
    expect(lowerHalfResult.firstLiLastChildType).toBe('bulletList');

    // Upper-half + right-zone X: Three lands as a sibling BEFORE One, not nested.
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>');
    const thirdAgain = page.locator(`${editorSelector} li:has-text("Three")`);
    const firstAgain = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, thirdAgain, firstAgain, 'top', 'right');
    const upperTexts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { forEach: (cb: (n: { textContent: string }) => void) => void } | null } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => out.push(n.textContent));
      return out;
    });
    expect(upperTexts).toEqual(['Three', 'One', 'Two']); // sibling before One, flat
  });

  test('SELF-DROP: drag listItem onto ITSELF with nested-zone X - moveBlockAsNestedChild guard returns false, doc unchanged', async ({ page }) => {
    // The placement still reports mode='nested' because the resolver
    // doesn't know "source == target". `moveBlockAsNestedChild`
    // catches the self-drop (target inside source range) and returns
    // false; performBlockDrop falls through to the sibling path which
    // ALSO no-ops (moveBlock has its own self-drop guard). Doc intact.
    await setContent(page, '<ul><li><p>Solo</p></li></ul>');
    const solo = page.locator(`${editorSelector} li:has-text("Solo")`);
    await solo.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await solo.boundingBox();
    if (!targetBox) throw new Error('no target box');
    const clientX = targetBox.x + 40; // nested zone
    const clientY = targetBox.y + targetBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await flushIndicatorRaf(page);
    // Indicator carries data-mode='nested' even though the drop will be a no-op.
    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('nested');

    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // Doc state intact: still one listItem with text "Solo".
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; firstChild: { textContent: string } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      return { liCount: ul?.childCount, firstText: ul?.firstChild?.textContent };
    });
    expect(tree.liCount).toBe(1);
    expect(tree.firstText).toBe('Solo');
  });

  test('EMPTY LIST ITEM target (label paragraph blank) with nested-zone X still flips to nested', async ({ page }) => {
    // Empty label paragraph collapses vertically but the listItem rect
    // still has height from CSS line-height (so the rect is non-zero
    // and X-detection can run normally).
    await setContent(page, '<p>Source</p><ul><li><p></p></li></ul>');
    const empty = page.locator(`${editorSelector} li`);
    await page.locator(`${editorSelector} p:has-text("Source")`).hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await empty.boundingBox();
    if (!targetBox) throw new Error('no target box');
    const clientX = targetBox.x + 40;
    const clientY = targetBox.y + targetBox.height * 0.8;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await flushIndicatorRaf(page);
    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('nested');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('hidden indicator state: drop OUTSIDE editor (cursor far above) keeps placement null and clears data-mode', async ({ page }) => {
    await setContent(page, '<ul><li><p>Item</p></li></ul>');
    const source = page.locator(`${editorSelector} li:has-text("Item")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });

    const editorBox = await page.locator('.dm-editor').boundingBox();
    if (!editorBox) throw new Error('no editor box');

    // First dragover INSIDE editor sets data-mode.
    const targetBox = await source.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const insideMode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(insideMode).toBe('nested');

    // Second dragover FAR OUTSIDE clears `data-show` (placement null).
    // Note: the document-level dragover listener (auto-scroll path) also
    // calls hideDropIndicator on out-of-zone Y so the data-show flips off.
    await page.evaluate(({ x, y }) => {
      document.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientX: x, clientY: y }));
    }, { x: editorBox.x + editorBox.width / 2, y: editorBox.y - 200 });
    const outsideShow = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.hasAttribute('data-show'),
    );
    expect(outsideShow).toBe(false);

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Indicator VISUAL contract for nested mode
//     `[data-mode='nested']` swaps the solid full-width line for a
//     dashed indented line so the user sees "drop will land as nested
//     child" instead of "drop will land as sibling between blocks".
// ────────────────────────────────────────────────────────────────────────

test.describe('indicator visual - dashed indented line in nested mode', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  /**
   * Helper: read indicator computed style + position info during an
   * active drag-over. Returns only the fields relevant to nested-mode
   * visual assertions.
   */
  async function indicatorInfo(page: Page): Promise<{
    mode: string | null;
    borderTopStyle: string;
    backgroundColor: string;
    leftPx: number;
    widthPx: number;
    topPx: number;
  } | null> {
    return page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      const cs = getComputedStyle(el);
      return {
        mode: el.getAttribute('data-mode'),
        borderTopStyle: cs.borderTopStyle,
        backgroundColor: cs.backgroundColor,
        leftPx: parseFloat(el.style.left || '0'),
        widthPx: parseFloat(el.style.width || '0'),
        topPx: parseFloat(el.style.top || '0'),
      };
    });
  }

  test('indicator over a listItem with nested-zone X has DASHED border-top + transparent background', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40, // nested zone
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');
    expect(info?.borderTopStyle).toBe('dashed');
    // backgroundColor in computed style appears as `rgba(0, 0, 0, 0)` for transparent.
    expect(info?.backgroundColor).toMatch(/^(rgba\(0, 0, 0, 0\)|transparent)$/);
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('indicator over a listItem with sibling-zone X has SOLID line (not dashed)', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 4, // sibling zone (before bullet marker)
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('sibling');
    expect(info?.borderTopStyle).not.toBe('dashed');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator is INDENTED 24px from the resolved block left edge', async ({ page }) => {
    // List-item source: its sibling drop stays at the item column, so the
    // nested line's 24px indent is measurable against that reference. (A
    // non-list source lifts its sibling line out to the list's parent column
    // by design, so it isn't the right yardstick for the nested indent.)
    await setContent(page, '<ul><li><p>Source</p></li><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} li:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);

    // Compare nested left vs sibling left for the same target. Use a
    // separate dragover with sibling-zone X to capture the sibling left.
    const nestedLeft = (await indicatorInfo(page))?.leftPx ?? 0;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 4,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const siblingLeft = (await indicatorInfo(page))?.leftPx ?? 0;
    // Nested indents by 24px (matches --dm-block-children-indent).
    expect(nestedLeft - siblingLeft).toBeCloseTo(24, 0);
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator width is 24px NARROWER than sibling-mode width over same target', async ({ page }) => {
    // List-item source so the sibling reference stays at the item column (see
    // the indent test above for why a non-list source isn't comparable here).
    await setContent(page, '<ul><li><p>Source</p></li><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} li:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const nestedWidth = (await indicatorInfo(page))?.widthPx ?? 0;
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 4,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const siblingWidth = (await indicatorInfo(page))?.widthPx ?? 0;
    expect(siblingWidth - nestedWidth).toBeCloseTo(24, 0);
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator over a single-child item anchors at the item bottom (append slot)', async ({ page }) => {
    // A childless item has only the label, so nesting appends as its single
    // extra child and the dashed line sits at the item's bottom edge.
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');

    // Lower half + nested-zone X -> nest into the item at its "after" gap.
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');

    // Line sits at the item's bottom edge (editor-relative), within 2px.
    const itemBottom = await page.evaluate(() => {
      const li = document.querySelector('.ProseMirror li');
      const editor = document.querySelector('.dm-editor');
      if (!(li instanceof HTMLElement) || !(editor instanceof HTMLElement)) return -1;
      return li.getBoundingClientRect().bottom - editor.getBoundingClientRect().top;
    });
    expect(Math.abs((info?.topPx ?? 0) - itemBottom)).toBeLessThanOrEqual(2);
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('mode flip mid-drag: visual style swaps from solid to dashed and back without artefacts', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');

    async function readBorderTopStyle(xOffset: number): Promise<string> {
      await page.locator(editorSelector).dispatchEvent('dragover', {
        dataTransfer: dt,
        clientX: targetBox!.x + xOffset,
        clientY: targetBox!.y + targetBox!.height * 0.8,
      });
      await flushIndicatorRaf(page);
      return page.evaluate(() => {
        const el = document.querySelector('.dm-block-drop-indicator');
        if (!(el instanceof HTMLElement)) return '';
        return getComputedStyle(el).borderTopStyle;
      });
    }
    const sibling1 = await readBorderTopStyle(4);
    const nested1 = await readBorderTopStyle(40);
    const sibling2 = await readBorderTopStyle(10);
    const nested2 = await readBorderTopStyle(50);
    expect(sibling1).not.toBe('dashed');
    expect(nested1).toBe('dashed');
    expect(sibling2).not.toBe('dashed');
    expect(nested2).toBe('dashed');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator over an ORDERED LIST item also dashed + indented (parity with bulletList)', async ({ page }) => {
    await setContent(page, '<p>Source</p><ol><li><p>One</p></li></ol>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} ol li:has-text("One")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');
    expect(info?.borderTopStyle).toBe('dashed');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator: box-shadow REMOVED (sibling uses glow, nested is bare dashed line)', async ({ page }) => {
    // Sibling style includes a soft `box-shadow: 0 0 0 1px ...` glow so
    // the solid line reads on top of background colours. Nested mode
    // drops the glow because the dashed line + transparent bg is
    // already distinct enough; keeping the shadow would render as a
    // halo around an empty box, which looks broken.
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');

    // Sibling-zone X first - assert sibling has a non-trivial box-shadow.
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 4,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const siblingShadow = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      return el instanceof HTMLElement ? getComputedStyle(el).boxShadow : '';
    });
    expect(siblingShadow).not.toBe('none');
    expect(siblingShadow).not.toBe('');

    // Nested-zone X next - shadow gone.
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const nestedShadow = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      return el instanceof HTMLElement ? getComputedStyle(el).boxShadow : '';
    });
    expect(nestedShadow).toBe('none');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator: border-radius 0 (sibling has 1px rounding)', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li:has-text("Target")`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const radius = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      return el instanceof HTMLElement ? getComputedStyle(el).borderTopLeftRadius : '';
    });
    expect(radius).toBe('0px');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator over an EMPTY list item (label paragraph blank) anchors at rect.bottom from line-height', async ({ page }) => {
    // Empty paragraph collapses textually but the listItem rect has
    // height from line-height. Indicator must still anchor at the rect
    // bottom and indent the same way.
    await setContent(page, '<p>Source</p><ul><li><p></p></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    expect(targetBox.height).toBeGreaterThan(8); // line-height keeps it non-collapsed
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');
    expect(info?.borderTopStyle).toBe('dashed');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('nested-mode indicator over a listItem WITH existing nested children anchors at the FIRST-CHILD gap when hovering the label band (position-aware)', async ({ page }) => {
    // listItem with [label paragraph, nested h2]. Hovering the LABEL band
    // picks the first-child slot (insert BEFORE the existing h2), so the
    // dashed line anchors at the label's bottom edge (the top of the gap
    // between the label and the existing nested heading), NOT at the item's
    // overall bottom. (Position-aware nested drop; the old append-only
    // behaviour always drew at the item bottom.)
    await setContent(page, '<p>Source</p><ul><li><p>Label</p><h2>Existing</h2></li></ul>');
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const liTarget = page.locator(`${editorSelector} li`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const liBox = await liTarget.boundingBox();
    if (!liBox) throw new Error('no li box');

    // Aim Y just below the label's bottom (the first-child gap, before the
    // existing heading): past the label mid so the item's "after" gap engages,
    // and below the heading mid so resolveChildSlot picks childIndex 1.
    const labelBottom = await page.evaluate(() => {
      const label = document.querySelector('.ProseMirror li > p');
      return label instanceof HTMLElement ? label.getBoundingClientRect().bottom : 0;
    });
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: liBox.x + 40,
      clientY: labelBottom + 3,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');

    // Indicator top should equal the LABEL paragraph's bottom edge (the
    // first-child gap), in editor-relative coordinates.
    const expectedTop = await page.evaluate(() => {
      const label = document.querySelector('.ProseMirror li > p');
      const editor = document.querySelector('.dm-editor');
      if (!(label instanceof HTMLElement) || !(editor instanceof HTMLElement)) return -1;
      return label.getBoundingClientRect().bottom - editor.getBoundingClientRect().top;
    });
    expect(expectedTop).toBeGreaterThan(0);
    expect(Math.abs((info?.topPx ?? 0) - expectedTop)).toBeLessThanOrEqual(2);
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('indicator has CSS transition on position properties (smooth glide on mode flip / target change)', async ({ page }) => {
    // Indicator transitions left/width/top/transform on every reposition
    // so mode flips and target changes mid-drag glide smoothly. Style
    // swaps (background, border) stay instant so the sibling↔nested
    // boundary is readable.
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li`),
    );
    const transition = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-drop-indicator');
      if (!(el instanceof HTMLElement)) return null;
      const cs = getComputedStyle(el);
      return {
        property: cs.transitionProperty,
        duration: cs.transitionDuration,
      };
    });
    expect(transition).not.toBeNull();
    // Browsers comma-join multi-property transitions; check each axis.
    expect(transition?.property).toContain('left');
    expect(transition?.property).toContain('width');
    expect(transition?.property).toContain('top');
    expect(transition?.property).toContain('transform');
    // 80ms duration on each axis; computed value comes back like "0.08s, 0.08s, 0.08s, 0.08s".
    expect(transition?.duration).toContain('0.08s');
    await endDrag(handle, dt);
  });

  test('nested-mode indicator over a TASK ITEM target also dashed + indented', async ({ page }) => {
    await setContent(page,
      '<p>Source</p><ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );
    const source = page.locator(`${editorSelector} p:has-text("Source")`);
    const target = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    await source.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('no target box');
    await page.locator(editorSelector).dispatchEvent('dragover', {
      dataTransfer: dt,
      clientX: targetBox.x + 40,
      clientY: targetBox.y + targetBox.height * 0.8,
    });
    await flushIndicatorRaf(page);
    const info = await indicatorInfo(page);
    expect(info?.mode).toBe('nested');
    expect(info?.borderTopStyle).toBe('dashed');
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Nested drop transaction matrix. Source types appended as last child
// of the target list item via insertAsListItemChild.
// ────────────────────────────────────────────────────────────────────────

test.describe('nested drop matrix - source types appended as last child', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  /**
   * Drop helper: drag from source onto target with explicit nested-zone X.
   * Returns the editor's top-level + first-listItem-children snapshot.
   */
  async function dropNested(
    page: Page,
    sourceLocator: Locator,
    targetLocator: Locator,
  ): Promise<void> {
    await sourceLocator.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await targetLocator.boundingBox();
    if (!targetBox) throw new Error('no target box');
    const clientX = targetBox.x + 50; // nested zone
    // Aim Y just above the item's bottom edge (its "after" gap, below every
    // existing child mid) so the slot model nests and resolveChildSlot appends
    // the dragged block as the item's last child even as the item grows.
    const clientY = targetBox.y + targetBox.height - 3;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();
  }

  test('paragraph dropped onto listItem with nested-zone X becomes nested child', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
    );
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'Target' },
      { type: 'paragraph', text: 'Source' },
    ]);
  });

  test('heading dropped onto listItem with nested-zone X preserves level + becomes nested child', async ({ page }) => {
    await setContent(page, '<h2>Title</h2><ul><li><p>Item</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} h2`),
      page.locator(`${editorSelector} li:has-text("Item")`),
    );
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'Item' },
      { type: 'heading', text: 'Title', level: 2 },
    ]);
  });

  test('codeBlock dropped onto listItem with nested-zone X becomes nested child', async ({ page }) => {
    await setContent(
      page,
      '<pre><code class="language-typescript">const x = 1;</code></pre><ul><li><p>L</p></li></ul>',
    );
    await dropNested(
      page,
      page.locator(`${editorSelector} pre`),
      page.locator(`${editorSelector} li:has-text("L")`),
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const last = li?.lastChild;
      return {
        liChildren: li?.childCount,
        lastType: last?.type.name,
        lastText: last?.textContent,
        lastLanguage: last?.attrs['language'],
      };
    });
    expect(tree).toEqual({
      liChildren: 2,
      lastType: 'codeBlock',
      lastText: 'const x = 1;',
      lastLanguage: 'typescript',
    });
  });

  test('blockquote dropped onto listItem with nested-zone X becomes nested child', async ({ page }) => {
    await setContent(page, '<blockquote><p>Quote</p></blockquote><ul><li><p>L</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} blockquote`),
      page.locator(`${editorSelector} li:has-text("L")`),
    );
    const lastType = await page.evaluate(
      () => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { state: { doc: { firstChild: { firstChild: { lastChild: { type: { name: string } } | null } | null } | null } } }
          | undefined;
        return ed?.state.doc.firstChild?.firstChild?.lastChild?.type.name;
      },
    );
    expect(lastType).toBe('blockquote');
  });

  test('horizontalRule (atom) dropped onto listItem with nested-zone X becomes nested child', async ({ page }) => {
    await setContent(page, '<hr><ul><li><p>L</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} hr`),
      page.locator(`${editorSelector} li:has-text("L")`),
    );
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'L' },
      { type: 'horizontalRule', text: '' },
    ]);
  });

  test('listItem source dropped onto another listItem with nested-zone X wraps in fresh nested bulletList', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} li:has-text("Two")`),
      page.locator(`${editorSelector} li:has-text("One")`),
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; firstChild: { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const li = ul?.firstChild;
      return {
        ulItems: ul?.childCount,
        liChildren: li?.childCount,
        liLabelText: li?.firstChild?.textContent,
        nestedListType: li?.lastChild?.type.name,
        nestedFirstItemType: li?.lastChild?.firstChild?.type.name,
        nestedFirstItemText: li?.lastChild?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      ulItems: 1, // Two collapsed into nested ul of One
      liChildren: 2, // [paragraph "One", nested bulletList]
      liLabelText: 'One',
      nestedListType: 'bulletList',
      nestedFirstItemType: 'listItem',
      nestedFirstItemText: 'Two',
    });
  });

  test('cross-list-type: bullet listItem dropped onto taskItem with nested-zone X wraps in fresh nested taskList with adapted taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet</p></li></ul>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
    );
    await dropNested(
      page,
      page.locator(`${editorSelector} ul:not([data-type="taskList"]) li`),
      page.locator(`${editorSelector} li[data-type="taskItem"]`),
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; firstChild: { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } | null } } }
        | undefined;
      const top = ed?.state.doc.firstChild;
      const taskItem = top?.firstChild;
      return {
        topCount: ed?.state.doc.childCount,
        topType: top?.type.name,
        taskItemChildren: taskItem?.childCount,
        taskItemLabel: taskItem?.firstChild?.textContent,
        nestedListType: taskItem?.lastChild?.type.name,
        nestedFirstItemType: taskItem?.lastChild?.firstChild?.type.name,
        nestedFirstItemText: taskItem?.lastChild?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 1, // bullet ul collapsed
      topType: 'taskList',
      taskItemChildren: 2,
      taskItemLabel: 'Task',
      nestedListType: 'taskList', // wrapper matches target's type
      nestedFirstItemType: 'taskItem', // bullet item adapted to taskItem
      nestedFirstItemText: 'Bullet',
    });
  });

  test('drop result has SINGLE listItem in target wrapper (Source paragraph DOES NOT create a sibling listItem)', async ({ page }) => {
    // Regression guard: the old sibling path wrapped the source paragraph
    // in a fresh listItem and inserted it as a sibling (2 listItems in
    // wrapper). Nested-mode produces 1 listItem with the paragraph as
    // nested child.
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
    );
    expect(await listItemTypes(page)).toEqual(['listItem']);
  });

  test('undo after nested drop reverts to original two-block doc shape', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
    );
    expect((await firstListItemChildren(page)).length).toBe(2);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(80);

    // Original shape: paragraph + bulletList(li(p"Target")).
    expect((await getBlocks(page)).map((b) => b.type)).toEqual(['paragraph', 'bulletList']);
    const undoneTree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; firstChild: { firstChild: { textContent: string } | null } | null }) => void) => void } } }
        | undefined;
      let liText = '';
      ed?.state.doc.forEach((n) => {
        if (n.type.name === 'bulletList') liText = n.firstChild?.firstChild?.textContent ?? '';
      });
      return liText;
    });
    expect(undoneTree).toBe('Target');
  });

  test('marks (bold) preserved on nested-dropped paragraph', async ({ page }) => {
    await setContent(page, '<p><strong>Bold text</strong></p><ul><li><p>Item</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Bold text")`),
      page.locator(`${editorSelector} li`),
    );
    const marks = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { lastChild: { firstChild: { marks: { type: { name: string } }[] } | null } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const droppedP = li?.lastChild;
      const text = droppedP?.firstChild;
      return text?.marks?.map((m) => m.type.name) ?? [];
    });
    expect(marks).toContain('bold');
  });

  test('UniqueID preserved on nested drop (drop is a MOVE, not a duplicate)', async ({ page }) => {
    await setContent(page, '<p>Source</p><ul><li><p>Target</p></li></ul>');
    const sourceIdBefore = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { attrs: Record<string, unknown> } | null } } }
        | undefined;
      return ed?.state.doc.firstChild?.attrs['id'] as string | undefined;
    });
    expect(sourceIdBefore).toBeTruthy();

    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} li:has-text("Target")`),
    );

    const droppedId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { lastChild: { attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      return ed?.state.doc.firstChild?.firstChild?.lastChild?.attrs['id'] as string | undefined;
    });
    expect(droppedId).toBe(sourceIdBefore);
  });

  test('drop into ORDERED LIST item with nested-zone X works (parity with bullet/task)', async ({ page }) => {
    await setContent(page, '<p>Source</p><ol><li><p>One</p></li></ol>');
    await dropNested(
      page,
      page.locator(`${editorSelector} p:has-text("Source")`),
      page.locator(`${editorSelector} ol li`),
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { type: { name: string }; firstChild: { childCount: number; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const top = ed?.state.doc.firstChild;
      const li = top?.firstChild;
      return {
        topType: top?.type.name,
        liChildren: li?.childCount,
        liLastType: li?.lastChild?.type.name,
        liLastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topType: 'orderedList',
      liChildren: 2,
      liLastType: 'paragraph',
      liLastText: 'Source',
    });
  });

  test('drop into NESTED listItem (li inside li, 2-level deep target) lands on the INNER item', async ({ page }) => {
    // Doc: outer ul > outer li > [outer label, inner ul > inner li]. Drop
    // a top-level paragraph onto the inner listItem with nested-zone X.
    // The new paragraph becomes a nested child of the INNER li, not the outer.
    await setContent(
      page,
      '<p>Source</p><ul><li><p>OuterLabel</p><ul><li><p>InnerLabel</p></li></ul></li></ul>',
    );
    const innerLi = page.locator(`${editorSelector} li li`);
    await dropNested(
      page,
      page.locator(`${editorSelector} > p:has-text("Source")`),
      innerLi,
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; firstChild: { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } | null } | null } } }
        | undefined;
      const outerLi = ed?.state.doc.firstChild?.firstChild;
      const outerLabel = outerLi?.firstChild?.textContent;
      const innerListWrap = outerLi?.lastChild;
      const innerListInnerLi = innerListWrap?.firstChild;
      return {
        outerLabel,
        innerLiChildren: innerListInnerLi?.childCount,
        innerLiLabel: innerListInnerLi?.firstChild?.textContent,
        innerLiLastType: innerListInnerLi?.lastChild?.type.name,
        innerLiLastText: innerListInnerLi?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      outerLabel: 'OuterLabel',
      innerLiChildren: 2, // [innerLabel, droppedSource]
      innerLiLabel: 'InnerLabel',
      innerLiLastType: 'paragraph',
      innerLiLastText: 'Source',
    });
  });

  test('multi-step nesting: dropping A, B, C onto a Target item at its after gap appends them in order', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p><p>C</p><ul><li><p>Target</p></li></ul>');
    // dropNested aims Y at the item's after gap -> append as last child, so a
    // later drop lands BELOW the earlier ones: the order stays A, B, C.
    for (const t of ['A', 'B', 'C']) {
      await dropNested(
        page,
        page.locator(`${editorSelector} > p:has-text("${t}")`),
        page.locator(`${editorSelector} li`),
      );
    }
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'Target' },
      { type: 'paragraph', text: 'A' },
      { type: 'paragraph', text: 'B' },
      { type: 'paragraph', text: 'C' },
    ]);
    expect((await getBlocks(page)).length).toBe(1); // Just the bulletList; A/B/C all moved.
  });

  test('source from NESTED HANDLE (heading inside li-A) drops as NESTED child of li-B', async ({ page }) => {
    // Nested-handle source + X-detection + nested drop transaction compose.
    await setContent(
      page,
      '<ul><li><p>A label</p><h2>Nested heading</h2></li><li><p>B label</p></li></ul>',
    );
    await dropNested(
      page,
      page.locator(`${editorSelector} h2:has-text("Nested heading")`),
      page.locator(`${editorSelector} li:has-text("B label")`),
    );
    // li-A becomes [A label] (nested heading removed). li-B becomes
    // [B label, Nested heading].
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const liA = ul?.child(0);
      const liB = ul?.child(1);
      return {
        ulItems: ul?.childCount,
        liAChildren: liA?.childCount,
        liALabel: liA?.firstChild?.textContent,
        liBChildren: liB?.childCount,
        liBLabel: liB?.firstChild?.textContent,
        liBLastType: liB?.lastChild?.type.name,
        liBLastText: liB?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      ulItems: 2,
      liAChildren: 1,
      liALabel: 'A label',
      liBChildren: 2,
      liBLabel: 'B label',
      liBLastType: 'heading',
      liBLastText: 'Nested heading',
    });
  });

  test('reverse cross-list-type: taskItem source dropped onto bullet listItem wraps in fresh nested bulletList', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task source</p></li></ul>'
      + '<ul><li><p>Bullet target</p></li></ul>',
    );
    await dropNested(
      page,
      page.locator(`${editorSelector} li[data-type="taskItem"]`),
      page.locator(`${editorSelector} ul:not([data-type="taskList"]) li`),
    );
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; firstChild: { childCount: number; firstChild: { textContent: string } | null; lastChild: { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } | null } } }
        | undefined;
      const top = ed?.state.doc.firstChild;
      const li = top?.firstChild;
      const nested = li?.lastChild;
      return {
        topCount: ed?.state.doc.childCount,
        topType: top?.type.name,
        liChildren: li?.childCount,
        liLabel: li?.firstChild?.textContent,
        nestedType: nested?.type.name,
        nestedFirstItemType: nested?.firstChild?.type.name,
        nestedFirstItemText: nested?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 1, // taskList collapsed
      topType: 'bulletList', // outer is now just the bullet list
      liChildren: 2, // [Bullet target, nested ul]
      liLabel: 'Bullet target',
      nestedType: 'bulletList', // wrapper matches target's type
      nestedFirstItemType: 'listItem', // task item adapted to listItem
      nestedFirstItemText: 'Task source',
    });
  });

  test('empty paragraph source dropped nested still produces a nested child', async ({ page }) => {
    // Empty source: schema accepts empty paragraph as block content; nested drop succeeds.
    await setContent(page, '<p></p><ul><li><p>Target</p></li></ul>');
    await dropNested(
      page,
      page.locator(`${editorSelector} > p`).first(),
      page.locator(`${editorSelector} li:has-text("Target")`),
    );
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'Target' },
      { type: 'paragraph', text: '' },
    ]);
  });

  test('drop just below the label of an item with content inserts the new block as the FIRST child (before the existing heading)', async ({ page }) => {
    // Position-aware: aiming Y just below the label (the first-child gap)
    // resolves to childIndex 1, so Source lands BEFORE the existing heading.
    await setContent(page, '<p>Source</p><ul><li><p>Label</p><h2>Existing</h2></li></ul>');
    await page.locator(`${editorSelector} p:has-text("Source")`).hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const li = page.locator(`${editorSelector} li`);
    const liBox = await li.boundingBox();
    if (!liBox) throw new Error('no li box');
    const labelBottom = await page.evaluate(() => {
      const label = document.querySelector('.ProseMirror li > p');
      return label instanceof HTMLElement ? label.getBoundingClientRect().bottom : 0;
    });
    const clientX = liBox.x + 50;
    const clientY = labelBottom + 3; // first-child gap, before the heading
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: 'Label' },
      { type: 'paragraph', text: 'Source' },
      { type: 'heading', text: 'Existing', level: 2 },
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Drop result branch - sibling-zone X uses moveBlock, nested-zone X
//    uses moveBlockAsNestedChild. Both produce the result the indicator
//    visual promises.
// ────────────────────────────────────────────────────────────────────────

test.describe('drop result - mode branches the actual transaction', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag listItem with X on RIGHT side of another listItem nests as child (fresh sublist)', async ({ page }) => {
    // Nested-zone X over a listItem dispatches via `insertAsListItemChild`.
    // Source listItem wraps in a fresh bulletList and lands as last child
    // of the target listItem.
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'bottom', 'right');

    // Outer ul now has 1 listItem (Two collapsed into nested ul of One).
    expect((await getBlocks(page)).length).toBe(1);
    expect((await listItemTypes(page))).toEqual(['listItem']);
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; lastChild: { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const nestedList = li?.lastChild;
      return {
        liChildren: li?.childCount,
        nestedType: nestedList?.type.name,
        nestedItemType: nestedList?.firstChild?.type.name,
        nestedItemText: nestedList?.firstChild?.textContent,
      };
    });
    expect(tree.liChildren).toBe(2); // [paragraph, nested ul]
    expect(tree.nestedType).toBe('bulletList');
    expect(tree.nestedItemType).toBe('listItem');
    expect(tree.nestedItemText).toBe('Two');
  });

  test('drag listItem with X on LEFT side of another listItem reorders as siblings (sibling path unchanged)', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'top', 'left');

    expect((await getBlocks(page)).length).toBe(1);
    expect((await listItemTypes(page))).toEqual(['listItem', 'listItem']);
    const texts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { forEach: (cb: (n: { textContent: string }) => void) => void } | null } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => out.push(n.textContent));
      return out;
    });
    expect(texts).toEqual(['Two', 'One']);
  });
});

test.describe('multi-level outdent - drag a nested item left to a shallower level', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('dragging a 2-level-deep item to the left of its indent outdents it to the top-level list', async ({ page }) => {
    await setContent(page, '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>');
    const innerLabel = page.locator(`${editorSelector} li li > p:has-text("Inner")`);
    const outer = page.locator(`${editorSelector} > ul > li`).first();

    // Surface the handle on the Inner item.
    await innerLabel.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    const innerBox = await innerLabel.boundingBox();
    const outerBox = await outer.boundingBox();
    if (!innerBox || !outerBox) throw new Error('no box');
    // Drop at the OUTER item's left indent (left of Inner's content) at the
    // Inner row's AFTER gap (lower half) -> outdent one level to the top list.
    const clientX = outerBox.x + 2;
    const clientY = innerBox.y + innerBox.height * 0.8;

    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    await page.waitForTimeout(20);
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // The top-level bulletList now holds Outer and Inner as siblings; Outer's
    // nested sublist collapsed (it had only Inner).
    const topItems = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { textContent: string; childCount: number } | null } | null } } }
        | undefined;
      const list = ed?.state.doc.firstChild;
      const out: string[] = [];
      for (let i = 0; i < (list?.childCount ?? 0); i++) {
        const li = list?.child(i);
        if (li) out.push(li.textContent);
      }
      return out;
    });
    expect(topItems).toEqual(['Outer', 'Inner']);
  });
});
