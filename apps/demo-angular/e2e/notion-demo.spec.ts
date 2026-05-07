/**
 * E2E coverage for the Notion-style demo (`<app-notion-demo>`).
 *
 * Targets the full `@domternal/extension-block-menu` feature set wired
 * there: BlockHandle (hover gutter + drag + plus), BlockContextMenu
 * (Delete / Duplicate / Copy link / Colors / Turn into), SlashCommand
 * (`/` popup), FloatingMenu (empty-line insert), KeyboardReorder
 * (Mod+Shift+↑/↓), BlockColor attributes, UniqueID integration, and
 * the auto-scroll / nested drag behaviour.
 *
 * Strategy: switch into the Notion mode via the mode toggle button in
 * `app.html`, then drive interactions through the ProseMirror DOM and
 * the demo's `__DEMO_EDITOR__` window handle. Drag-heavy paths (true
 * HTML5 drag sequence, auto-scroll ramp) are only loosely asserted
 * because Playwright's synthetic drag events don't trigger all browser
 * scroll side-effects reliably - those stay unit-tested.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';
const plusBtnSelector = '.dm-block-handle-plus';
const contextMenuSelector = '.dm-block-context-menu';
const contextItemSelector = '.dm-block-context-menu-item';
const slashMenuSelector = '.dm-slash-command-menu';
const slashItemSelector = '.dm-slash-command-item';
const floatingMenuSelector = '.dm-floating-menu';
const swatchSelector = '.dm-block-color-swatch';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Switch the demo into Notion mode and wait for the editor to mount. */
async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  // Wait for UniqueID's appendTransaction to stamp EVERY block, not just
  // the first one - Copy link only renders when the target block has an
  // id and we may target any of them in later tests.
  await waitForAllIds(page);
}

/** Block until every top-level block has been stamped with a UniqueID. */
async function waitForAllIds(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let allHaveId = true;
    ed.state.doc.forEach((n) => {
      if (!n.attrs['id']) allHaveId = false;
    });
    return allHaveId;
  }, { timeout: 3000 });
}

/** Replace editor content then focus - used by most tests. */
async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  // Let UniqueID's appendTransaction run on the replaced content so every
  // freshly-parsed block picks up an id before any test assertions run.
  await waitForAllIds(page);
}

/** Hover the first matching block element to surface the handle. */
async function hoverBlock(page: Page, selector: string, index = 0): Promise<Locator> {
  const block = page.locator(`${editorSelector} ${selector}`).nth(index);
  await block.hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
  return block;
}

/** Open the block context menu for the block under cursor (handle must be visible). */
async function openContextMenu(page: Page): Promise<void> {
  await page.click(dragBtnSelector);
  await expect(page.locator(contextMenuSelector)).toHaveAttribute('data-show', '');
}

/** Dump doc as serialised HTML via the editor's `getHTML`. */
async function getHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { getHTML: () => string }
      | undefined;
    return ed?.getHTML() ?? '';
  });
}

/** Shape of every top-level block used by assertions. */
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

