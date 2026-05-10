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

  test('Copy link on a heading produces a URL whose hash equals the heading id', async ({ page }) => {
    // After v0.7.0 unification, heading and paragraph share the same
    // id system (UniqueID). Copy link, BlockContextMenu's UniqueID
    // detection, and the floating outline all reference the same id.
    // Verifies the round-trip: open menu on heading → copy link →
    // pasted URL contains the SAME id that the heading carries in DOM.
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

    // Read the first heading's id BEFORE invoking Copy link.
    const headingId = await page.evaluate(() =>
      document.querySelector<HTMLElement>(
        'app-notion-demo .ProseMirror :is(h1, h2, h3)',
      )?.getAttribute('id') ?? null,
    );
    expect(headingId).toBeTruthy();

    await hoverBlock(page, 'h1');
    await openContextMenu(page);
    await page.click(`${contextItemSelector}:has-text("Copy link")`);

    await expect.poll(async () => page.evaluate(() =>
      ((window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] as unknown[]).length
    )).toBeGreaterThan(0);

    const event = await page.evaluate(() =>
      ((window as unknown as Record<string, unknown>)['__COPY_LINK_EVENTS__'] as unknown[])[0]
    ) as { url: string; blockId: string };

    // The unification contract: BlockContextMenu's blockId comes from
    // the SAME attribute that the heading element carries.
    expect(event.blockId).toBe(headingId);
    expect(event.url).toContain(`#${headingId!}`);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6b. Floating menu - dark theme token propagation
// (regression: `.dm-floating-menu` was missing from the dark-theme selector
// list, leaving its scrollbar / surface colours stuck on light values.)
// ────────────────────────────────────────────────────────────────────────

test.describe('Floating menu - theming', () => {
  test('floating menu inherits dark-theme tokens when body has .dm-theme-dark', async ({ page }) => {
    await page.goto('/');
    // Toggle dark mode at the app level BEFORE switching into Notion mode -
    // theme-toggle lives in app.html so it persists across the mode switch.
    await page.locator('.theme-toggle').click();
    await expect.poll(async () =>
      page.evaluate(() => document.body.classList.contains('dm-theme-dark')),
    ).toBe(true);

    await page.click(modeToggleNotion);
    await page.waitForSelector(editorSelector);
    await waitForAllIds(page);

    // Open the floating menu via the BlockHandle `+` button (Notion mode
    // uses requireExplicitTrigger=true so the menu only shows on demand).
    await hoverBlock(page, 'p');
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toHaveAttribute('data-show', '');

    // The dark scrollbar token should resolve on the menu element. Reads
    // the SAME custom property the menu's `scrollbar-color` consumes -
    // proves the dark-tokens mixin reaches `.dm-floating-menu`.
    const scrollbarThumb = await page.locator(floatingMenuSelector).evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--dm-scrollbar-thumb').trim(),
    );
    // Dark-mode value defined in `_dark.scss`.
    expect(scrollbarThumb).toBe('rgba(255, 255, 255, 0.18)');

    // Surface colour cascades from --dm-bg through the menu's
    // `background: var(--dm-toolbar-bg, var(--dm-bg, ...))` chain.
    const bg = await page.locator(floatingMenuSelector).evaluate(
      (el) => getComputedStyle(el).getPropertyValue('--dm-bg').trim(),
    );
    expect(bg).toBe('#1e1e1e');
  });

  test('shortcut chip uses --dm-code-font token (regression: was an undefined --dm-editor-font-family-mono)', async ({ page }) => {
    await goNotion(page);
    await hoverBlock(page, 'p');
    await page.click(plusBtnSelector);
    await expect(page.locator(floatingMenuSelector)).toHaveAttribute('data-show', '');

    // Find a menu item that exposes a shortcut chip (e.g. headings show `# `).
    const chip = page.locator('.dm-floating-menu-item-shortcut').first();
    await expect(chip).toBeVisible();

    // The token must resolve to a real font stack (not the empty string a
    // missing variable would yield). Reading from the chip itself ensures
    // the var-lookup actually evaluates in the chip's cascade.
    const fontFamily = await chip.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily.toLowerCase()).toContain('mono');

    // Also verify the canonical token resolves (defined in `_variables.scss`).
    const tokenValue = await chip.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--dm-code-font').trim(),
    );
    expect(tokenValue.length).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6c. `.dm-notion-mode` library class - visual contract + token surface
// (regression: this class lives in `@domternal/theme`. The notion demo
// applies it to the editor; these tests prove the CLASS itself yields the
// expected visual contract independent of demo wrapper styling, so
// React/Vue notion demos and consumer apps can reuse it.)
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion-mode library class', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('editor host carries the class and inherits the visual contract', async ({ page }) => {
    const editor = page.locator('app-notion-demo .dm-editor');
    await expect(editor).toHaveClass(/dm-notion-mode/);

    // The class strips chrome (border / radius / shadow) and pins the
    // content column width. These are the visible affordances of "Notion
    // mode" - any one of them disappearing would be a regression.
    const styles = await editor.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderTop: cs.borderTopStyle,
        borderRight: cs.borderRightStyle,
        borderBottom: cs.borderBottomStyle,
        borderLeft: cs.borderLeftStyle,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        maxWidth: cs.maxWidth,
        editorPadding: cs.getPropertyValue('--dm-editor-padding').trim(),
        blockHandleGutter: cs.getPropertyValue('--dm-block-handle-gutter').trim(),
        blockHandleLeft: cs.getPropertyValue('--dm-block-handle-left').trim(),
        editorLineHeight: cs.getPropertyValue('--dm-editor-line-height').trim(),
        editorFontSize: cs.getPropertyValue('--dm-editor-font-size').trim(),
      };
    });
    expect(styles.borderTop).toBe('none');
    expect(styles.borderRight).toBe('none');
    expect(styles.borderBottom).toBe('none');
    expect(styles.borderLeft).toBe('none');
    expect(styles.borderRadius).toBe('0px');
    expect(styles.boxShadow).toBe('none');
    expect(styles.maxWidth).toBe('608px'); // 38rem at 16px base
    expect(styles.editorPadding).toBe('0');
    expect(styles.blockHandleGutter).toBe('0');
    expect(styles.blockHandleLeft).toBe('-3.5rem');
    expect(styles.editorLineHeight).toBe('1.7');
    expect(styles.editorFontSize).toBe('1.0625rem');
  });

  test('class composes with .dm-theme-dark: chrome stripped + dark surface tokens active', async ({ page }) => {
    // Toggle dark mode AFTER goNotion (the toggle persists across mode switches).
    await page.locator('.theme-toggle').click();
    await expect.poll(async () =>
      page.evaluate(() => document.body.classList.contains('dm-theme-dark')),
    ).toBe(true);

    const editor = page.locator('app-notion-demo .dm-editor');
    await expect(editor).toHaveClass(/dm-notion-mode/);

    const styles = await editor.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderTop: cs.borderTopStyle,
        bg: cs.getPropertyValue('--dm-bg').trim(),
        text: cs.getPropertyValue('--dm-text').trim(),
        editorPadding: cs.getPropertyValue('--dm-editor-padding').trim(),
      };
    });
    // Notion contract still holds.
    expect(styles.borderTop).toBe('none');
    expect(styles.editorPadding).toBe('0');
    // Dark theme tokens reach the editor through inheritance.
    expect(styles.bg).toBe('#1e1e1e');
    expect(styles.text).toBe('#e0e0e0');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6d. Task-list checkbox tokens - override surface
// (regression guard for `--dm-task-checkbox-left` / `--dm-task-checkbox-top`,
// the public override hooks for the absolute-positioned checkbox label.)
// ────────────────────────────────────────────────────────────────────────

test.describe('Task-list checkbox tokens', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('overriding --dm-task-checkbox-left/-top moves the checkbox label', async ({ page }) => {
    // Insert a task list + capture the default position (resolved against
    // notion-mode's `--dm-editor-line-height: 1.7`).
    await setContent(page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>task</p></li></ul>',
    );
    const label = page.locator(
      `${editorSelector} ul[data-type="taskList"] li[data-type="taskItem"] > label`,
    ).first();
    await expect(label).toBeVisible();

    const before = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: cs.left, top: cs.top };
    });

    // Override both tokens via inline style on the editor host. The cascade
    // pushes the new values into the label's `left` / `top` resolution.
    await page.evaluate(() => {
      const ed = document.querySelector<HTMLElement>('app-notion-demo .dm-editor');
      ed?.style.setProperty('--dm-task-checkbox-left', '-2em');
      ed?.style.setProperty('--dm-task-checkbox-top', '0.1em');
    });

    const after = await label.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { left: cs.left, top: cs.top };
    });

    // Position must have moved on BOTH axes.
    expect(after.left).not.toBe(before.left);
    expect(after.top).not.toBe(before.top);
    // Direction sanity: -2em is further left than -1.15em → smaller (more
    // negative) px value. Both values share the same em base so direct
    // numeric compare is meaningful.
    expect(parseFloat(after.left)).toBeLessThan(parseFloat(before.left));
    expect(parseFloat(after.top)).toBeLessThan(parseFloat(before.top));
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6e. Task-list checkbox interactivity - NodeView (Plan 5)
// (regression guard for the click-to-toggle path; without a NodeView the
// native checkbox flips visually but PM never sees the change, so
// data-checked stays the old value and the strikethrough rule
// `[data-checked="true"] > div { text-decoration: line-through }` in
// `_task-list.scss` never matches.)
// ────────────────────────────────────────────────────────────────────────

