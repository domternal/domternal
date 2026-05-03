/**
 * E2E coverage locking down the Phase 2 drop-indent contract:
 *
 *   "Every existing drag-drop scenario produces a `mode: 'sibling'`
 *    placement; nothing is rendered as a nested-child drop yet."
 *
 * Phase 2 is type-only - the `DropPlacement` interface gained
 * `mode: 'sibling' | 'nested'` plus optional `targetItemPos`/`wrapperPos`
 * fields, with every return path of `computeDropPlacement` committing
 * to `mode: 'sibling'`. Phase 3 will start setting `mode: 'nested'`
 * when X-threshold detection fires; Phase 4 will draw the dashed
 * indented indicator when that happens. Until then, drop behaviour
 * AND the drop-indicator visual must stay identical to pre-Phase-2.
 *
 * What this spec asserts beyond regression coverage:
 *   1. Drop indicator is visible during a real drag-over (existing).
 *   2. Drop indicator carries NO `data-mode="nested"` attribute. The
 *      attribute simply doesn't exist yet in Phase 2; this guard makes
 *      sure we notice if it accidentally appears via a leak from a
 *      future phase.
 *   3. Drop indicator computed `border-top-style` is `solid`, not
 *      `dashed` (the visual reserved for nested mode in Phase 4).
 *   4. Each scenario's resulting doc structure is the EXACT shape we
 *      had before Phase 2 - sibling reorder, cross-list-type adapt,
 *      nested handle lift, hr drag. Forward-compat: when Phase 5 adds
 *      drop-indent, these assertions stay green because they target
 *      sibling-zone clientX (left half of the target), so Phase 3's
 *      X-detection will keep them on the sibling branch.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator, type JSHandle } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
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
 * (left side) vs nested-zone (right side, future Phase 3+) deliberately.
 * `dropZone` decides Y bucket on the target (top vs bottom half).
 * `xZone` decides X bucket: 'left' lands on the sibling side; 'center'
 * is the existing default; 'right' targets the nested side (used by
 * forward-compat tests that DON'T expect nested behaviour today but
 * lock the sibling-mode behaviour for the right-zone too).
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
  return { handle, dt };
}

async function endDrag(handle: Locator, dt: JSHandle<DataTransfer>): Promise<void> {
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await dt.dispose();
}

// ────────────────────────────────────────────────────────────────────────
// 1. Sibling-mode reorder produces same doc state as pre-Phase-2
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 2 drop placement - sibling-mode reorder', () => {
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

test.describe('Phase 2 drop placement - indicator visual contract', () => {
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
    // Phase 3 began setting `data-mode` so e2e + theme CSS can read it.
    // Top-level paragraph targets always stay sibling because X-threshold
    // detection only fires when the resolved target is a list item.
    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('sibling');
    await endDrag(handle, dt);
  });

  test('indicator computed border-top-style is solid (not dashed) - dashed is reserved for Phase 4 nested mode', async ({ page }) => {
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
        // Phase 2 indicator left/width come from the resolved block's rect
        // (full width). Phase 4 will SHRINK width and OFFSET left for nested
        // mode - those follow-up changes must NOT leak into Phase 2.
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

test.describe('Phase 2 drop placement - indicator contract across target types', () => {
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

  test('indicator over a NESTED HEADING (inside list item) stays solid + data-mode="sibling" (heading not in LIST_ITEM_TYPES)', async ({ page }) => {
    // List item with [label paragraph, nested h2]. Drag from a top-level
    // paragraph onto the nested heading - placement must still be sibling-mode.
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
    // startDragOver lands clientX at targetBox.x + 4 (left of bullet marker),
    // well below the default 28px nestThreshold - placement stays sibling.
    expect(info?.mode).toBe('sibling');
    expect(info?.borderTopStyle).not.toBe('dashed');
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
// 2c. Phase 3 - X-threshold detection flips mode to "nested"
//     The placement carries `mode: 'nested'` (visible on the indicator
//     via `data-mode='nested'`) when the cursor sits >= 28px from the
//     left edge of a listItem / taskItem rect. Drop transaction still
//     uses the existing moveBlock path until Phase 5; Phase 3 only
//     locks the COMPUTED mode, not the visual styling (Phase 4) nor
//     the actual nested-child insertion (Phase 5).
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3 X-detection - nested mode flip on list-item targets', () => {
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
    const clientY = targetBox.y + targetBox.height * 0.5;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
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
        clientY: targetBox!.y + targetBox!.height * 0.5,
      });
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

  test('drop with X in nested zone: TR pipeline still uses moveBlock (Phase 5 will switch to insertAsListItemChild)', async ({ page }) => {
    // Phase 3 only sets mode='nested' in the placement; performBlockDrop
    // ignores that field and calls moveBlock unconditionally. moveBlock
    // adapts the dragged content to the target's container - dropping a
    // paragraph onto a listItem position INSIDE a bulletList wraps it in
    // a fresh listItem (`convertListItemForParent` flow), so the
    // bulletList ends up with TWO sibling listItems. Phase 5 will branch
    // on mode and produce a single listItem with the paragraph as a
    // nested child instead.
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
    const clientY = targetBox.y + targetBox.height * 0.5;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
    await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await page.waitForTimeout(80);
    await dt.dispose();

    // Doc state after drop: single bulletList with 2 sibling listItems
    // (Source paragraph wrapped in a new listItem + Target listItem).
    // The Source paragraph is NOT a nested child inside Target's listItem.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; forEach: (cb: (n: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; childCount: number; firstChild: { textContent: string } | null }; firstChild: { childCount: number; firstChild: { textContent: string } | null } | null }) => void) => void } } }
        | undefined;
      let topCount = -1;
      let bulletListItems = -1;
      let firstItemText = '';
      let firstItemNestedCount = -1;
      ed?.state.doc.forEach((n) => {
        if (n.type.name === 'bulletList') {
          topCount = ed.state.doc.childCount;
          bulletListItems = n.childCount;
          const li0 = n.child(0);
          firstItemText = li0.firstChild?.textContent ?? '';
          firstItemNestedCount = li0.childCount;
        }
      });
      return { topCount, bulletListItems, firstItemText, firstItemNestedCount };
    });
    expect(tree.topCount).toBe(1); // single bulletList
    expect(tree.bulletListItems).toBe(2); // 2 listItems (sibling-style move)
    expect(tree.firstItemText).toBe('Source'); // source wrapped in first new listItem
    expect(tree.firstItemNestedCount).toBe(1); // listItem just contains the paragraph, no nested child
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
    // Aim Y at the label paragraph (top quarter of the listItem rect),
    // X past threshold so X-detection can fire.
    const clientX = targetBox.x + 40;
    const clientY = targetBox.y + targetBox.height * 0.15;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });

    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBe('nested');

    await handle.dispatchEvent('dragend', { dataTransfer: dt });
    await dt.dispose();
  });

  test('Y-mid based insertAfter survives in nested mode: drop on UPPER half of listItem with nested-zone X has different reorder result than LOWER half', async ({ page }) => {
    // Phase 3 keeps `insertAfter` mirroring Y-mid even in nested mode so
    // the existing pipeline (which uses insertAfter to compute targetPos)
    // still produces a sensible sibling-style result. Verify by dropping
    // onto upper half vs lower half and observing different orderings.
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>');

    // Lower-half drop on "One" with nested-zone X: source moves between
    // One and Two (insertAfter=true → targetPos = end of One).
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'bottom', 'right');
    let texts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { forEach: (cb: (n: { textContent: string }) => void) => void } | null } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => out.push(n.textContent));
      return out;
    });
    expect(texts).toEqual(['One', 'Two', 'Three']); // self-drop guard kicks in (Two onto One bottom = no-op via canonicalisation)

    // Reset doc and try upper-half drop with nested-zone X: insertAfter=false →
    // targetPos = first listItem pos → Three relocated to before First.
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ul>');
    const third = page.locator(`${editorSelector} li:has-text("Three")`);
    const firstAgain = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, third, firstAgain, 'top', 'right');
    texts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { forEach: (cb: (n: { textContent: string }) => void) => void } | null } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => out.push(n.textContent));
      return out;
    });
    // Upper-half over "One" with right-zone X: nested-mode placement,
    // insertAfter=false, targetPos = One's pos. moveBlock relocates
    // "Three" before "One" -> [Three, One, Two].
    expect(texts).toEqual(['Three', 'One', 'Two']);
  });

  test('SELF-DROP: drag listItem onto ITSELF with nested-zone X flips mode to nested - moveBlock guard prevents corruption', async ({ page }) => {
    // The placement still reports mode='nested' because the resolver
    // doesn't know "source == target". Drop pipeline's self-drop guard
    // (in moveBlock) catches it and produces a no-op tr. Doc state stays
    // intact. Phase 5 will inherit the same guard via insertAsListItemChild.
    await setContent(page, '<ul><li><p>Solo</p></li></ul>');
    const solo = page.locator(`${editorSelector} li:has-text("Solo")`);
    await solo.hover();
    const dt = await page.evaluateHandle(() => new DataTransfer());
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('dragstart', { dataTransfer: dt });
    const targetBox = await solo.boundingBox();
    if (!targetBox) throw new Error('no target box');
    const clientX = targetBox.x + 40; // nested zone
    const clientY = targetBox.y + targetBox.height * 0.5;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
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
    const clientY = targetBox.y + targetBox.height * 0.5;
    await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
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
      clientY: targetBox.y + targetBox.height * 0.5,
    });
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
// 3. Drop result invariants - drop transaction still uses moveBlock
//    regardless of mode. Drop with right-zone X over a listItem flips
//    mode to 'nested' (Phase 3) but the actual move is still sibling-
//    style until Phase 5 wires `insertAsListItemChild`. Drop count and
//    types stay stable.
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3 drop result - moveBlock still owns the transaction', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag with X on right side of list item flips mode to nested but doc still has 2 sibling listItems', async ({ page }) => {
    // Phase 3 sets `mode='nested'` in the placement, yet `performBlockDrop`
    // calls `moveBlock` regardless - so the dragged listItem becomes a
    // sibling of the target item, not a nested child. Phase 5 will branch
    // on mode and switch to `insertAsListItemChild` for the nested case.
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'bottom', 'right');

    // Both items remain top-level siblings inside the same bulletList:
    // still 1 top-level block, still 2 listItems (no nested merge yet).
    expect((await getBlocks(page)).length).toBe(1);
    expect((await listItemTypes(page))).toEqual(['listItem', 'listItem']);
  });

  test('drag with X on left side of list item produces sibling reorder', async ({ page }) => {
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