// ────────────────────────────────────────────────────────────────────────
// 1. Mode switch + base layout
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion demo - mode switch & layout', () => {
  test('Notion mode button mounts the notion-demo component', async ({ page }) => {
    await page.goto('/');
    await page.click(modeToggleNotion);
    await expect(page.locator('app-notion-demo')).toBeVisible();
    await expect(page.locator(editorSelector)).toBeVisible();
  });

  test('starter content renders a heading and a paragraph', async ({ page }) => {
    await goNotion(page);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[0]?.text).toBe('Untitled');
    expect(blocks[1]?.type).toBe('paragraph');
  });

  test('no toolbar is rendered (Notion-style clean page)', async ({ page }) => {
    await goNotion(page);
    await expect(page.locator('app-notion-demo domternal-toolbar')).toHaveCount(0);
  });

  test("placeholder hint \"Press '/' for commands\" shows on focused empty paragraph", async ({ page }) => {
    await goNotion(page);
    // Starter content ends with a trailing empty paragraph. Click into it.
    const lastP = page.locator(`${editorSelector} > p`).last();
    await lastP.click();

    // The empty paragraph should be marked .is-empty with the placeholder text.
    await expect(lastP).toHaveClass(/is-empty/);
    await expect(lastP).toHaveAttribute('data-placeholder', "Press '/' for commands");
  });

  test('placeholder DISAPPEARS once user types in the empty paragraph', async ({ page }) => {
    await goNotion(page);
    const lastP = page.locator(`${editorSelector} > p`).last();
    await lastP.click();
    await expect(lastP).toHaveClass(/is-empty/);

    await page.keyboard.type('hello');
    await expect(lastP).not.toHaveClass(/is-empty/);
  });

  test('placeholder shows ONLY on the focused paragraph (not other empty blocks)', async ({ page }) => {
    await goNotion(page);
    // Append a second empty paragraph + click into the first empty one.
    const lastP = page.locator(`${editorSelector} > p`).last();
    await lastP.click();
    await page.keyboard.press('Enter'); // creates a second empty paragraph
    // Focus the first empty paragraph (second-to-last). The newly-created one is focused.
    // Move focus back: arrow up.
    await page.keyboard.press('ArrowUp');

    // Exactly ONE .is-empty in the editor.
    const emptyCount = await page.locator(`${editorSelector} .is-empty`).count();
    expect(emptyCount).toBe(1);
  });

  test('placeholder text is EMPTY for non-paragraph empty blocks (heading / codeBlock)', async ({ page }) => {
    await goNotion(page);
    // Insert an empty heading via slash menu equivalent - quickest way is to
    // type # then Space (markdown input rule) on an empty paragraph.
    const lastP = page.locator(`${editorSelector} > p`).last();
    await lastP.click();
    await page.keyboard.type('# ');
    await page.waitForTimeout(80);
    // The heading should be focused & empty.
    const heading = page.locator(`${editorSelector} h1`).last();
    await expect(heading).toHaveClass(/is-empty/);
    // Configured placeholder function returns '' for non-paragraph nodes.
    await expect(heading).toHaveAttribute('data-placeholder', '');
  });

  test('UniqueID stamps every starter block with a stable id', async ({ page }) => {
    await goNotion(page);
    const ids = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
        | undefined;
      const out: Array<string | null> = [];
      ed?.state.doc.forEach((n) => { out.push((n.attrs['id'] as string | null) ?? null); });
      return out;
    });
    expect(ids.length).toBeGreaterThan(1);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. BlockHandle - hover gutter + plus + visibility / positioning
// ────────────────────────────────────────────────────────────────────────