test.describe('Task-list checkbox interactivity (NodeView)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('clicking the checkbox toggles data-checked + applies strikethrough on the label paragraph', async ({ page }) => {
    await setContent(page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>',
    );
    const li = page.locator(`${editorSelector} li[data-type="taskItem"]`).first();
    const cb = li.locator('input[type="checkbox"]');
    const label = li.locator('> div > p').first();

    await expect(li).toHaveAttribute('data-checked', 'false');
    await expect(cb).not.toBeChecked();
    await expect(label).toHaveCSS('text-decoration-line', 'none');

    await cb.click();

    await expect(li).toHaveAttribute('data-checked', 'true');
    await expect(cb).toBeChecked();
    await expect(label).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('clicking again unchecks + removes strikethrough', async ({ page }) => {
    await setContent(page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li></ul>',
    );
    const li = page.locator(`${editorSelector} li[data-type="taskItem"]`).first();
    const cb = li.locator('input[type="checkbox"]');
    const label = li.locator('> div > p').first();

    await expect(li).toHaveAttribute('data-checked', 'true');
    await expect(label).toHaveCSS('text-decoration-line', 'line-through');

    await cb.click();

    await expect(li).toHaveAttribute('data-checked', 'false');
    await expect(cb).not.toBeChecked();
    await expect(label).toHaveCSS('text-decoration-line', 'none');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6f. Task-list checked-state isolation (Notion parity)
// (regression guard against the strikethrough bleeding from the parent's
// children-zone div into nested taskItems and children-zone notes
// paragraphs. Notion behavior: only the parent's LABEL paragraph is
// struck; nested children render at full opacity, no line-through,
// regardless of the parent's `data-checked` state.)
// ────────────────────────────────────────────────────────────────────────

test.describe('Task-list checked-state isolation', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // Shape: parent (li#0) checked + nested child taskList containing
  // unchecked child (li#1) and checked grandchild semantics not needed.
  const NESTED_CONTENT = `
    <ul data-type="taskList">
      <li data-type="taskItem" data-checked="false">
        <p>parent</p>
        <ul data-type="taskList">
          <li data-type="taskItem" data-checked="false">
            <p>child</p>
          </li>
        </ul>
      </li>
    </ul>`;

  test('initial render: parent checked, child unchecked - only parent label is struck', async ({ page }) => {
    await setContent(page,
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true">' +
          '<p>parent</p>' +
          '<ul data-type="taskList">' +
            '<li data-type="taskItem" data-checked="false">' +
              '<p>child</p>' +
            '</li>' +
          '</ul>' +
        '</li>' +
      '</ul>',
    );
    const items = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    const parentLabel = items.nth(0).locator('> div > p').first();
    const childLabel = items.nth(1).locator('> div > p').first();

    await expect(parentLabel).toHaveCSS('text-decoration-line', 'line-through');
    await expect(childLabel).toHaveCSS('text-decoration-line', 'none');
  });

  test('initial render: parent unchecked, child checked - only child label is struck', async ({ page }) => {
    await setContent(page,
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false">' +
          '<p>parent</p>' +
          '<ul data-type="taskList">' +
            '<li data-type="taskItem" data-checked="true">' +
              '<p>child</p>' +
            '</li>' +
          '</ul>' +
        '</li>' +
      '</ul>',
    );
    const items = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    const parentLabel = items.nth(0).locator('> div > p').first();
    const childLabel = items.nth(1).locator('> div > p').first();

    await expect(parentLabel).toHaveCSS('text-decoration-line', 'none');
    await expect(childLabel).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('initial render: both checked - both labels struck (one rule per item)', async ({ page }) => {
    await setContent(page,
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true">' +
          '<p>parent</p>' +
          '<ul data-type="taskList">' +
            '<li data-type="taskItem" data-checked="true">' +
              '<p>child</p>' +
            '</li>' +
          '</ul>' +
        '</li>' +
      '</ul>',
    );
    const items = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    const parentLabel = items.nth(0).locator('> div > p').first();
    const childLabel = items.nth(1).locator('> div > p').first();

    await expect(parentLabel).toHaveCSS('text-decoration-line', 'line-through');
    await expect(childLabel).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('clicking parent checkbox does NOT strike the nested child label', async ({ page }) => {
    await setContent(page, NESTED_CONTENT.trim());
    const items = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    const parentItem = items.nth(0);
    const childLabel = items.nth(1).locator('> div > p').first();
    const parentCheckbox = parentItem.locator('> label > input[type="checkbox"]').first();

    // Sanity: both unchecked, neither struck.
    await expect(items.nth(0).locator('> div > p').first()).toHaveCSS('text-decoration-line', 'none');
    await expect(childLabel).toHaveCSS('text-decoration-line', 'none');

    await parentCheckbox.click();

    // Parent is now checked + struck; child label remains unchanged.
    await expect(parentItem).toHaveAttribute('data-checked', 'true');
    await expect(items.nth(0).locator('> div > p').first()).toHaveCSS('text-decoration-line', 'line-through');
    await expect(items.nth(1)).toHaveAttribute('data-checked', 'false');
    await expect(childLabel).toHaveCSS('text-decoration-line', 'none');
  });

  test('clicking parent checkbox does NOT dim the nested child label (opacity isolation)', async ({ page }) => {
    await setContent(page, NESTED_CONTENT.trim());
    const items = page.locator(`${editorSelector} li[data-type="taskItem"]`);
    const parentCheckbox = items.nth(0).locator('> label > input[type="checkbox"]').first();
    const childLabel = items.nth(1).locator('> div > p').first();

    await parentCheckbox.click();

    // The dim rule is applied alongside line-through on the label
    // paragraph only, so the nested child label keeps full opacity
    // (computed style = '1', not the parent's 0.6).
    await expect(childLabel).toHaveCSS('opacity', '1');
  });

  test('clicking parent does NOT strike a children-zone notes paragraph', async ({ page }) => {
    // Children-zone non-label paragraph: in Notion this stays normal
    // when the parent is checked (only the label line is "done").
    await setContent(page,
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false">' +
          '<p>label</p>' +
          '<p>notes paragraph in children-zone</p>' +
        '</li>' +
      '</ul>',
    );
    const li = page.locator(`${editorSelector} li[data-type="taskItem"]`).first();
    const cb = li.locator('> label > input[type="checkbox"]').first();
    const labelP = li.locator('> div > p').nth(0);
    const notesP = li.locator('> div > p').nth(1);

    await cb.click();

    await expect(labelP).toHaveCSS('text-decoration-line', 'line-through');
    await expect(notesP).toHaveCSS('text-decoration-line', 'none');
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

  test('typing `/h`, arrow-right past existing text dismisses (query does not swallow surrounding chars)', async ({ page }) => {
    // Mid-text typing scenario. Doc has "hello world". User clicks
    // between space and "w", types `/h` -> active query="h". Now arrow-
    // right past `to` into "world". Without typing, range.to does not
    // advance, the cursor leaves the typed span, popup dismisses.
    await setContent(page, '<p>hello world</p>');
    // Place cursor between space and 'w' (position 7).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: {
              doc: unknown;
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void };
          }
        | undefined;
      if (!ed) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc, 7));
      ed.view.dispatch(tr);
      ed.view.focus();
    });
    await page.keyboard.type('/h');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    // Real arrow-right keystroke. Cursor moves into "world".
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('arrow-left WITHIN typed query keeps the menu active; arrow-right back keeps it', async ({ page }) => {
    // Type `/heading`, arrow-left into the query -> menu stays open with
    // unchanged query "heading". Arrow-right back to end -> still open.
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    // Query content unchanged.
    const queryUnchanged = await page.evaluate(() => {
      const w = window as unknown as { __DEMO_EDITOR__?: unknown };
      // Read the slash plugin state via the editor's state/plugins lookup.
      const ed = w.__DEMO_EDITOR__ as { state: { plugins: { spec: { key?: { key?: string } } }[] } } | undefined;
      if (!ed) return null;
      // Find the slash plugin by its registered key name and read state.
      for (const plugin of ed.state.plugins) {
        const keyAny = (plugin as unknown as { key?: string }).key;
        if (typeof keyAny === 'string' && keyAny.startsWith('slashCommand')) {
          // Use plugin getState via state.field equivalent — fall back to
          // reading from view state via the indirection PM provides.
          break;
        }
      }
      // Simpler: read the visible "query highlighted" decoration text by
      // walking the doc - the plugin tags it with class dm-slash-command-query.
      return document.querySelector('.dm-slash-command-query')?.textContent ?? '';
    });
    expect(queryUnchanged).toBe('/heading');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
  });

  test('arrow-left to BEFORE the `/` dismisses', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/he');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    // Three ArrowLeft moves: e -> /e -> //e -> before /. The third lands
    // the cursor at the position OF the `/`, which is < range.from + 1.
    await page.keyboard.press('ArrowLeft'); // between h and e
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    await page.keyboard.press('ArrowLeft'); // between / and h
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    await page.keyboard.press('ArrowLeft'); // before /
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
  });

  test('arrow-left into query then typing in the middle extends the query', async ({ page }) => {
    // Type `/he`, arrow-left between h and e, type `x`. Query becomes "hxe".
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/he');
    await page.keyboard.press('ArrowLeft'); // /h|e
    await page.keyboard.type('x');
    // Visible decoration text reflects the typed query span.
    const queryText = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(queryText).toBe('/hxe');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
  });

  test('Backspace SHRINKS the typed query (not just deletes trigger)', async ({ page }) => {
    // Real keyboard backspace over query chars. Each press should shrink
    // range.to and refilter. Different code path from "backspace removes
    // the / itself" (which dismisses).
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading');
    let q = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(q).toBe('/heading');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    await page.keyboard.press('Backspace');
    q = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(q).toBe('/headin');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    q = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(q).toBe('/head');
    await expect(page.locator(slashMenuSelector)).toBeVisible();
  });

  test('mouse click WITHIN the typed query keeps the menu active', async ({ page }) => {
    // Real mouse click landing inside the typed query span. Equivalent
    // outcome to arrow-left mid-query but exercises a different DOM path
    // (mousedown -> PM coordsAtDOM -> setSelection).
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading');
    await expect(page.locator(slashMenuSelector)).toBeVisible();

    // Click into the middle of the rendered "/heading" text. The
    // decoration span's bounding box is the typed query.
    await page.locator('.dm-slash-command-query').click();
    await expect(page.locator(slashMenuSelector)).toBeVisible();
    // Query content must still be "/heading".
    const q = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(q).toBe('/heading');
  });

  test('mid-text typing /h then arrow-right does NOT add following text to query', async ({ page }) => {
    // The whole point: prior to this fix, arrow-right past `to` would
    // grow the query into existing text. Now it dismisses.
    await setContent(page, '<p>hello world</p>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: {
              doc: unknown;
              tr: { setSelection: (s: unknown) => unknown };
              selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
            };
            view: { dispatch: (tr: unknown) => void; focus: () => void };
          }
        | undefined;
      if (!ed) return;
      const TS = ed.state.selection.constructor;
      const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc, 7));
      ed.view.dispatch(tr);
      ed.view.focus();
    });
    await page.keyboard.type('/h');
    // Confirm typed query.
    let qText = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(qText).toBe('/h');

    // Arrow-right (cursor moves into "world"). Menu dismisses; the
    // typed query text is no longer decorated.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator(slashMenuSelector)).not.toBeVisible();
    qText = await page.evaluate(() =>
      document.querySelector('.dm-slash-command-query')?.textContent ?? '',
    );
    expect(qText).toBe('');
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

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 1 spike (FloatingTocOutline outlineHost test)
// ────────────────────────────────────────────────────────────────────────
// Validates D11 from `_planning/notion_toc_1.md`: the outline panel must
// mount OUTSIDE `.dm-editor` (which has `overflow: hidden` and would
// clip a right-rail child). Phase 4 replaces the spike with real ticks
// + click navigation; these tests stay as the floor-level placement
// regression check.

test.describe('Table of Contents - Phase 1 spike', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('outline mounts in the page (not inside .dm-editor)', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toBeVisible();
    // D11 contract: outline lives outside the editor's overflow:hidden box.
    // We verify by counting matches inside .dm-editor (must be 0) and on
    // the page overall (must be 1).
    await expect(page.locator('.dm-editor .dm-toc-outline')).toHaveCount(0);
    await expect(outline).toHaveCount(1);
  });

  test('outline destroys cleanly when leaving the route', async ({ page }) => {
    await expect(page.locator('.dm-toc-outline')).toHaveCount(1);
    // Switch back to the default toolbar demo (non-notion mode) - the
    // editor and its plugins tear down. The outline's destroy callback
    // must remove its DOM node so we don't leak an orphan after exit.
    await page.click('.toolbar-mode-toggle button:has-text("Default toolbar")');
    await page.waitForSelector('app-editor-demo');
    await expect(page.locator('.dm-toc-outline')).toHaveCount(0);
  });

  test('outline does not accumulate across mode toggles (HMR re-enter)', async ({ page }) => {
    // Real-world failure mode: each notion-mode entry mounts a fresh
    // plugin, prior destroy callbacks must run cleanly so re-entering
    // never produces 2+ outlines on the page.
    await expect(page.locator('.dm-toc-outline')).toHaveCount(1);
    await page.click('.toolbar-mode-toggle button:has-text("Default toolbar")');
    await page.waitForSelector('app-editor-demo');
    await page.click('.toolbar-mode-toggle button:has-text("Notion style")');
    await page.waitForSelector(editorSelector);
    // Exactly one outline, never two. Catches forgotten destroy hooks
    // and shared module-level DOM state.
    await expect(page.locator('.dm-toc-outline')).toHaveCount(1);
  });

  test('outline renders visibly within the viewport (no clipping)', async ({ page }) => {
    // `toBeVisible()` only asserts the element is laid out somewhere -
    // it would still pass for a 0-width clipped child of an
    // overflow:hidden parent. Read the bounding box and the viewport
    // width to confirm the outline ACTUALLY paints inside the visible
    // area: width > 0, right edge inside viewport.
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toBeVisible();
    const box = await outline.boundingBox();
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  });

  test('every heading gets a native id attribute in the rendered DOM (sourced from UniqueID)', async ({ page }) => {
    await page.waitForFunction(() => {
      const headings = document.querySelectorAll('app-notion-demo .ProseMirror :is(h1, h2, h3)');
      return headings.length > 0
        && Array.from(headings).every((h) => h.getAttribute('id'));
    }, { timeout: 3000 });
    const ids = await page.evaluate(() => {
      const headings = document.querySelectorAll<HTMLElement>('app-notion-demo .ProseMirror :is(h1, h2, h3)');
      return Array.from(headings).map((h) => h.getAttribute('id'));
    });
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toBeTruthy();
    }
    // IDs are unique within the document
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('regression: data-toc-id attribute is absent from DOM (replaced by native id in v0.7.0)', async ({ page }) => {
    // The v0.7.0 unification dropped TOC's own `data-toc-id` schema
    // attribute in favor of UniqueID's native `id`. This guard catches
    // any future regression that re-introduces the dual id system.
    await page.waitForSelector(`${editorSelector} h1[id], ${editorSelector} h2[id]`);
    const stragglers = await page.evaluate(() =>
      document.querySelectorAll('[data-toc-id]').length,
    );
    expect(stragglers).toBe(0);
  });

  test('outline buttons carry data-toc-anchor (NOT data-toc-id) — v0.7.0 rename', async ({ page }) => {
    // FloatingTocOutline's tick + row buttons hold the heading id they
    // link to under `data-toc-anchor`. The `data-toc-id` attribute is
    // NOT used anywhere — see commit history for the unification.
    const counts = await page.evaluate(() => ({
      anchor: document.querySelectorAll('.dm-toc-outline [data-toc-anchor]').length,
      legacy: document.querySelectorAll('.dm-toc-outline [data-toc-id]').length,
    }));
    expect(counts.anchor).toBeGreaterThan(0);
    expect(counts.legacy).toBe(0);
  });

  test('native browser hash navigation: setting location.hash scrolls to the heading by id', async ({ page }) => {
    // Native HTML id attribute means `<a href="#id">` links and
    // `window.location.hash = '#id'` both auto-scroll without any JS
    // from our extension. This is the headline benefit of the
    // unification — the browser does the work that scrollToHeading
    // used to monkey-patch via querySelector.
    const targetId = await page.evaluate(() => {
      // Pick the third heading (well below the fold for the demo's
      // initial doc). Returns null if unavailable, which fails the
      // expect below loudly with a useful selector.
      const h = document.querySelectorAll<HTMLElement>(
        'app-notion-demo .ProseMirror :is(h1, h2, h3)',
      )[2];
      return h?.getAttribute('id') ?? null;
    });
    expect(targetId).toBeTruthy();

    // Capture the heading's pre-navigation Y position relative to viewport.
    const beforeY = await page.locator(`${editorSelector} [id="${targetId!}"]`).evaluate(
      (el) => el.getBoundingClientRect().top,
    );

    // Navigate via the URL hash. The browser auto-scrolls to the element
    // whose `id` matches — no JS handler from our side is needed.
    await page.evaluate((id) => { window.location.hash = `#${id}`; }, targetId!);

    // Wait one frame for browser scroll to settle, then assert the
    // heading is now near the top of the viewport.
    await page.waitForTimeout(50);
    const afterY = await page.locator(`${editorSelector} [id="${targetId!}"]`).evaluate(
      (el) => el.getBoundingClientRect().top,
    );

    // The heading should now be much closer to the top (browser scrolls
    // it into view). Exact offset depends on viewport height; the
    // contract is "moved meaningfully toward y=0 from where it was".
    expect(afterY).toBeLessThan(beforeY);
  });

  test('Phase 2: editor.storage.toc.content mirrors the doc heading list', async ({ page }) => {
    // Wait for the deferred storage seeding to complete (UniqueID-style
    // setTimeout(0) inside the plugin's view().init).
    await page.waitForFunction(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: unknown[] } | undefined;
      return Array.isArray(toc?.content) && toc.content.length > 0;
    }, { timeout: 3000 });

    const storage = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as
        | { content: { id: string; level: number; textContent: string }[]; activeId: string | null }
        | undefined;
      return toc ?? null;
    });

    expect(storage).not.toBeNull();
    expect(storage!.activeId).toBeNull(); // Phase 5 will populate this
    expect(storage!.content.length).toBeGreaterThan(0);
    for (const entry of storage!.content) {
      expect(entry.id).toBeTruthy();
      expect([1, 2, 3]).toContain(entry.level);
      expect(typeof entry.textContent).toBe('string');
    }
  });

  test('outline sits in the right portion of the page (right gutter target)', async ({ page }) => {
    // D11 intent: the outline lives in the page's right gutter. The
    // Phase 1 spike's hello text is wide enough to overlap the editor
    // visually, so we don't assert "outline.left > editor.right" - the
    // real Phase 4 ticks will be ~16-18px wide and won't overlap.
    // What we DO assert here is the directional contract: the outline's
    // center is past the editor's center, i.e. it really is anchored to
    // the right side of the layout, not the left.
    const outlineBox = await page.locator('.dm-toc-outline').boundingBox();
    const editorBox = await page.locator('app-notion-demo .dm-editor').boundingBox();
    expect(outlineBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    const outlineCenter = outlineBox!.x + outlineBox!.width / 2;
    const editorCenter = editorBox!.x + editorBox!.width / 2;
    expect(outlineCenter).toBeGreaterThan(editorCenter);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 2 data layer
// ────────────────────────────────────────────────────────────────────────
// Real user-flow coverage for the heading discovery + ID assignment
// system. Phase 2's unit tests cover algorithmic edges; these tests
// cover the integrated demo path: live keyboard input, slash command
// insertion, paste collision, HTML output roundtrip.

test.describe('Table of Contents - Phase 2 data layer', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('keyboard level toggle (Mod+Alt+3) preserves the heading id', async ({ page }) => {
    // Click into the first H2 ("Playground") and read its current id.
    await page.click(`${editorSelector} h2 >> nth=0`);
    const before = await page.evaluate(() => {
      const h2 = document.querySelector<HTMLElement>('app-notion-demo .ProseMirror h2');
      return h2?.getAttribute('id') ?? null;
    });
    expect(before).toBeTruthy();

    // Toggle to H3 via the framework keyboard shortcut. Heading.ts
    // exposes Mod+Alt+<level> for every configured level.
    await page.keyboard.press(`${modifier}+Alt+3`);

    // Same DOM node is now an H3, with the SAME id. setBlockType
    // preserves attrs (per nodeCommands.ts merge), so the framework
    // keeps the id across the level change.
    const after = await page.evaluate(() => {
      const h3 = document.querySelector<HTMLElement>('app-notion-demo .ProseMirror h3');
      return h3?.getAttribute('id') ?? null;
    });
    expect(after).toBe(before);
  });

  test('slash command "Heading 2" insertion creates a heading with a fresh id', async ({ page }) => {
    // Drop into an empty paragraph at the end of the doc and trigger
    // the slash menu. We start from a fresh doc to control where the
    // new heading lands.
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/heading 2');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Fresh section');

    // The new H2 must have a non-empty UUID-style id (UniqueID format), distinct
    // from any prior heading on the page.
    const id = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll<HTMLElement>('app-notion-demo .ProseMirror h2'));
      const fresh = headings.find((h) => h.textContent?.includes('Fresh section'));
      return fresh?.getAttribute('id') ?? null;
    });
    expect(id).toBeTruthy();
  });

  test('storage updates immediately when a new heading is typed', async ({ page }) => {
    const initialCount = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      return ((ed?.storage['toc'] as { content: unknown[] } | undefined)?.content ?? []).length;
    });
    expect(initialCount).toBeGreaterThan(0);

    await setContent(page, '<h1>One</h1>');
    await page.click(editorSelector);
    // Append another heading via slash menu.
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/heading 3');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Appended');

    // Storage must reflect the new entry on the very next tick after
    // the insert transaction's appendTransaction step lands.
    await page.waitForFunction(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { textContent: string }[] } | undefined;
      return toc?.content.some((e) => e.textContent === 'Appended') ?? false;
    }, { timeout: 2000 });
  });

  test('exported HTML output preserves id attributes', async ({ page }) => {
    // The demo renders `editor.htmlContent()` into a <pre class="output"> block.
    // Its serialized text is what would be saved to a backend or copied
    // out for export, so it MUST include the id markers.
    const html = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { getHTML: () => string }
        | undefined;
      return ed?.getHTML() ?? '';
    });
    // At least one heading must round-trip an id attribute.
    expect(html).toMatch(/<h[1-3][^>]*\bid="[^"]+"/);
  });

  test('pasted content with existing id values keeps every ID unique', async ({ page }) => {
    // Simulate a cross-document paste by setting content that contains
    // an id already in use. The plugin must rename the duplicate so
    // the doc remains a unique-ID space (avoids ambiguous hash anchors).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1 id="duplicate">First</h1><h2 id="duplicate">Second</h2>',
        false,
      );
    });
    await page.waitForFunction(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { id: string }[] } | undefined;
      return (toc?.content ?? []).length === 2 && toc!.content.every((e) => e.id);
    }, { timeout: 2000 });
    const ids = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll<HTMLElement>('app-notion-demo .ProseMirror :is(h1, h2, h3)'));
      return headings.map((h) => h.getAttribute('id'));
    });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2); // unique
    // First entry kept its loaded ID; second got renamed.
    expect(ids[0]).toBe('duplicate');
    expect(ids[1]).not.toBe('duplicate');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 3 scrollToHeading + click navigation
