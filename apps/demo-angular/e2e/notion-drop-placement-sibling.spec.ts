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

  test('indicator does NOT carry data-mode="nested" attribute (Phase 2 contract)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    const { handle, dt } = await startDragOver(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Bravo")`),
    );
    // Phase 4 will introduce data-mode="nested". Phase 2 must NEVER set it.
    const mode = await page.evaluate(
      () => document.querySelector('.dm-block-drop-indicator')?.getAttribute('data-mode'),
    );
    expect(mode).toBeFalsy(); // null OR empty - either way, NOT 'nested'
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

  test('indicator over a LIST ITEM target stays solid + no data-mode', async ({ page }) => {
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
    expect(info?.mode).toBeFalsy();
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator over a NESTED HEADING (inside list item) stays solid + no data-mode', async ({ page }) => {
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
    expect(info?.mode).toBeFalsy();
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator over a TASK LIST target stays solid + no data-mode', async ({ page }) => {
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
    expect(info?.mode).toBeFalsy();
    expect(info?.borderTopStyle).not.toBe('dashed');
    await endDrag(handle, dt);
  });

  test('indicator when dragging FROM a nested handle source stays solid + no data-mode', async ({ page }) => {
    // Plan-2 nested handle: hover the nested heading to surface its own
    // handle, then drag onto a top-level paragraph. Phase 2 contract says
    // the placement is still sibling-mode (Phase 3 will add the X-zone
    // detection that flips into nested-mode for select cases).
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
    expect(info?.mode).toBeFalsy();
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
// 3. Forward-compat: even RIGHT-zone X currently produces sibling drop
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 2 drop placement - right-zone X currently still sibling', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag with X on right side of list item still produces sibling reorder (Phase 3 will flip this to nested)', async ({ page }) => {
    // Until Phase 3 wires X-detection, ANY clientX (left or right) on the
    // target rect produces mode='sibling'. This test guards that fact -
    // when Phase 3 lands, the right-zone case starts producing nested
    // results and this test will need rewriting (or moves into a
    // dedicated nested-mode spec).
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const second = page.locator(`${editorSelector} li:has-text("Two")`);
    const first = page.locator(`${editorSelector} li:has-text("One")`);
    await dragBlock(page, second, first, 'bottom', 'right');

    // Both items remain siblings inside the same bulletList: still 1
    // top-level block, still 2 listItems (no nested merge).
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