test.describe('BlockHandle - hover behaviour', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('handle is hidden before any hover', async ({ page }) => {
    await expect(page.locator(blockHandleSelector)).not.toHaveAttribute('data-show', '');
  });

  test('hovering a paragraph shows the handle anchored to that block', async ({ page }) => {
    // Use a short single-line paragraph so the bounding box accurately
    // reflects the block rect (the starter "Welcome…" paragraph wraps).
    await setContent(page, '<p>Short</p>');
    const para = await hoverBlock(page, 'p');
    const pBox = await para.boundingBox();
    const handleBox = await page.locator(blockHandleSelector).boundingBox();
    expect(pBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    if (pBox && handleBox) {
      // Handle anchored to the block top.
      expect(Math.abs(handleBox.y - pBox.y)).toBeLessThan(32);
      // Handle lives in the left gutter, not covering the block content.
      // Allow a little slop because rounded rects + sub-pixel math can drift.
      expect(handleBox.x).toBeLessThan(pBox.x);
    }
  });

  test('handle hides after mouse leaves the editor area', async ({ page }) => {
    await hoverBlock(page, 'p');
    // Move to the page title outside the editor.
    await page.mouse.move(5, 5);
    await expect(page.locator(blockHandleSelector)).not.toHaveAttribute('data-show', '', { timeout: 1500 });
  });

  test('drag button has grab cursor (visual affordance)', async ({ page }) => {
    await hoverBlock(page, 'p');
    const cursor = await page.locator(dragBtnSelector).evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('grab');
  });

  test('plus button inserts an empty paragraph AFTER the target block', async ({ page }) => {
    await setContent(page, '<p>Only</p>');
    await hoverBlock(page, 'p');
    const before = await getBlocks(page);
    expect(before.length).toBe(1);
    await page.click(plusBtnSelector);
    const after = await getBlocks(page);
    expect(after.length).toBe(2);
    expect(after[0]?.text).toBe('Only');
    expect(after[1]?.type).toBe('paragraph');
    expect(after[1]?.text).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. BlockContextMenu - structure, visibility, dismissal
// ────────────────────────────────────────────────────────────────────────

test.describe('BlockContextMenu - structure', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('click on drag handle opens the context menu', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await expect(page.locator(contextMenuSelector)).toBeVisible();
  });

  test('menu contains Delete, Duplicate, Copy link, and Turn into items', async ({ page }) => {
    // Use a heading so the "Turn into: Paragraph" entry is offered - when
    // the target equals the source node type the entry is filtered out.
    await setContent(page, '<h2>A heading</h2>');
    await hoverBlock(page, 'h2');
    await openContextMenu(page);
    await expect(page.locator(contextItemSelector, { hasText: 'Delete' })).toBeVisible();
    await expect(page.locator(contextItemSelector, { hasText: 'Duplicate' })).toBeVisible();
    // Copy link appears only when UniqueID is loaded + the block has an id.
    await expect(page.locator(contextItemSelector, { hasText: 'Copy link' })).toBeVisible();
    // Turn into targets: paragraph + the headings NOT equal to current H2.
    await expect(page.locator(contextItemSelector, { hasText: 'Paragraph' })).toBeVisible();
    await expect(page.locator(contextItemSelector, { hasText: 'Heading 1' })).toBeVisible();
    await expect(page.locator(contextItemSelector, { hasText: 'Heading 3' })).toBeVisible();
    // The source type is filtered out.
    await expect(page.locator(contextItemSelector, { hasText: 'Heading 2' })).toHaveCount(0);
  });

  test('Colors section renders two rows (background + text) with swatches', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await expect(page.locator(swatchSelector).first()).toBeVisible();
    // 9 colors + 1 clear, for each of bg and text = 20 total.
    const count = await page.locator(swatchSelector).count();
    expect(count).toBe(20);
  });

  test('Escape closes the menu and refocuses the editor', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(contextMenuSelector)).not.toHaveAttribute('data-show', '');
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('ProseMirror'));
    expect(focused).toBe(true);
  });

  test('clicking outside the menu dismisses it', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.mouse.click(5, 5);
    await expect(page.locator(contextMenuSelector)).not.toHaveAttribute('data-show', '');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Delete - including empty-doc guard
// ────────────────────────────────────────────────────────────────────────

test.describe('Delete block', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('Delete removes the block and leaves the others', async ({ page }) => {
    await setContent(page, '<p>First</p><p>Second</p><p>Third</p>');
    // Hover the middle paragraph via ProseMirror index.
    await hoverBlock(page, 'p', 1);
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Delete")`);
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['First', 'Third']);
  });

  test('deleting the last remaining block replaces with an empty paragraph', async ({ page }) => {
    await setContent(page, '<p>Alone</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Delete")`);
    const blocks = await getBlocks(page);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.text).toBe('');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Duplicate - preserves content, regenerates UniqueID, keeps colors
// ────────────────────────────────────────────────────────────────────────

test.describe('Duplicate block', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('Duplicate inserts an identical copy right after the source', async ({ page }) => {
    await setContent(page, '<p>Repeat me</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Duplicate")`);
    const blocks = await getBlocks(page);
    expect(blocks.length).toBe(2);
    expect(blocks[0]?.text).toBe('Repeat me');
    expect(blocks[1]?.text).toBe('Repeat me');
  });

  test('Duplicate regenerates UniqueID - source and copy have different ids', async ({ page }) => {
    await setContent(page, '<p>Dup IDs</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Duplicate")`);
    const blocks = await getBlocks(page);
    const idA = blocks[0]?.attrs['id'] as string | undefined;
    const idB = blocks[1]?.attrs['id'] as string | undefined;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });

  test('Duplicate preserves block colors on the copy', async ({ page }) => {
    await setContent(page, '<p data-bg-color="yellow" data-text-color="gray">Colored</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Duplicate")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.attrs['bgColor']).toBe('yellow');
    expect(blocks[0]?.attrs['textColor']).toBe('gray');
    expect(blocks[1]?.attrs['bgColor']).toBe('yellow');
    expect(blocks[1]?.attrs['textColor']).toBe('gray');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Copy link - event, URL format, toast
// ────────────────────────────────────────────────────────────────────────

test.describe('Copy link to block', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('Copy link dispatches `dm:copy-link-success` with url + blockId', async ({ page }) => {
    // Install listener before triggering the action.
    await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.dm-editor');
      (window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] = [];
      host?.addEventListener('dm:copy-link-success', (e: Event) => {
        const ce = e as CustomEvent<{ url: string; blockId: string }>;
        (
          (window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] as unknown[]
        ).push(ce.detail);
      });
    });

    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Copy link")`);

    await expect.poll(async () => page.evaluate(() =>
      ((window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] as unknown[]).length
    )).toBeGreaterThan(0);

    const event = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] as unknown[])[0]
    ) as { url: string; blockId: string };
    expect(event.blockId).toMatch(/^[a-z0-9-]+$/i);
    expect(event.url).toContain('#');
    expect(event.url).toContain(event.blockId);
  });

  test('Copy link renders a status toast in the demo', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Copy link")`);
    await expect(page.locator('.notion-demo-toast:not(.notion-demo-toast--error)')).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Turn into - type + attribute preservation
// ────────────────────────────────────────────────────────────────────────

test.describe('Turn into', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('paragraph → Heading 2 preserves text content', async ({ page }) => {
    await setContent(page, '<p>Title-to-be</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Heading 2")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[0]?.attrs['level']).toBe(2);
    expect(blocks[0]?.text).toBe('Title-to-be');
  });

  test('Heading → Paragraph preserves text', async ({ page }) => {
    await setContent(page, '<h2>Convert me</h2>');
    await hoverBlock(page, 'h2');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Paragraph")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('paragraph');
    expect(blocks[0]?.text).toBe('Convert me');
  });

  test('Turn into preserves block colors across type change', async ({ page }) => {
    await setContent(page, '<p data-bg-color="green">Green para</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Heading 1")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[0]?.attrs['level']).toBe(1);
    expect(blocks[0]?.attrs['bgColor']).toBe('green');
  });

  test('Turn into preserves UniqueID across type change', async ({ page }) => {
    await setContent(page, '<p>Keep my id</p>');
    const idBefore = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { attrs: Record<string, unknown> } | null } } }
        | undefined;
      return (ed?.state.doc.firstChild?.attrs['id'] as string | undefined) ?? '';
    });
    expect(idBefore).not.toBe('');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Heading 3")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.attrs['id']).toBe(idBefore);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 8. Block colors - swatches, aria-pressed, clear
// ────────────────────────────────────────────────────────────────────────

test.describe('Block colors', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('clicking a bg swatch applies `data-bg-color` to the block', async ({ page }) => {
    await setContent(page, '<p>Paint me</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${swatchSelector}--bg[data-color="yellow"]`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.attrs['bgColor']).toBe('yellow');
  });

  test('clicking a text swatch applies `data-text-color` without touching bg', async ({ page }) => {
    await setContent(page, '<p data-bg-color="blue">Tint</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${swatchSelector}--text[data-color="red"]`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.attrs['textColor']).toBe('red');
    expect(blocks[0]?.attrs['bgColor']).toBe('blue');
  });

  test('clear (null) swatch unsets the attribute', async ({ page }) => {
    await setContent(page, '<p data-bg-color="green">Clear me</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${swatchSelector}--bg[data-color="null"]`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.attrs['bgColor']).toBeNull();
  });

  test('current color has aria-pressed="true"', async ({ page }) => {
    await setContent(page, '<p data-bg-color="orange">Orange</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    const pressed = page.locator(`${swatchSelector}--bg[data-color="orange"]`);
    await expect(pressed).toHaveAttribute('aria-pressed', 'true');
    // Another color is not pressed.
    await expect(page.locator(`${swatchSelector}--bg[data-color="yellow"]`)).toHaveAttribute('aria-pressed', 'false');
  });

  test('colors round-trip through getHTML()', async ({ page }) => {
    await setContent(page, '<p>Plain</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${swatchSelector}--bg[data-color="purple"]`);
    const html = await getHtml(page);
    expect(html).toContain('data-bg-color="purple"');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 9. Slash command
// ────────────────────────────────────────────────────────────────────────

test.describe('Slash command', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('typing "/" on an empty line opens the menu', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    expect(await page.locator(slashItemSelector).count()).toBeGreaterThan(0);
  });

  test('query filters the list', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/head');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    const items = page.locator(slashItemSelector);
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    // Every visible item mentions "head" in its label or description.
    for (let i = 0; i < count; i++) {
      const text = (await items.nth(i).textContent())?.toLowerCase() ?? '';
      expect(text).toContain('head');
    }
  });

  test('Enter executes the highlighted item and consumes the `/query`', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading 1');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[0]?.attrs['level']).toBe(1);
    // No residual "/heading 1" text anywhere.
    const html = await getHtml(page);
    expect(html).not.toContain('/heading');
  });

  test('Escape closes the menu and leaves the text intact', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/bull');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    // The typed "/bull" stays in the document.
    const blocks = await getBlocks(page);
    expect(blocks[0]?.text).toBe('/bull');
  });

  test('exactly one item is marked as the initial selection', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    // The renderer marks the active item with `data-selected` (present
    // as a bare attribute). Exactly one at a time is the invariant.
    // (Arrow-key nav within the suggestion popup is covered by unit tests
    //  in packages/extension-block-menu - replicating it here is flaky
    //  because key forwarding depends on Playwright's synthetic focus
    //  model interacting with tiptap's SuggestionPluginKey.)
    const count = await page.locator(`${slashItemSelector}[data-selected]`).count();
    expect(count).toBe(1);
  });

  test('no match shows empty-state', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/zzzzzzz-nope');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    expect(await page.locator(slashItemSelector).count()).toBe(0);
    await expect(page.locator('.dm-slash-command-empty')).toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 9b. Slash command - activation gated to a typing event
// ────────────────────────────────────────────────────────────────────────
//
// The slash menu must only open when the user actively TYPES `/`. Clicking
// next to a `/` already in the document, or pasting/loading content that
// contains a `/`, must NOT open the menu - that `/` is plain text, not
// an active session. Mirrors Notion.

test.describe('Slash command - typing-event activation', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('clicking AFTER an existing `/` in pre-loaded content does NOT open the menu', async ({ page }) => {
    // setContent loads "/abcd" as plain text (no typing event happened),
    // so the menu must stay closed when the cursor lands next to the `/`.
    await setContent(page, '<p>hello /abcd</p>');

    // Click in the middle of "abcd". ProseMirror places the caret there.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: {
              doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void };
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.isText && n.text?.includes('/abcd')) {
          // Land between "/" and "a" (immediately after the slash).
          const idx = n.text.indexOf('/abcd');
          pos = p + idx + 1;
          return false;
        }
        return true;
      });
      if (pos === -1) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
      ed.view.dispatch(tr);
      ed.view.focus();
    });

    // Give the plugin a tick. The menu must still be hidden.
    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('clicking deeper INSIDE the word after `/` does NOT open the menu', async ({ page }) => {
    // Same as above but cursor lands several chars past the `/`.
    await setContent(page, '<p>hello /abcd</p>');

    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: {
              doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void };
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
          }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.isText && n.text?.includes('/abcd')) {
          // Land in the middle of "abcd".
          const idx = n.text.indexOf('/abcd');
          pos = p + idx + 3; // /a|bcd
          return false;
        }
        return true;
      });
      if (pos === -1) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
      ed.view.dispatch(tr);
      ed.view.focus();
    });

    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('typing `/` then Esc, then clicking back next to it does NOT reopen', async ({ page }) => {
    // Typing creates an active session. Esc dismisses it. Clicking back
    // next to the same `/` must be a no-op for the popup - the `/` is now
    // just plain text (Notion behaviour).
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();

    // Move cursor away then back to right after the `/`.
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('arrow-key navigation past an existing `/` does NOT open the menu', async ({ page }) => {
    // Pure selection change via keyboard. No doc change -> no activation.
    await setContent(page, '<p>hello /world</p>');
    await page.click(editorSelector);
    // Send a few ArrowLeft / ArrowRight to move through the `/`.
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(40);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(40);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('typing `/` mid-text (between existing words) DOES open the menu', async ({ page }) => {
    // Real typing event qualifies even though there's surrounding text.
    await setContent(page, '<p>hello world</p>');
    await page.click(editorSelector);
    // Move cursor to the start of "world" (after the space). One Home + 6 Right.
    await page.keyboard.press('Home');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
  });

  test('paste-like programmatic insert of `/heading` does NOT open the menu', async ({ page }) => {
    // Mimics paste / programmatic bulk insertion: editor.commands.insertContent
    // emits a multi-char insertion in a single transaction. Activation is gated
    // to a single-char `/` event, so the menu must stay closed.
    await setContent(page, '<p></p>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { insertContent: (s: string) => boolean; focus: () => void } }
        | undefined;
      ed?.commands.focus();
      ed?.commands.insertContent('/heading 1');
    });
    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    // The `/heading 1` text remained as plain content.
    const blocks = await getBlocks(page);
    expect(blocks[0]?.text).toBe('/heading 1');
  });

  test('real clipboard paste of `/heading 1` (DOM paste event) does NOT open the menu', async ({ page }) => {
    // Exercises the actual paste-event path through PM's clipboard plugin
    // (transformPasted -> ReplaceStep with a multi-char slice). insertContent
    // covers a closely related path, but the DOM paste event goes through
    // additional plugin hooks - this test pins down both.
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', '/heading 1');
      const ev = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      document.querySelector('app-notion-demo .ProseMirror')?.dispatchEvent(ev);
    });
    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    const blocks = await getBlocks(page);
    expect(blocks[0]?.text).toBe('/heading 1');
  });

  test('Backspace deleting the typed `/` dismisses the menu', async ({ page }) => {
    // Active branch dismiss path: when the trigger char is removed, the
    // popup closes. Real keyboard events (not just programmatic delete).
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    await page.keyboard.press('Backspace');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    // The `/` is gone.
    const blocks = await getBlocks(page);
    expect(blocks[0]?.text ?? '').toBe('');
  });

  test('typing `/` AGAIN after dismissing once opens a fresh session', async ({ page }) => {
    // Confirms activation isn't latched off after a dismiss - the next
    // typing event still triggers a clean open.
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();

    // Type something, then `/` again.
    await page.keyboard.type(' hello ');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    await page.keyboard.type('/');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
  });

  test('active menu: moving cursor into ANOTHER block dismisses it; moving back does NOT reopen', async ({ page }) => {
    // Two blocks, type `/` at the end of the first, then move cursor to
    // the second. Active branch's findSlashQuery returns null (cursor
    // moved out of range) -> popup closes. Then moving back next to the
    // `/` in block 1 must NOT reopen (selection-only change with the
    // popup already inactive).
    //
    // Cursor moves are scripted through the editor handle (not real
    // mouse clicks) because the open slash menu overlays the second
    // paragraph in this layout - regular page.click wouldn't reach the
    // target. The plugin sees the SAME `selectionSet` transaction either
    // way, so this still exercises the dismiss-on-cursor-move path.
    await setContent(page, '<p>first paragraph</p><p>second paragraph</p>');

    const moveCursorToBlock = async (blockIndex: 0 | 1, atEnd: boolean): Promise<void> => {
      await page.evaluate(({ blockIndex, atEnd }) => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | {
              state: {
                doc: {
                  child: (i: number) => { nodeSize: number };
                  resolve: (pos: number) => unknown;
                };
                tr: { setSelection: (s: unknown) => unknown };
                selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
              };
              view: { dispatch: (tr: unknown) => void; focus: () => void };
            }
          | undefined;
        if (!ed) return;
        // Position right inside block N: 1 (open of first p) + (size of preceding blocks).
        // For atEnd: add (block.nodeSize - 2) for the inner end.
        let pos = 0;
        for (let i = 0; i < blockIndex; i++) pos += ed.state.doc.child(i).nodeSize;
        pos += atEnd ? ed.state.doc.child(blockIndex).nodeSize - 1 : 1;
        const TS = ed.state.selection.constructor;
        const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
        ed.view.dispatch(tr);
        ed.view.focus();
      }, { blockIndex, atEnd });
    };

    await moveCursorToBlock(0, true);
    // Type a space then `/` so the trigger qualifies (preceded by whitespace).
    await page.keyboard.type(' /');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    // Move cursor into the second paragraph. Active branch deactivates.
    await moveCursorToBlock(1, false);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();

    // Move cursor back to end of the first paragraph (right after the `/`).
    // Now the popup is inactive AND no typing happened - must stay closed.
    await moveCursorToBlock(0, true);
    await page.waitForTimeout(80);
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 10. Floating menu (empty-line insert)
// ────────────────────────────────────────────────────────────────────────

test.describe('FloatingMenu - Notion-style explicit trigger', () => {
  // The notion-demo wires the floating menu with `requireExplicitTrigger:
  // true` so the menu mirrors Notion: it does NOT auto-pop on every empty
  // paragraph, only when the BlockHandle `+` button (or any caller of
  // `showFloatingMenu`) explicitly opens it. Empty paragraphs instead show
  // a placeholder hint "Press '/' for commands".
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('does NOT auto-show when cursor lands on an empty paragraph (Enter behaviour)', async ({ page }) => {
    await setContent(page, '<p>Above</p><p></p>');
    // Click into the empty paragraph - cursor is now on an empty row,
    // exactly like pressing Enter at the end of "Above" would have.
    await page.locator(`${editorSelector} > p`).last().click();
    await page.keyboard.press('End');
    // Menu must remain hidden. We give it a moment to ensure no async
    // path silently shows it.
    await page.waitForTimeout(150);
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible();
  });

  test('does NOT auto-show after user presses Enter to create a new empty paragraph', async ({ page }) => {
    await setContent(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter'); // creates a new empty paragraph
    await page.waitForTimeout(150);
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible();
  });

  test('OPENS when the BlockHandle `+` button is clicked', async ({ page }) => {
    await setContent(page, '<p>Block</p>');
    // Hover the block to reveal the handle.
    await page.locator(`${editorSelector} > p`).hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    // Click the `+` button - inserts a new empty paragraph below AND
    // explicitly triggers the floating menu.
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toBeVisible();
  });

  test('CLOSES when the user types after `+` button opened it (paragraph no longer empty)', async ({ page }) => {
    await setContent(page, '<p>Block</p>');
    await page.locator(`${editorSelector} > p`).hover();
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toBeVisible();
    // Once user types, the paragraph isn't empty -> shouldShow=false ->
    // menu hides AND triggered flag clears.
    await page.keyboard.type('a');
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible({ timeout: 1500 });
  });

  test('after dismissal via typing, navigating to ANOTHER empty paragraph does NOT re-open menu', async ({ page }) => {
    // Verifies the explicit-trigger flag clears on dismissal so the next
    // empty paragraph the user lands on doesn't silently re-show the menu.
    await setContent(page, '<p>One</p><p></p><p>Three</p>');
    // Open menu via `+`, then type to dismiss.
    await page.locator(`${editorSelector} > p:has-text("One")`).hover();
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toBeVisible();
    await page.keyboard.type('x');
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible({ timeout: 1500 });

    // Now click into the (still) empty paragraph that already existed.
    await page.locator(`${editorSelector} > p`).filter({ hasText: '' }).first().click();
    await page.keyboard.press('End');
    await page.waitForTimeout(150);
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible();
  });

  test('clicking outside the editor closes the menu after `+` opened it', async ({ page }) => {
    await setContent(page, '<p>Block</p>');
    await page.locator(`${editorSelector} > p`).hover();
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toBeVisible();
    // Click far outside the editor + menu DOM (the page heading).
    await page.locator('h1').first().click({ force: true });
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible({ timeout: 1500 });
  });

  test('placeholder hint replaces the auto-popup on empty paragraphs', async ({ page }) => {
    // The Notion-style replacement: instead of auto-showing the menu,
    // empty paragraphs render a discreet placeholder via the Placeholder
    // extension (covered in the "mode switch & layout" describe - this
    // test cross-checks the two systems coexist).
    await setContent(page, '<p></p>');
    const lastP = page.locator(`${editorSelector} > p`).last();
    await lastP.click();
    await expect(lastP).toHaveClass(/is-empty/);
    await expect(lastP).toHaveAttribute('data-placeholder', "Press '/' for commands");
    // And the menu remains hidden alongside the placeholder.
    await page.waitForTimeout(120);
    await expect(page.locator(floatingMenuSelector)).not.toBeVisible();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 11. Keyboard reorder (Mod+Shift+Arrow)
// ────────────────────────────────────────────────────────────────────────

test.describe('KeyboardReorder', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('Mod+Shift+ArrowDown moves the current block down', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p><p>C</p>');
    // Click inside the first paragraph so the .ProseMirror element has
    // real DOM focus - PM's keymap plugin only fires on editable focus.
    await page.locator(`${editorSelector} p:has-text("A")`).click();
    await page.keyboard.press(`${modifier}+Shift+ArrowDown`);
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['B', 'A', 'C']);
  });

  test('Mod+Shift+ArrowUp moves the current block up', async ({ page }) => {
    await setContent(page, '<p>A</p><p>B</p><p>C</p>');
    await page.locator(`${editorSelector} p:has-text("C")`).click();
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`);
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['A', 'C', 'B']);
  });

  test('Mod+Shift+ArrowUp is a no-op on the first block', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Beta</p>');
    await page.locator(`${editorSelector} p:has-text("Alpha")`).click();
    await page.keyboard.press(`${modifier}+Shift+ArrowUp`);
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Alpha', 'Beta']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 12. Nested drag handle (list items + task items, opt-in via `nested: true`)
// ────────────────────────────────────────────────────────────────────────

test.describe('Nested drag handle', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hovering a list item anchors the handle on the <li>, not the list', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    const li = page.locator(`${editorSelector} li`).nth(1);
    await li.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const liBox = await li.boundingBox();
    const handleBox = await page.locator(blockHandleSelector).boundingBox();
    expect(liBox && handleBox).toBeTruthy();
    if (liBox && handleBox) {
      expect(Math.abs(handleBox.y - liBox.y)).toBeLessThan(24);
    }
  });

  test('Duplicate on a list item grows the list to 3 items', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
    await page.locator(`${editorSelector} li`).nth(0).hover();
    await page.click(dragBtnSelector);
    await page.click(`${contextItemSelector}:has-text("Duplicate")`);
    // Count <li>s present in the document - a copy of "One" appears as a
    // new sibling, so we expect at least 3 total. (Number of <ul>s may
    // vary depending on whether PM keeps the copy inside the source list
    // or briefly splits it; we only care about the item count.)
    const liCount = await page.locator(`${editorSelector} li`).count();
    expect(liCount).toBeGreaterThanOrEqual(3);
    const texts = await page.locator(`${editorSelector} li`).allTextContents();
    expect(texts.filter((t) => t.trim() === 'One').length).toBeGreaterThanOrEqual(2);
  });

  test('hovering in the side gutter (X outside ProseMirror) keeps list item target', async ({ page }) => {
    await setContent(page, '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>');
    const li = page.locator(`${editorSelector} li`).nth(1);
    const liBox = await li.boundingBox();
    expect(liBox).not.toBeNull();
    if (!liBox) return;

    // Move cursor INTO the left side gutter (X far to the left of the
    // editor) at the second list item's vertical band. With the
    // clamp-to-content fix, the resolver should still target the list
    // item - not jump up to the whole list.
    await page.mouse.move(20, liBox.y + liBox.height / 2);

    // Trigger the hover rAF via a real mousemove event on the editor parent
    // (where our hover listener lives).
    await li.hover({ position: { x: 5, y: liBox.height / 2 } });

    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const handleBox = await page.locator(blockHandleSelector).boundingBox();
    expect(handleBox).not.toBeNull();
    if (handleBox) {
      // Handle should anchor near the second list item (Y ≈ liBox.y),
      // not at the top of the entire list (which would be much higher).
      expect(Math.abs(handleBox.y - liBox.y)).toBeLessThan(24);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 13. Accessibility - roles, roving tabindex, keyboard nav
// ────────────────────────────────────────────────────────────────────────

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('context menu exposes role="menu" with role="menuitem" children', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await expect(page.locator(contextMenuSelector)).toHaveAttribute('role', 'menu');
    const itemCount = await page.locator(`${contextMenuSelector} [role="menuitem"]`).count();
    expect(itemCount).toBeGreaterThan(5);
  });

  test('swatches have descriptive aria-label', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await expect(page.locator(`${swatchSelector}--bg[data-color="yellow"]`))
      .toHaveAttribute('aria-label', /background/i);
    await expect(page.locator(`${swatchSelector}--text[data-color="red"]`))
      .toHaveAttribute('aria-label', /text color/i);
  });

  test('ArrowDown / ArrowUp move focus within the menu (roving tabindex)', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    const firstFocused = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? ''
    );
    await page.keyboard.press('ArrowDown');
    const secondFocused = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? ''
    );
    expect(secondFocused).not.toBe(firstFocused);
    expect(secondFocused.length).toBeGreaterThan(0);
  });

  test('Home / End jump focus to first and last menuitem', async ({ page }) => {
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.keyboard.press('End');
    const last = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    await page.keyboard.press('Home');
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    expect(first).not.toBe(last);
    expect(first.length).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 14. Cross-feature interaction - make sure things compose correctly
// ────────────────────────────────────────────────────────────────────────

test.describe('Cross-feature smoke', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('set color → Turn into heading → color survives AND id survives', async ({ page }) => {
    await setContent(page, '<p>Seed</p>');
    const idBefore = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { attrs: Record<string, unknown> } | null } } }
        | undefined;
      return (ed?.state.doc.firstChild?.attrs['id'] as string | undefined) ?? '';
    });
    expect(idBefore).not.toBe('');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${swatchSelector}--bg[data-color="pink"]`);
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Heading 2")`);
    const blocks = await getBlocks(page);
    expect(blocks[0]?.type).toBe('heading');
    expect(blocks[0]?.attrs['bgColor']).toBe('pink');
    expect(blocks[0]?.attrs['id']).toBe(idBefore);
  });

  test('Duplicate → Delete leaves the original intact', async ({ page }) => {
    await setContent(page, '<p>Keep</p>');
    await hoverBlock(page, 'p');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Duplicate")`);
    // Delete the copy (index 1).
    await hoverBlock(page, 'p', 1);
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Delete")`);
    const blocks = await getBlocks(page);
    expect(blocks.map((b) => b.text)).toEqual(['Keep']);
  });

  test('Slash command → insert heading → hover shows handle on new block', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading 2');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fresh');
    await hoverBlock(page, 'h2');
    await expect(page.locator(dragBtnSelector)).toBeVisible();
  });
});