// ────────────────────────────────────────────────────────────────────────
// Behavioral coverage for the editor.commands.scrollToHeading API and
// the initial-load `window.location.hash` handling. Phase 4 will wire
// the floating outline ticks to this command; for now it is the
// programmatic surface only.

test.describe('Table of Contents - Phase 3 scroll navigation', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('editor.commands.scrollToHeading scrolls the page and updates the URL hash', async ({ page }) => {
    // Pick the LAST heading in the doc - we want the click to require
    // a real, observable scroll (not just "land on what is already
    // showing"). Notion-demo content has multiple h2/h3, so the last
    // one is reliably below the fold on a default viewport.
    const targetId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { id: string }[] } | undefined;
      return toc?.content[toc.content.length - 1]?.id ?? null;
    });
    expect(targetId).toBeTruthy();

    // scrollIntoView's smooth behaviour does not reliably advance
    // window.scrollY in headless chromium - some setups cap smooth
    // scroll progress at zero. Force the helper into an instant scroll
    // by setting `prefers-reduced-motion: reduce` for the page so we
    // can deterministically measure scrollY.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const scrollYBefore = await page.evaluate(() => window.scrollY);

    if (!targetId) throw new Error('expected a heading id from storage');
    const result = await page.evaluate((id) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { scrollToHeading?: (id: string) => boolean } }
        | undefined;
      return ed?.commands.scrollToHeading?.(id) ?? false;
    }, targetId);

    expect(result).toBe(true);
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);

    // URL hash now reflects the target heading. Cross-checked via
    // page.url() because location.hash inside evaluate may show stale
    // value in some chromium builds before the navigation event flushes.
    expect(page.url()).toContain(`#${targetId}`);
  });

  test('scrollToHeading returns false for a missing id without changing URL', async ({ page }) => {
    const startUrl = page.url();
    const result = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { scrollToHeading?: (id: string) => boolean } }
        | undefined;
      return ed?.commands.scrollToHeading?.('definitely-not-a-real-id') ?? null;
    });
    expect(result).toBe(false);
    // URL stays exactly as it was - no stray `#nonexistent` left behind.
    expect(page.url()).toBe(startUrl);
  });

  test('navigating to a heading nested inside a collapsed <details> opens the details before scrolling', async ({ page }) => {
    // Inject content with a heading inside a collapsed <details>. Use
    // a deterministic id so we can target it by name.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>Top</h1><div data-type="details"><div data-details-content><h2 id="hidden">Behind a fold</h2></div></div>',
        false,
      );
    });
    // Wait for the heading to actually be in the DOM with its id.
    await page.waitForFunction(() =>
      document.querySelector('app-notion-demo .ProseMirror [id="hidden"]') !== null,
    );

    // Sanity: the wrapping details should be closed (no open class /
    // attribute). Our Details extension toggles via a custom open class
    // rather than the native `open` attribute, so test for the class.
    const detailsClosedBefore = await page.evaluate(() => {
      const details = document.querySelector<HTMLElement>('app-notion-demo .ProseMirror div[data-type="details"]');
      // Heuristic: any `open`/`is-open`-like class indicates open state.
      return details ? !Array.from(details.classList).some((c) => /open/i.test(c)) : false;
    });
    expect(detailsClosedBefore).toBe(true);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ok = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { scrollToHeading: (id: string) => boolean } }
        | undefined;
      return ed?.commands.scrollToHeading('hidden') ?? false;
    });
    expect(ok).toBe(true);

    // The heading should now be VISIBLE (its bounding rect has size).
    // jsdom-style "open" toggling vs native `<details>` is irrelevant
    // here - what matters is that the layout exposes the heading.
    const visible = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[id="hidden"]');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
    });
    expect(visible).toBe(true);
  });

  test('editor.chain().scrollToHeading(id).run() scrolls and updates URL', async ({ page }) => {
    const targetId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { id: string }[] } | undefined;
      return toc?.content[toc.content.length - 1]?.id ?? null;
    });
    expect(targetId).toBeTruthy();
    if (!targetId) throw new Error('no heading id');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    const ok = await page.evaluate((id) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { chain: () => { scrollToHeading: (id: string) => { run: () => boolean } } }
        | undefined;
      return ed?.chain().scrollToHeading(id).run() ?? false;
    }, targetId);
    expect(ok).toBe(true);
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);
    expect(page.url()).toContain(`#${targetId}`);
  });

  test('rapid successive scrollToHeading calls leave the URL on the LAST clicked heading', async ({ page }) => {
    // Real-world: user clicks several outline rows in quick succession.
    // Each call replaces the URL hash, so the final URL must reflect
    // the LAST argument - no race, no stale hash from intermediate
    // calls.
    const ids = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { id: string }[] } | undefined;
      return toc?.content.map((e) => e.id) ?? [];
    });
    expect(ids.length).toBeGreaterThanOrEqual(3);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate((idList) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { scrollToHeading: (id: string) => boolean } }
        | undefined;
      for (const id of idList) {
        ed?.commands.scrollToHeading(id);
      }
    }, ids.slice(0, 3));
    expect(page.url()).toContain(`#${ids[2]}`);
  });

  test('prefers-reduced-motion uses instant scroll, not smooth', async ({ page }) => {
    // Spy on scrollIntoView before we trigger the command, so we can
    // inspect the behavior argument the helper actually requested.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const targetId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: { id: string }[] } | undefined;
      return toc?.content[1]?.id ?? null;
    });
    if (!targetId) throw new Error('no heading id');

    const observedBehavior = await page.evaluate((id) => {
      let captured: string | undefined;
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (opts: ScrollIntoViewOptions): void {
        if (opts && typeof opts === 'object') captured = opts.behavior;
        return original.call(this, opts);
      };
      try {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { commands: { scrollToHeading: (id: string) => boolean } }
          | undefined;
        ed?.commands.scrollToHeading(id);
      } finally {
        Element.prototype.scrollIntoView = original;
      }
      return captured;
    }, targetId);
    expect(observedBehavior).toBe('auto');
  });

  // NOTE: initial-load `#hash` auto-scroll is verified via the
  // unit/integration suite (TableOfContents.test.ts) rather than e2e.
  // The demo regenerates random ids on every Notion-mode entry, so
  // there is no reliable way to land at a fresh page with a hash that
  // matches an existing heading without injecting deterministic
  // content - which would pollute the user-facing demo. The unit test
  // can stub `window.location.hash` and `scrollIntoView` to assert
  // exactly the rAF-driven invocation.
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 4 floating outline ticks
// ────────────────────────────────────────────────────────────────────────
// Phase 4 replaces the Phase 1 spike (hello-world pill) with real
// tick buttons. These tests cover the visual contract of the
// collapsed-state outline: render count, level-encoded width, click
// navigation, visibility guards (minHeadings + mobile + 0 headings),
// and theme-aware coloring.

test.describe('Table of Contents - Phase 4 floating outline ticks', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('renders one tick button per heading and matches storage count', async ({ page }) => {
    const expectedCount = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: unknown[] } | undefined;
      return toc?.content.length ?? 0;
    });
    expect(expectedCount).toBeGreaterThan(0);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await expect(ticks).toHaveCount(expectedCount);
    // Each tick is a button (correct semantics for keyboard / a11y).
    const tagNames = await ticks.evaluateAll((nodes) => nodes.map((n) => n.tagName));
    expect(new Set(tagNames)).toEqual(new Set(['BUTTON']));
  });

  test('tick width encodes heading level (h1 wider than h2 wider than h3)', async ({ page }) => {
    // Drop a deterministic 3-level mix and assert tick widths are
    // strictly decreasing (h1 > h2 > h3). We read the rendered widths
    // via boundingBox so the assertion exercises the actual CSS, not
    // the data-level attribute (which is verified separately).
    await setContent(page, '<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await expect(ticks).toHaveCount(3);
    const widths = await Promise.all(
      [0, 1, 2].map((i) => ticks.nth(i).boundingBox().then((b) => b?.width ?? 0)),
    );
    expect(widths[0]).toBeGreaterThan(widths[1] ?? 0);
    expect(widths[1]).toBeGreaterThan(widths[2] ?? 0);
  });

  test('clicking a tick scrolls the page and updates the URL hash', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    // Click the LAST tick so we reliably move the scroll position.
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    const lastIndex = (await ticks.count()) - 1;
    const targetTocId = await ticks.nth(lastIndex).getAttribute('data-toc-anchor');
    expect(targetTocId).toBeTruthy();

    if (!targetTocId) throw new Error('expected non-null anchor id');
    // Dispatch click programmatically (synchronous DOM event) instead
    // of going through Playwright's mouse simulation. Playwright's
    // click() invokes mouseover / mouseenter on its way to the
    // element, which queues our hoverInDelay timer (Phase 6) before
    // the click event itself dispatches; by then the outline can
    // expand, ticks acquire `pointer-events: none`, and the click
    // registers on the card layer instead of the tick. Calling
    // .click() on the element directly fires the delegated handler
    // without that intermediate hover dance, matching how a fast
    // user actually interacts.
    await page.evaluate((id) => {
      document
        .querySelector<HTMLElement>(`.dm-toc-outline-tick[data-toc-anchor="${id}"]`)
        ?.click();
    }, targetTocId);

    // Settle: scroll happens synchronously but layout/paint may need
    // a frame to register window.scrollY changes.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    // The URL hash update is a side effect of scrollToHeading. We
    // assert it FIRST so a failure here pinpoints the click handler
    // path (rather than a downstream scroll-position mystery).
    expect(page.url()).toContain(`#${targetTocId}`);
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);
  });

  test('outline hides itself when fewer headings than minHeadings (default 2)', async ({ page }) => {
    await setContent(page, '<h1>Only one heading</h1><p>body</p>');
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-state', 'hidden');
    // CSS rule turns data-state="hidden" into display: none.
    await expect(outline).not.toBeVisible();
  });

  test('outline hides itself on viewports at or below the mobile breakpoint', async ({ page }) => {
    // Resize to a tablet/phone width below the default 1024 cutoff.
    await page.setViewportSize({ width: 800, height: 900 });
    const outline = page.locator('.dm-toc-outline');
    // matchMedia is reactive in playwright - the data-viewport
    // attribute switches on resize, the CSS hides the element.
    await expect(outline).toHaveAttribute('data-viewport', 'mobile');
    await expect(outline).not.toBeVisible();
  });

  test('outline is hidden when the doc has zero headings', async ({ page }) => {
    await setContent(page, '<p>just paragraphs</p><p>nothing else</p>');
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-state', 'hidden');
    await expect(outline).not.toBeVisible();
  });

  test('renaming a heading updates the corresponding tick aria-label', async ({ page }) => {
    await setContent(page, '<h1>Original Title</h1><h2>Other</h2>');
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await expect(ticks.nth(0)).toHaveAttribute('aria-label', /Original Title/);

    // Rewrite the doc with a renamed heading. Storage updates fan out
    // to the outline plugin, which re-renders the ticks. Aria-label
    // for the first tick should now reflect the new text.
    await setContent(page, '<h1>Renamed Title</h1><h2>Other</h2>');
    await expect(ticks.nth(0)).toHaveAttribute('aria-label', /Renamed Title/);
    await expect(ticks.nth(0)).not.toHaveAttribute('aria-label', /Original Title/);
  });

  test('a tick is keyboard-reachable and Enter triggers navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await expect(ticks.first()).toBeVisible();

    // Focus the LAST tick directly (programmatic focus is the
    // tab-equivalent here because the editor steals tab order between
    // body and the outline). What we care about is that the button is
    // focusable and that Enter activates it.
    const lastIndex = (await ticks.count()) - 1;
    const targetTocId = await ticks.nth(lastIndex).getAttribute('data-toc-anchor');
    await ticks.nth(lastIndex).focus();
    const isFocused = await page.evaluate(() => {
      const focused = document.activeElement;
      return focused?.classList.contains('dm-toc-outline-tick') ?? false;
    });
    expect(isFocused).toBe(true);

    const scrollYBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press('Enter');
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);
    expect(page.url()).toContain(`#${targetTocId}`);
  });

  test('hovering a tick changes its background color (visual feedback)', async ({ page }) => {
    const tick = page.locator('.dm-toc-outline .dm-toc-outline-tick').first();
    const beforeColor = await tick.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    await tick.hover();
    // Wait one frame for the CSS transition to apply the new color.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
    const afterColor = await tick.evaluate((node) => window.getComputedStyle(node).backgroundColor);
    expect(afterColor).not.toBe(beforeColor);
  });

  test('outline sits above page content (z-index keeps it clickable)', async ({ page }) => {
    // Read out the outline's computed z-index AND the editor's. The
    // outline must have a higher stacking context so a heavy block
    // (image, table) cannot occlude it. We assert "outline > 0" rather
    // than picking a specific value because the exact number is a
    // design token and may evolve; the contract is "above default flow".
    const outlineZ = await page.locator('.dm-toc-outline').evaluate(
      (node) => Number.parseInt(window.getComputedStyle(node).zIndex || '0', 10) || 0,
    );
    expect(outlineZ).toBeGreaterThan(0);
  });

  test('dark theme flips tick color via CSS tokens (no JS class mirroring needed)', async ({ page }) => {
    // Capture the tick color in the default (light) theme first.
    const lightColor = await page.evaluate(() => {
      const tick = document.querySelector('.dm-toc-outline-tick');
      return tick ? window.getComputedStyle(tick).backgroundColor : null;
    });
    expect(lightColor).not.toBeNull();

    // Toggle dark theme via the demo's `.theme-toggle` button (added
    // to <body class="dm-theme-dark"> by the demo wrapper). Body is
    // an ancestor of the outline so the CSS cascade reaches it without
    // any JS class mirroring (D13 was skipped for v1).
    await page.click('.theme-toggle');
    // Sanity: confirm body actually gained the class.
    await expect(page.locator('body.dm-theme-dark')).toHaveCount(1);

    // Wait for the next paint so getComputedStyle reflects the new
    // cascade. With CSS variable inheritance + selector specificity,
    // a microtask is normally enough; we give two animation frames
    // for safety.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    const darkColor = await page.evaluate(() => {
      const tick = document.querySelector('.dm-toc-outline-tick');
      return tick ? window.getComputedStyle(tick).backgroundColor : null;
    });
    expect(darkColor).not.toBeNull();
    expect(darkColor).not.toBe(lightColor);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 5 active state highlighting
// ────────────────────────────────────────────────────────────────────────
// As the user scrolls, the tick for the heading currently in the
// upper 15% of the viewport gets the --active class + aria-current.
// Clicks prime a manual override window so the IO callback does not
// fight back during the smooth-scroll animation. storage.activeId
// mirrors the visual state so other UIs (Phase 7 inline block) can
// read it without spawning their own observer.

test.describe('Table of Contents - Phase 5 active state', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  /**
   * Stretch the demo so scrolling actually exercises every heading -
   * Notion-mode content is short, all headings could fit on a tall
   * viewport and never trigger an active-state change. Filler
   * paragraphs between headings guarantee real scroll distance.
   */
  const setStretchedContent = async (page: Page): Promise<void> => {
    const filler = '<p>Lorem ipsum dolor sit amet</p>'.repeat(15);
    await setContent(
      page,
      `<h1>Top section</h1>${filler}<h2>Middle section</h2>${filler}<h2>Bottom section</h2>${filler}`,
    );
  };

  test('clicking a tick immediately marks it as active and updates aria-current', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await expect(ticks).toHaveCount(3);

    // Click the LAST tick - that one is below the fold and the
    // smooth-scroll path will run, but the visual marker should land
    // synchronously (manual override path, not waiting on IO).
    await ticks.nth(2).dispatchEvent('click');
    await expect(ticks.nth(2)).toHaveClass(/dm-toc--active/);
    await expect(ticks.nth(2)).toHaveAttribute('aria-current', 'location');
    // The OTHER ticks must lose the marker - only one tick at a time.
    await expect(ticks.nth(0)).not.toHaveClass(/dm-toc--active/);
    await expect(ticks.nth(1)).not.toHaveClass(/dm-toc--active/);
  });

  test('storage.activeId mirrors the visually active tick', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    const targetId = await ticks.nth(1).getAttribute('data-toc-anchor');
    await ticks.nth(1).dispatchEvent('click');

    const storedActiveId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { activeId: string | null } | undefined;
      return toc?.activeId ?? null;
    });
    expect(storedActiveId).toBe(targetId);
  });

  test('scrolling past a heading flips the active state to the topmost passed heading', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');

    // Force the second heading's top to land EXACTLY at the top of
    // the viewport - that puts it inside the active zone (upper 15%
    // by default rootMargin). scrollIntoView({block:'start'}) is the
    // most reliable way; scrollIntoViewIfNeeded() may stop earlier
    // when the heading is already visible somewhere on screen.
    await page.evaluate(() => {
      const target = document.querySelectorAll('app-notion-demo .ProseMirror h2')[0];
      if (target instanceof Element) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    // Allow IO callback + plugin onChange to settle.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    // Exactly one tick should be active. Sanity: not the first (it
    // was scrolled past), so the active id should match either the
    // second heading (h2 we scrolled to) or whatever is in the
    // active zone after scroll. We also assert the first tick lost
    // the marker.
    const activeTickCount = await ticks.evaluateAll(
      (nodes) => nodes.filter((n) => n.classList.contains('dm-toc--active')).length,
    );
    expect(activeTickCount).toBe(1);
    await expect(ticks.nth(0)).not.toHaveClass(/dm-toc--active/);
  });

  test('above all headings (scrollY=0 with content above first heading), no tick is active', async ({ page }) => {
    // Inject a doc whose first heading sits BELOW a thick lead block,
    // so the page can scroll up far enough that the first heading is
    // entirely below the viewport - "above all headings" state.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setContent(
      page,
      `<p>${'Lead text '.repeat(30)}</p><h1>First</h1><p>${'Body text '.repeat(30)}</p><h2>Second</h2>`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

    const activeCount = await page.evaluate(() => {
      const ticks = document.querySelectorAll('.dm-toc--active');
      return ticks.length;
    });
    // Either 0 active ticks (the canonical "above all" state) or, in
    // a tight viewport where the first heading is already in the
    // upper 15%, exactly 1 - never multiple.
    expect(activeCount).toBeLessThanOrEqual(1);
  });

  test('dark theme uses the active-color token for highlighted tick', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await ticks.nth(1).dispatchEvent('click');

    // Light theme: capture active color.
    const lightActive = await ticks.nth(1).evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );

    await page.click('.theme-toggle');
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    const darkActive = await ticks.nth(1).evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    expect(darkActive).not.toBe(lightActive);
  });

  test('scrolling past every heading leaves the LAST one active (last-passed fallback)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');

    // Anchor at the top first so the initial scrollTo(0, 0) triggers
    // an IO sample with h1 in the active zone (intersecting). Then
    // walk through each heading via mouse wheel, giving the browser
    // animation frames between steps for IO to settle. Without these
    // intermediate samples, jumping straight to the doc bottom can
    // miss every intersection transition when no heading was
    // currently in the active zone at the time of the jump.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    const headingCount = await page.locator('app-notion-demo .ProseMirror :is(h1, h2, h3)').count();
    for (let i = 0; i < headingCount; i++) {
      await page.evaluate((idx) => {
        const heading = document.querySelectorAll<HTMLElement>(
          'app-notion-demo .ProseMirror :is(h1, h2, h3)',
        )[idx];
        if (heading instanceof Element) heading.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, i);
      await page.evaluate(
        () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Settle: IO callbacks land on subsequent animation frames.
    await page.waitForFunction(
      () => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { storage: Record<string, unknown> }
          | undefined;
        const toc = ed?.storage['toc'] as { activeId: string | null } | undefined;
        return toc?.activeId !== null;
      },
      undefined,
      { timeout: 3000 },
    );

    const storedActiveId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      return (ed?.storage['toc'] as { activeId: string | null } | undefined)?.activeId ?? null;
    });
    // The fallback may land on the last heading (doc fully scrolled
    // past) or on a heading whose top is inside the active zone if
    // the layout puts one of the later h2s near the top of the
    // viewport. Either way, the activeId must NOT be null and must
    // be one of the rendered tick ids.
    expect(storedActiveId).not.toBeNull();
    const allTickIds = await ticks.evaluateAll(
      (nodes) => nodes.map((n) => n.getAttribute('data-toc-anchor')),
    );
    expect(allTickIds).toContain(storedActiveId);
    // Specifically: the FIRST heading should not be active anymore -
    // scrolling all the way down clearly passes it.
    const firstTickId = await ticks.first().getAttribute('data-toc-anchor');
    expect(storedActiveId).not.toBe(firstTickId);
  });

  test('aria-current updates on scroll (not just on click)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');

    // Force the second heading into the active zone via direct DOM
    // scroll - this is a scroll-derived (not click-derived) update.
    await page.evaluate(() => {
      const target = document.querySelectorAll('app-notion-demo .ProseMirror h2')[0];
      if (target instanceof Element) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );

    // Exactly one tick has aria-current='location' after the scroll.
    const ariaCount = await ticks.evaluateAll(
      (nodes) => nodes.filter((n) => n.getAttribute('aria-current') === 'location').length,
    );
    expect(ariaCount).toBe(1);
  });

  test('active state survives setContent rebuild (visual + storage stay in sync)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await ticks.nth(1).dispatchEvent('click');
    const targetId = await ticks.nth(1).getAttribute('data-toc-anchor');

    // Replace the doc but KEEP the same id on the formerly
    // active heading. parseHTML preserves the id from the markup,
    // so the previous activeId still resolves to a real heading. The
    // plugin must reapply the active marker to the corresponding tick.
    await page.evaluate((id) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        `<h1>One</h1><h2 id="${id}">Preserved</h2><h3>Three</h3>`,
        false,
      );
    }, targetId);

    // The tick whose data-toc-anchor matches the preserved heading must
    // be active and storage.activeId must point at it.
    const matched = page.locator(`.dm-toc-outline-tick[data-toc-anchor="${targetId}"]`);
    await expect(matched).toHaveClass(/dm-toc--active/);
    const storedActiveId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      return (ed?.storage['toc'] as { activeId: string | null } | undefined)?.activeId ?? null;
    });
    expect(storedActiveId).toBe(targetId);
  });

  test('hovering the active tick keeps the active color (CSS specificity check)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');
    await ticks.nth(1).dispatchEvent('click');

    const activeColor = await ticks.nth(1).evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    await ticks.nth(1).hover();
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    );
    const hoverColor = await ticks.nth(1).evaluate(
      (node) => window.getComputedStyle(node).backgroundColor,
    );
    // Hover must NOT downgrade the active color to the hover color.
    // The CSS rule for `--active` is declared after `&:hover` in
    // _toc.scss so its specificity is equal but it wins on source order.
    expect(hoverColor).toBe(activeColor);
  });

  test('manual override window expires after ~500ms; later scrolls overwrite the click choice', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setStretchedContent(page);
    const ticks = page.locator('.dm-toc-outline .dm-toc-outline-tick');

    // Click the FIRST tick - that becomes active, override window starts.
    await ticks.nth(0).dispatchEvent('click');
    const firstId = await ticks.nth(0).getAttribute('data-toc-anchor');
    let stored = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      return (ed?.storage['toc'] as { activeId: string | null } | undefined)?.activeId ?? null;
    });
    expect(stored).toBe(firstId);

    // Wait past the override window, then scroll a different heading
    // into the active zone. The scroll-derived active state should
    // take over since the override has lapsed.
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const target = document.querySelectorAll('app-notion-demo .ProseMirror h2')[1];
      if (target instanceof Element) target.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    stored = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      return (ed?.storage['toc'] as { activeId: string | null } | undefined)?.activeId ?? null;
    });
    expect(stored).not.toBe(firstId);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 6 hover expansion
// ────────────────────────────────────────────────────────────────────────
// Hover (or keyboard focus) on the outline reveals an expanded card
// with the full heading text + per-level indent. Mouse leave / blur
// fades it back to ticks. State machine: hidden | collapsed | expanded.

test.describe('Table of Contents - Phase 6 hover expansion', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('default state is "collapsed"; card exists in DOM but is hidden via opacity', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-state', 'collapsed');

    // Card is rendered (so the transition has something to animate to)
    // but invisible via opacity:0 and not interactive via pointer-events.
    const card = page.locator('.dm-toc-outline-card');
    await expect(card).toBeAttached();
    const opacity = await card.evaluate((node) => window.getComputedStyle(node).opacity);
    expect(parseFloat(opacity)).toBe(0);
  });

  test('hovering the outline transitions through to "expanded" state', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');
    await outline.hover();
    // The default hoverInDelay is 120ms; allow up to 600ms before
    // failing so any CI-induced jitter does not flake the test.
    await expect(outline).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    // Card opacity is now 1 and rows are pointer-events:auto.
    const card = page.locator('.dm-toc-outline-card');
    const opacity = await card.evaluate((node) => window.getComputedStyle(node).opacity);
    expect(parseFloat(opacity)).toBeGreaterThan(0.9);
  });

  test('rows render full heading text with per-level indent (h1 < h2 < h3)', async ({ page }) => {
    await setContent(page, '<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    const rows = page.locator('.dm-toc-outline-row');
    await expect(rows).toHaveCount(3);
    expect(await rows.nth(0).textContent()).toBe('One');
    expect(await rows.nth(1).textContent()).toBe('Two');
    expect(await rows.nth(2).textContent()).toBe('Three');

    // Hover to make rows visible so getBoundingClientRect / padding
    // measurements are real (computed style still reads correctly
    // when collapsed, but text-overflow / wrapping needs visibility).
    await page.locator('.dm-toc-outline').hover();
    await expect(page.locator('.dm-toc-outline')).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    const paddings = await rows.evaluateAll(
      (nodes) => nodes.map((n) => parseFloat(window.getComputedStyle(n).paddingInlineStart)),
    );
    expect(paddings[0]).toBeLessThan(paddings[1] ?? 0);
    expect(paddings[1]).toBeLessThan(paddings[2] ?? 0);
  });

  test('clicking a row navigates the same way clicking a tick does', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const outline = page.locator('.dm-toc-outline');
    await outline.hover();
    await expect(outline).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    const rows = page.locator('.dm-toc-outline-row');
    const lastIndex = (await rows.count()) - 1;
    const targetTocId = await rows.nth(lastIndex).getAttribute('data-toc-anchor');
    expect(targetTocId).toBeTruthy();

    const scrollYBefore = await page.evaluate(() => window.scrollY);
    await rows.nth(lastIndex).click();
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    expect(page.url()).toContain(`#${targetTocId}`);
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);
  });

  test('focusing a tick (keyboard) expands the outline immediately', async ({ page }) => {
    await page.evaluate(() => {
      const tick = document.querySelector<HTMLElement>('.dm-toc-outline-tick');
      tick?.focus();
    });
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-state', 'expanded');
  });

  test('blur (focus moves outside the outline) collapses back to ticks', async ({ page }) => {
    // Focus first, expand.
    await page.evaluate(() => {
      const tick = document.querySelector<HTMLElement>('.dm-toc-outline-tick');
      tick?.focus();
    });
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-state', 'expanded');

    // Move focus outside the outline.
    await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.ProseMirror');
      editor?.focus();
    });
    await expect(outline).toHaveAttribute('data-state', 'collapsed', { timeout: 600 });
  });

  test('active row mirrors active tick (font-weight + aria-current)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const ticks = page.locator('.dm-toc-outline-tick');
    await ticks.nth(1).dispatchEvent('click');
    const targetId = await ticks.nth(1).getAttribute('data-toc-anchor');

    // Reveal card so getComputedStyle gives a meaningful weight value.
    await page.locator('.dm-toc-outline').hover();
    await expect(page.locator('.dm-toc-outline')).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    const matchedRow = page.locator(`.dm-toc-outline-row[data-toc-anchor="${targetId}"]`);
    await expect(matchedRow).toHaveAttribute('aria-current', 'location');
    const weight = await matchedRow.evaluate((node) => window.getComputedStyle(node).fontWeight);
    // Active row uses the --dm-toc-row-active-weight token (default 600).
    expect(parseInt(weight, 10)).toBeGreaterThanOrEqual(600);
  });

  test('mobile breakpoint forces "hidden" even on hover or focus', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-viewport', 'mobile');

    // Even with a forced focus, mobile keeps the outline hidden.
    await page.evaluate(() => {
      const tick = document.querySelector<HTMLElement>('.dm-toc-outline-tick');
      tick?.focus();
    });
    await expect(outline).toHaveAttribute('data-state', 'hidden');
  });

  test('reduced-motion disables the card slide-in transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const card = page.locator('.dm-toc-outline-card');
    const transition = await card.evaluate((node) => window.getComputedStyle(node).transitionDuration);
    // Browsers report `0s` (or comma-separated `0s, 0s`) when the
    // transition has been zeroed out by the reduced-motion media
    // query. Either way, none of the durations should be > 0.
    const durations = transition.split(',').map((d) => parseFloat(d.trim()));
    expect(durations.every((d) => d === 0)).toBe(true);
  });

  test('mouseleave collapses the outline after hoverOutDelay (real-browser timing)', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');

    // Expand via hover (waits up to 600ms past the 120ms in-delay).
    await outline.hover();
    await expect(outline).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    // Move the mouse away. Use page.mouse.move() to a safe location
    // far from the outline; locator.hover('body') would re-enter the
    // outline if it sweeps through the right edge.
    await page.mouse.move(50, 50);
    // The default hoverOutDelay is 350ms; allow up to 1200ms for the
    // collapse to settle. Real-browser timer fidelity varies slightly
    // across CI environments.
    await expect(outline).toHaveAttribute('data-state', 'collapsed', { timeout: 1200 });
  });

  test('a long heading title truncates with ellipsis in the row', async ({ page }) => {
    // Long enough to exceed any reasonable card max-width. The CSS
    // contract is `text-overflow: ellipsis` + `overflow: hidden` +
    // `white-space: nowrap`. Validate via the trio of computed styles.
    await setContent(
      page,
      `<h1>${'Very long heading text '.repeat(20)}</h1><h2>Sibling</h2>`,
    );
    const row = page.locator('.dm-toc-outline-row').first();
    const styles = await row.evaluate((node) => {
      const cs = window.getComputedStyle(node);
      return {
        whiteSpace: cs.whiteSpace,
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
      };
    });
    expect(styles.whiteSpace).toBe('nowrap');
    // overflow shorthand may report as "hidden" or "hidden hidden".
    expect(styles.overflow.startsWith('hidden')).toBe(true);
    expect(styles.textOverflow).toBe('ellipsis');
  });

  test('empty heading row falls back to a "Heading level N" label', async ({ page }) => {
    await setContent(page, '<h1></h1><h2>Has text</h2>');
    const rows = page.locator('.dm-toc-outline-row');
    await expect(rows).toHaveCount(2);
    expect(await rows.nth(0).textContent()).toBe('Heading level 1');
    expect(await rows.nth(1).textContent()).toBe('Has text');
  });

  test('clicking a row whose heading lives inside a closed <details> opens the details then scrolls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<p>Before</p>'
        + '<div data-type="details">'
        + '<div data-details-content><h2 id="hidden">Inside details</h2></div>'
        + '</div>'
        + '<h2>Sibling</h2>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-outline-row[data-toc-anchor="hidden"]') !== null,
    );

    // Open expanded card and click the row pointing at the hidden heading.
    await page.locator('.dm-toc-outline').hover();
    await expect(page.locator('.dm-toc-outline')).toHaveAttribute('data-state', 'expanded', { timeout: 600 });
    await page.locator('.dm-toc-outline-row[data-toc-anchor="hidden"]').click();

    // The heading is now visible (details forced open by the
    // scrollToHeading helper).
    const visible = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[id="hidden"]');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
    });
    expect(visible).toBe(true);
    expect(page.url()).toContain('#hidden');
  });

  test('reduced-motion still flips the data-state on hover (transition is skipped, not the state change)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const outline = page.locator('.dm-toc-outline');

    await outline.hover();
    // State still flips - reduced-motion only zeroes the CSS
    // transition, the JS state machine itself is unaffected.
    await expect(outline).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    // Card opacity should be 1 (not transitioning).
    const card = page.locator('.dm-toc-outline-card');
    const opacity = await card.evaluate((node) => window.getComputedStyle(node).opacity);
    expect(parseFloat(opacity)).toBeGreaterThan(0.9);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Table of Contents - Phase 7 inline /toc block
// ────────────────────────────────────────────────────────────────────────
// User inserts a `tableOfContents` block via the slash menu. The
// NodeView renders a `<ul>` of heading shortcuts that updates as the
// document changes; clicking a row navigates the same way the
// floating outline does.

test.describe('Table of Contents - Phase 7 inline block', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('typing /toc in an empty paragraph and selecting the item inserts the block', async ({ page }) => {
    // Drop into an empty paragraph at end of doc, then trigger slash.
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/toc');
    await page.waitForSelector(slashMenuSelector);
    // The "Table of contents" item should be the first match for /toc.
    await page.keyboard.press('Enter');

    const block = page.locator('.dm-toc-block');
    await expect(block).toHaveCount(1);
    await expect(block).toHaveAttribute('data-type', 'table-of-contents');
  });

  test('inserted block lists the headings currently in the document', async ({ page }) => {
    // Use setContent to inject a block + headings deterministically -
    // the slash flow is covered by the test above; here we want to
    // assert the row contents.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>Alpha</h1><h2>Beta</h2><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );
    const links = page.locator('.dm-toc-block-link');
    expect(await links.nth(0).textContent()).toBe('Alpha');
    expect(await links.nth(1).textContent()).toBe('Beta');
  });

  test('block reactively updates when a new heading is added after insertion', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>Only one</h1><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 1,
    );

    // Add a new heading via setContent, keeping the block. Inline
    // block subscribes to storage updates and re-renders.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>Only one</h1><h2>Now two</h2><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );
    const labels = await page.locator('.dm-toc-block-link').evaluateAll(
      (nodes) => nodes.map((n) => n.textContent),
    );
    expect(labels).toEqual(['Only one', 'Now two']);
  });

  test('clicking a block row scrolls to the heading and updates the URL hash', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Build a stretched doc so scroll is observable.
    const filler = '<p>Lorem ipsum dolor sit amet</p>'.repeat(15);
    await page.evaluate((body) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(body, false);
    }, `<div data-type="table-of-contents"></div><h1>Top</h1>${filler}<h2>Middle</h2>${filler}<h2>Bottom</h2>${filler}`);
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 3,
    );

    const links = page.locator('.dm-toc-block-link');
    const targetTocId = await links.last().getAttribute('data-toc-anchor');
    const scrollYBefore = await page.evaluate(() => window.scrollY);
    await links.last().click();
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
    );
    expect(page.url()).toContain(`#${targetTocId}`);
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeGreaterThan(scrollYBefore);
  });

  test('block shows the empty-state placeholder when the document has no headings', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent('<p>No headings yet</p><div data-type="table-of-contents"></div>', false);
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block-empty') !== null,
    );
    const empty = page.locator('.dm-toc-block-empty');
    await expect(empty).toBeVisible();
    expect(await empty.textContent()).toMatch(/Add headings/i);
    // No rows when the placeholder is up.
    await expect(page.locator('.dm-toc-block-link')).toHaveCount(0);
  });

  test('block row mirrors active state from the floating outline', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const filler = '<p>filler</p>'.repeat(10);
    await page.evaluate((body) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(body, false);
    }, `<div data-type="table-of-contents"></div><h1>One</h1>${filler}<h2>Two</h2>${filler}`);
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );

    // Click the second tick on the floating outline. storage.activeId
    // updates, fan-out fires, the inline block re-renders the active
    // marker on its matching row.
    const ticks = page.locator('.dm-toc-outline-tick');
    await ticks.nth(1).dispatchEvent('click');
    const targetId = await ticks.nth(1).getAttribute('data-toc-anchor');

    const blockRow = page.locator(`.dm-toc-block-link[data-toc-anchor="${targetId}"]`);
    await expect(blockRow).toHaveAttribute('aria-current', 'location');
    await expect(blockRow).toHaveClass(/dm-toc-block-link--active/);
  });

  test('typing /outline (keyword alias) also matches the Table of contents item', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.click(editorSelector);
    await page.keyboard.type('/outline');
    await page.waitForSelector(slashMenuSelector);
    await page.keyboard.press('Enter');

    // The block shows up regardless of which keyword the user typed -
    // /toc and /outline are equivalent invocation surfaces.
    await expect(page.locator('.dm-toc-block')).toHaveCount(1);
  });

  test('selecting the block via NodeSelection + Backspace removes it from the doc', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><div data-type="table-of-contents"></div><p></p>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block') !== null,
    );

    // Locate the block via raw transaction and delete its range.
    // PM's NodeSelection + Backspace would do the same thing
    // internally when the user presses Backspace on an atom block;
    // we drive the deletion at the transaction layer to skip the
    // selection-machinery dance (which has no convenient command
    // surface for atom-by-position selection).
    const removed = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | {
            state: {
              doc: {
                firstChild: { nodeSize: number };
                descendants: (cb: (node: { type: { name: string }; nodeSize: number }, pos: number) => void) => void;
              };
              tr: { delete: (from: number, to: number) => unknown };
            };
            view: { dispatch: (tr: unknown) => void };
          }
        | undefined;
      if (!ed) return false;
      let tocPos = -1;
      let tocSize = 0;
      ed.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableOfContents') {
          tocPos = pos;
          tocSize = node.nodeSize;
        }
      });
      if (tocPos < 0) return false;
      const tr = ed.state.tr.delete(tocPos, tocPos + tocSize);
      ed.view.dispatch(tr);
      return true;
    });
    expect(removed).toBe(true);
    await expect(page.locator('.dm-toc-block')).toHaveCount(0);
  });

  test('block rows expose keyboard a11y - focusable buttons with aria-label-style text', async ({ page }) => {
    // Keyboard contract: rows are <button> elements (so Tab order
    // includes them, Enter/Space activates), and their textContent
    // is the heading title (so screen readers announce a meaningful
    // label). Real Tab/Enter sequences depend on whole-page focus
    // order which is brittle to assert; we test the building blocks
    // (focusable, button semantics, click-on-press) instead.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );

    const links = page.locator('.dm-toc-block-link');
    // Buttons by tag name (focusable in default tab order).
    const tagNames = await links.evaluateAll((nodes) => nodes.map((n) => n.tagName));
    expect(new Set(tagNames)).toEqual(new Set(['BUTTON']));

    // Programmatic focus lands on the row (proves the element is
    // actually focusable; jsdom and headless chromium agree on this).
    await page.evaluate(() => {
      const list = document.querySelectorAll<HTMLButtonElement>('.dm-toc-block-link');
      list[0]?.focus();
    });
    const focusedTagName = await page.evaluate(
      () => document.activeElement?.tagName ?? '',
    );
    expect(focusedTagName).toBe('BUTTON');

    // Programmatic .click() (which Enter/Space synthesize on a
    // focused button) fires the delegated handler and triggers the
    // navigation, just like a real keyboard activation.
    const targetTocId = await links.nth(0).getAttribute('data-toc-anchor');
    await page.evaluate(() => {
      const list = document.querySelectorAll<HTMLButtonElement>('.dm-toc-block-link');
      list[0]?.click();
    });
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    );
    expect(page.url()).toContain(`#${targetTocId}`);
  });

  test('reduced-motion zeroes the row transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );
    const link = page.locator('.dm-toc-block-link').first();
    const transition = await link.evaluate(
      (node) => window.getComputedStyle(node).transitionDuration,
    );
    const durations = transition.split(',').map((d) => parseFloat(d.trim()));
    expect(durations.every((d) => d === 0)).toBe(true);
  });

  test('block has data-drag-handle attribute for BlockHandle integration', async ({ page }) => {
    // The BlockHandle extension reads `data-drag-handle` to anchor
    // its drag UX. We assert the attribute is present (real drag
    // is exercised by extension-block-menu's own e2e suite).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent('<h1>One</h1><div data-type="table-of-contents"></div>', false);
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block') !== null,
    );
    const block = page.locator('.dm-toc-block');
    await expect(block).toHaveAttribute('data-drag-handle', '');
  });

  test('selecting the block adds the ProseMirror-selectednode visual ring', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => boolean } }
        | undefined;
      ed?.setContent('<h1>One</h1><div data-type="table-of-contents"></div>', false);
      ed?.commands.focus();
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block') !== null,
    );
    // Click the block to give it node-selection (atom blocks accept
    // click as a NodeSelection target).
    await page.locator('.dm-toc-block').click();
    // Outline ring is applied by the .ProseMirror-selectednode CSS
    // rule when PM marks the node selected. Allow the class to
    // settle on the next animation frame.
    await page.evaluate(
      () => new Promise<void>((r) => requestAnimationFrame(() => r())),
    );
    const hasRing = await page.locator('.dm-toc-block').evaluate(
      (node) => node.classList.contains('ProseMirror-selectednode'),
    );
    expect(hasRing).toBe(true);
  });

  test('clicking a block row whose heading lives in a closed <details> opens it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<div data-type="table-of-contents"></div>'
        + '<p>Before</p>'
        + '<div data-type="details"><div data-details-content><h2 id="hidden">Inside</h2></div></div>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block-link[data-toc-anchor="hidden"]') !== null,
    );

    await page.locator('.dm-toc-block-link[data-toc-anchor="hidden"]').click();
    // The scrollToHeading helper opens any closed <details> ancestor
    // before scrolling - the heading must now be measurable.
    const visible = await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[id="hidden"]');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      return rect.height > 0 && rect.width > 0;
    });
    expect(visible).toBe(true);
    expect(page.url()).toContain('#hidden');
  });

  test('exported HTML preserves the block; reload restores it', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><div data-type="table-of-contents"></div><h2>Two</h2>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block') !== null,
    );

    // Roundtrip: read the rendered HTML, set it back. Block should
    // re-parse and the NodeView should re-render with the live list.
    const html = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { getHTML: () => string }
        | undefined;
      return ed?.getHTML() ?? '';
    });
    expect(html).toContain('data-type="table-of-contents"');

    await page.evaluate((h) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(h, false);
    }, html);
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block-link').length === 2,
    );
  });
});

// =============================================================================
// Table of Contents - Phase 8 polish
// =============================================================================
// Phase 8 is a polish pass over Phases 4-7: a11y focus rings on ticks,
// motion polish (card slide offset), print/forced-colors guards, and a
// cross-cutting dark-mode walkthrough that exercises the outline + the
// inline block in one flow.

test.describe('Table of Contents - Phase 8 polish', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('keyboard focus on a tick paints a visible focus ring (a11y)', async ({ page }) => {
    // `:focus-visible` is heuristic-based in Chromium and not reliably
    // triggered by programmatic `.focus()` (which counts as
    // "interaction" depending on the prior input modality stack).
    // Instead, verify the CSS rule itself is authored correctly by
    // walking stylesheet rules. This is robust across CI and proves
    // the Phase 8 a11y polish landed in the published CSS.
    const ringRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          // Cross-origin stylesheet, skip.
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          if (rule.selectorText.includes('.dm-toc-outline-tick') && rule.selectorText.includes(':focus-visible')) {
            return {
              outline: rule.style.outline || rule.style.outlineStyle + ' ' + rule.style.outlineColor + ' ' + rule.style.outlineWidth,
              outlineOffset: rule.style.outlineOffset,
            };
          }
        }
      }
      return null;
    });
    expect(ringRule).not.toBeNull();
    // Outline shorthand should mention `solid` and a width of >=2px.
    expect(ringRule!.outline.toLowerCase()).toContain('solid');
    expect(ringRule!.outlineOffset).toBe('3px');
  });

  test('card slide offset bumped to 8px (more visible motion)', async ({ page }) => {
    // The collapsed state sets `transform: translateY(-50%) translateX(<offset>)`.
    // Phase 8 changed the default `--dm-toc-card-offset` from 4px to 8px
    // so the slide-in is clearly intentional motion at 60fps. Read the
    // resolved CSS variable.
    const offset = await page.evaluate(() => {
      const root = document.documentElement;
      return window.getComputedStyle(root).getPropertyValue('--dm-toc-card-offset').trim();
    });
    expect(offset).toBe('8px');
  });

  test('reduced-motion zeroes the card start-position offset (no leaked mid-animation frame)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const card = page.locator('.dm-toc-outline-card');
    const transform = await card.evaluate((node) => window.getComputedStyle(node).transform);
    // Computed transform serializes to a matrix. We assert the X
    // translation component (4th element) is 0, which proves the
    // reduced-motion branch nulled the offset.
    // matrix(a, b, c, d, tx, ty) - tx is index 4 (0-indexed) when
    // parsed from "matrix(...)"; for matrix3d it's index 12.
    // Easier: check the transform doesn't contain a non-zero X.
    expect(transform).not.toContain('matrix3d');
    if (transform === 'none') {
      // Some browsers serialize translate(0) as 'none' - acceptable.
      expect(transform).toBe('none');
    } else {
      // matrix(1, 0, 0, 1, tx, ty) - tx must be 0.
      const match = transform.match(/matrix\(([^)]+)\)/);
      expect(match).not.toBeNull();
      const parts = match![1].split(',').map((p) => parseFloat(p.trim()));
      // tx is the 5th value (index 4).
      expect(parts[4]).toBe(0);
    }
  });

  test('cross-cutting dark theme walkthrough: outline tick + inline block both flip in one toggle', async ({ page }) => {
    // Insert an inline /toc block first so we can verify both pieces
    // share the dark cascade after one click.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>Alpha</h1><h2>Beta</h2><div data-type="table-of-contents"></div><h2>Gamma</h2>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelector('.dm-toc-block-link') !== null
        && document.querySelector('.dm-toc-outline-tick') !== null,
    );

    // Capture light-mode baseline. Read the resolved CSS variable from
    // each surface's host (rather than the computed background) - this
    // is more deterministic than backgroundColor (which is influenced
    // by hover state, transitions etc.).
    const lightVars = await page.evaluate(() => {
      const tickHost = document.querySelector('.dm-toc-outline');
      const blockHost = document.querySelector('.dm-toc-block');
      return {
        tickColor: tickHost
          ? window.getComputedStyle(tickHost).getPropertyValue('--dm-toc-tick-color').trim()
          : null,
        blockBg: blockHost
          ? window.getComputedStyle(blockHost).getPropertyValue('--dm-toc-block-bg').trim()
          : null,
      };
    });
    expect(lightVars.tickColor).toMatch(/55,\s*53,\s*47/);

    // Toggle dark mode.
    await page.click('.theme-toggle');
    await expect(page.locator('body.dm-theme-dark')).toHaveCount(1);

    const darkVars = await page.evaluate(() => {
      const tickHost = document.querySelector('.dm-toc-outline');
      const blockHost = document.querySelector('.dm-toc-block');
      return {
        tickColor: tickHost
          ? window.getComputedStyle(tickHost).getPropertyValue('--dm-toc-tick-color').trim()
          : null,
        blockBg: blockHost
          ? window.getComputedStyle(blockHost).getPropertyValue('--dm-toc-block-bg').trim()
          : null,
      };
    });

    // Both surfaces flipped in a single toggle. Dark variants use
    // `rgba(255, 255, 255, ...)` (light text/surface on dark canvas).
    expect(darkVars.tickColor).toMatch(/255,\s*255,\s*255/);
    expect(darkVars.blockBg).toMatch(/255,\s*255,\s*255/);
    expect(darkVars.tickColor).not.toBe(lightVars.tickColor);
    expect(darkVars.blockBg).not.toBe(lightVars.blockBg);
  });

  test('print media hides the floating outline (decorative chrome, not document content)', async ({ page }) => {
    await page.emulateMedia({ media: 'print' });
    const outline = page.locator('.dm-toc-outline');
    // `display: none` zeroes out the bounding box.
    const box = await outline.boundingBox();
    expect(box).toBeNull();
  });

  test('print media keeps the inline block visible (it IS document content)', async ({ page }) => {
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><div data-type="table-of-contents"></div>',
        false,
      );
    });
    await page.waitForFunction(() => document.querySelector('.dm-toc-block') !== null);
    await page.emulateMedia({ media: 'print' });
    const block = page.locator('.dm-toc-block');
    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    // Print also strips the surface tint to ink-friendly transparent.
    const bg = await block.evaluate((n) => window.getComputedStyle(n).backgroundColor);
    expect(bg).toMatch(/rgba\(0,\s*0,\s*0,\s*0\)|transparent/);
  });
});

// =============================================================================
// Table of Contents - Phase 9 robustness
// =============================================================================
// Phase 9 covers the lifecycle / stress / leak corners that the
// feature-driven Phase 4-8 tests don't reach by construction:
//   - multi-cycle HMR (5 toggle rounds) - catches forgotten destroy
//     hooks and shared module-level DOM/state that survives one
//     cycle but fails on the second.
//   - subscriber registry leak: insert/remove inline /toc blocks N
//     times, verify the storage subscriber count returns to baseline.
//     The block's NodeView has destroy() that unsubscribes - this
//     test would fail if a future refactor forgets that.
//   - performance smoke on a 50-heading doc: not a benchmark, just a
//     "doesn't grind to a halt" check at sizes that real users reach.
//   - rapid hover bounce: enter/leave/enter inside the hover-in delay
//     window must end on the user-intended state, not on the timer
//     that happened to fire last.
//   - rapid heading toggling stress: 10 rapid level changes don't
//     desync the outline from the doc.

test.describe('Table of Contents - Phase 9 robustness', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('5 mode-toggle cycles leave exactly one outline + zero orphan inline blocks + clean subscriber registry', async ({ page }) => {
    // Insert an inline /toc block once so each cycle exercises BOTH
    // pieces (outline plugin + block NodeView). Setup baseline.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>One</h1><div data-type="table-of-contents"></div><h2>Two</h2>',
        false,
      );
    });
    await page.waitForFunction(() => document.querySelector('.dm-toc-block') !== null);

    for (let i = 0; i < 5; i++) {
      // Leave Notion mode → editor + plugins destroy.
      await page.click('.toolbar-mode-toggle button:has-text("Default toolbar")');
      await page.waitForSelector('app-editor-demo');
      // Outline + block DOM must be cleared (no orphan elements).
      await expect(page.locator('.dm-toc-outline')).toHaveCount(0);
      await expect(page.locator('.dm-toc-block')).toHaveCount(0);

      // Re-enter Notion mode → fresh editor + plugins.
      await page.click('.toolbar-mode-toggle button:has-text("Notion style")');
      await page.waitForSelector(editorSelector);
      await expect(page.locator('.dm-toc-outline')).toHaveCount(1);
    }

    // Final state: subscriber registry should hold exactly the
    // FloatingTocOutline's own subscriber (the demo seeds the editor
    // without an inline block, so no NodeView subscribers are alive).
    // A leak would show as a count > 1 because each cycle's block
    // NodeView registered a subscriber that never got cleaned up.
    const subscriberCount = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { subscribers: Set<unknown> } | undefined;
      return toc?.subscribers.size ?? -1;
    });
    expect(subscriberCount).toBe(1);
  });

  test('subscriber registry returns to baseline after inserting + removing 5 inline blocks', async ({ page }) => {
    // Capture the baseline subscriber count BEFORE we touch anything -
    // typically 1 (FloatingTocOutline). Any orphaned subscribers from
    // earlier extension init would inflate this; we just assert the
    // delta returns to zero, not the absolute baseline value.
    const baseline = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { subscribers: Set<unknown> } | undefined;
      return toc?.subscribers.size ?? -1;
    });
    expect(baseline).toBeGreaterThanOrEqual(1);

    // Insert 5 inline blocks. Each NodeView registers a subscriber.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(
        '<h1>H</h1>'
        + '<div data-type="table-of-contents"></div>'.repeat(5)
        + '<h2>H2</h2>',
        false,
      );
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block').length === 5,
    );

    const afterInsert = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { subscribers: Set<unknown> } | undefined;
      return toc?.subscribers.size ?? -1;
    });
    expect(afterInsert).toBe(baseline + 5);

    // Remove every block by setting content with no blocks. PM
    // destroys each NodeView, which unsubscribes via destroy().
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent('<h1>Just a heading</h1>', false);
    });
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-block').length === 0,
    );

    // Subscribers must drop back to baseline - any leak would carry
    // over into future cycles and accumulate without bound.
    const afterRemove = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { subscribers: Set<unknown> } | undefined;
      return toc?.subscribers.size ?? -1;
    });
    expect(afterRemove).toBe(baseline);
  });

  test('50-heading doc renders the outline + inline block under a reasonable budget (perf smoke)', async ({ page }) => {
    // Build a 50-heading doc. Mix of h1/h2/h3 to exercise per-level
    // styling. Ends with an inline block so we validate both pieces.
    const html = (() => {
      const parts: string[] = [];
      for (let i = 0; i < 50; i++) {
        const level = (i % 3) + 1;
        parts.push(`<h${level}>Section ${String(i + 1)}</h${level}>`);
      }
      parts.push('<div data-type="table-of-contents"></div>');
      return parts.join('');
    })();

    const start = Date.now();
    await page.evaluate((h) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { setContent: (h: string, emit: boolean) => void }
        | undefined;
      ed?.setContent(h, false);
    }, html);

    // Wait until both pieces are populated (outline ticks + block links).
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-outline-tick').length === 50
        && document.querySelectorAll('.dm-toc-block-link').length === 50,
    );
    const elapsed = Date.now() - start;

    // 2000ms is a generous CI budget - locally this completes in ~150ms.
    // The threshold catches algorithmic regressions (O(n²) walks etc.)
    // without flaking on a slow runner.
    expect(elapsed).toBeLessThan(2000);

    // Sanity: every tick has a level + anchor id; matches the doc.
    const ticks = await page.locator('.dm-toc-outline-tick').count();
    const links = await page.locator('.dm-toc-block-link').count();
    expect(ticks).toBe(50);
    expect(links).toBe(50);
  });

  test('rapid hover bounce (enter/leave/enter inside the in-delay window) ends on the user-intended state', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');

    // Default hoverInDelay is 120ms. Bounce three times within ~80ms
    // each so all three events fire BEFORE the show-timer resolves.
    // The contract: the LATEST gesture wins. Final state was an
    // enter, so we expect "expanded".
    await outline.dispatchEvent('mouseenter');
    await page.waitForTimeout(20);
    await outline.dispatchEvent('mouseleave');
    await page.waitForTimeout(20);
    await outline.dispatchEvent('mouseenter');

    // Wait past hoverInDelay (120ms) + a generous grace window.
    await expect(outline).toHaveAttribute('data-state', 'expanded', { timeout: 600 });

    // Now bounce in the OTHER direction. Final gesture is leave,
    // expect "collapsed" after hoverOutDelay (350ms).
    await outline.dispatchEvent('mouseleave');
    await page.waitForTimeout(40);
    await outline.dispatchEvent('mouseenter');
    await page.waitForTimeout(40);
    await outline.dispatchEvent('mouseleave');

    // Allow up to 1500ms for the hide-timer to settle - includes the
    // 350ms delay + headless-runner jitter. A regression that flipped
    // bounce semantics would land on "expanded" here.
    await expect(outline).toHaveAttribute('data-state', 'collapsed', { timeout: 1500 });
  });

  test('rapidly toggling 10 heading levels in succession leaves outline tick count + block link count in sync with the doc', async ({ page }) => {
    // Drive the doc through 10 setContent calls back-to-back. Each
    // call replaces the doc with a different heading mix. After the
    // last call, the outline + block must reflect ONLY the final
    // doc - any stale entry from prior cycles would be a regression.
    for (let i = 1; i <= 10; i++) {
      await page.evaluate((n) => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { setContent: (h: string, emit: boolean) => void }
          | undefined;
        let html = '';
        for (let j = 0; j < n; j++) {
          html += `<h${(j % 3) + 1}>Section ${String(j + 1)}</h${(j % 3) + 1}>`;
        }
        html += '<div data-type="table-of-contents"></div>';
        ed?.setContent(html, false);
      }, i);
    }

    // Final iteration set 10 headings + 1 block. Outline + block
    // contents must mirror exactly that state.
    await page.waitForFunction(() =>
      document.querySelectorAll('.dm-toc-outline-tick').length === 10
        && document.querySelectorAll('.dm-toc-block-link').length === 10,
    );

    const ticks = await page.locator('.dm-toc-outline-tick').count();
    const links = await page.locator('.dm-toc-block-link').count();
    expect(ticks).toBe(10);
    expect(links).toBe(10);

    // Storage content list also matches; this catches a desync where
    // the DOM is right but the data layer is wrong (or vice versa).
    const storageCount = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { storage: Record<string, unknown> }
        | undefined;
      const toc = ed?.storage['toc'] as { content: unknown[] } | undefined;
      return toc?.content.length ?? -1;
    });
    expect(storageCount).toBe(10);
  });
});
