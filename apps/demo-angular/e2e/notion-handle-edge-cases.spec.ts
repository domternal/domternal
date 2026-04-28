/**
 * Edge-case e2e coverage for the BlockHandle that's NOT already covered
 * by `notion-demo.spec.ts` / `notion-block-resolution.spec.ts`.
 *
 * Specifically targets behaviour added by these recent commits:
 *
 *   2e96a4e  feat(demo-angular): match content width to default toolbar (38rem)
 *   c68ade4  feat: scoring infra (BASE_SCORE + edge detection)
 *   e2a073c  feat: default scoring rules (table / inline exclusions)
 *   e3ee853  feat: clampCoords (above/below + side gutter)
 *   d15b700  feat: findBestDragTarget + 3-mode dispatch + vertical first-line centering
 *
 * Categories covered here:
 *   1. First-line vertical centering of the handle for tall blocks (h1-h3,
 *      multi-line paragraphs, empty paragraphs).
 *   2. Atom blocks — horizontal rule surfaces a handle of its own.
 *   3. Default-rule exclusions — table internals don't surface a handle on
 *      their cells/rows; the table itself is the drag target.
 *   4. Layout assertions — `.dm-editor` is centered at ≤38rem inside the
 *      Notion page, leaving symmetric side gutters where the handle lives.
 *   5. Hover hide-delay (200ms) — quick re-entries don't drop the handle.
 *   6. Doc-mutation invariants — typing, undo/redo, color-toggle keep the
 *      hover target stable.
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
  // Only block on top-level node types that UniqueID actually stamps.
  // Tables, details, and other structural wrappers are intentionally
  // skipped by the extension's default `types` list — waiting for them
  // would deadlock the spec.
  const STAMPED_TYPES = [
    'paragraph', 'heading', 'blockquote', 'codeBlock',
    'bulletList', 'orderedList', 'taskList', 'listItem',
    'taskItem', 'image', 'horizontalRule',
  ];
  await page.waitForFunction((stamped: string[]) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => {
      if (stamped.includes(n.type.name) && !n.attrs['id']) ok = false;
    });
    return ok;
  }, STAMPED_TYPES, { timeout: 3000 });
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

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a bounding box').not.toBeNull();
  if (!box) throw new Error('unreachable');
  return box;
}

async function hoverAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(40);
}

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
// 1. First-line vertical centering — handle aligns to the first line of a
//    block, not its top edge or visual center
// ────────────────────────────────────────────────────────────────────────

test.describe('Vertical alignment on the first line of a block', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('handle Y is roughly the center of the first line of a single-line paragraph', async ({ page }) => {
    await setContent(page, '<p>Short paragraph</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = await boxOf(page.locator(blockHandleSelector));
    // Handle's vertical center should sit within +/-20% of the block's
    // own vertical center for a single-line block.
    const handleCenter = handle.y + handle.height / 2;
    const blockCenter = pBox.y + pBox.height / 2;
    expect(Math.abs(handleCenter - blockCenter)).toBeLessThan(pBox.height * 0.4);
  });

  test('handle Y on a tall H1 anchors to the FIRST LINE, not block center', async ({ page }) => {
    await setContent(page, '<h1>Untitled</h1>');
    const h = page.locator(`${editorSelector} h1`);
    const hBox = await boxOf(h);
    await h.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = await boxOf(page.locator(blockHandleSelector));
    const handleCenter = handle.y + handle.height / 2;
    // First line of an H1 (font-size ~2.25rem * line-height 1.25 ≈ 45px)
    // is in the upper portion of the block; handle should be in the
    // top half, not the center of the (potentially tall) block box.
    expect(handleCenter).toBeLessThan(hBox.y + hBox.height * 0.65);
    // And not above the block.
    expect(handleCenter).toBeGreaterThan(hBox.y);
  });

  test('multi-line paragraph: handle anchors to FIRST line, not the visual center', async ({ page }) => {
    await setContent(
      page,
      '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod '
      + 'tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, '
      + 'quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo '
      + 'consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse '
      + 'cillum dolore eu fugiat nulla pariatur.</p>',
    );
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = await boxOf(page.locator(blockHandleSelector));
    const handleCenter = handle.y + handle.height / 2;
    // For a paragraph that wraps to several lines, "first line" is in
    // the upper third of the block. Handle must NOT center vertically
    // on the whole multi-line box.
    expect(handleCenter).toBeLessThan(pBox.y + pBox.height * 0.4);
  });

  test('empty paragraph still surfaces a handle within its line height', async ({ page }) => {
    await setContent(page, '<p></p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);
    // Hover slightly inside the empty paragraph's box.
    await hoverAt(page, pBox.x + 5, pBox.y + Math.max(2, pBox.height / 2));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const handle = await boxOf(page.locator(blockHandleSelector));
    // Handle vertical extent should overlap the empty paragraph's row.
    const handleBottom = handle.y + handle.height;
    expect(handleBottom).toBeGreaterThan(pBox.y - 4);
    expect(handle.y).toBeLessThan(pBox.y + pBox.height + 4);
  });

  test('h2 and h3 also align to first line (different font sizes)', async ({ page }) => {
    await setContent(page, '<h2>Section</h2><h3>Subsection</h3>');
    const h2 = page.locator(`${editorSelector} h2`);
    const h3 = page.locator(`${editorSelector} h3`);
    const h2Box = await boxOf(h2);
    const h3Box = await boxOf(h3);

    await h2.hover();
    let handle = await boxOf(page.locator(blockHandleSelector));
    expect(handle.y + handle.height / 2).toBeLessThan(h2Box.y + h2Box.height * 0.7);

    await h3.hover();
    handle = await boxOf(page.locator(blockHandleSelector));
    expect(handle.y + handle.height / 2).toBeLessThan(h3Box.y + h3Box.height * 0.7);
  });

  test('blockquote with two paragraphs: handle on the BLOCKQUOTE first line', async ({ page }) => {
    await setContent(page, '<blockquote><p>First quoted line.</p><p>Second quoted line.</p></blockquote>');
    const bq = page.locator(`${editorSelector} blockquote`);
    const bBox = await boxOf(bq);
    await bq.hover();
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');

    const handle = await boxOf(page.locator(blockHandleSelector));
    // First "line" inside a blockquote is the first paragraph's first line —
    // handle should be in the upper half of the blockquote rect.
    expect(handle.y + handle.height / 2).toBeLessThan(bBox.y + bBox.height * 0.5);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Atom-leaf blocks — handle for image, horizontal rule
// ────────────────────────────────────────────────────────────────────────

test.describe('Atom-leaf block handle', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('horizontal rule (atom, no children) surfaces a handle of its own', async ({ page }) => {
    await setContent(page, '<p>Above</p><hr><p>Below</p>');
    const hr = page.locator(`${editorSelector} hr`);
    const hrBox = await boxOf(hr);
    await hoverAt(page, hrBox.x + hrBox.width / 2, hrBox.y + Math.max(1, hrBox.height / 2));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });

  test('hr is a top-level atom — drag handle resolves to it even when squeezed between paragraphs', async ({ page }) => {
    await setContent(page, '<p>Above</p><hr><p>Below</p>');
    const hr = page.locator(`${editorSelector} hr`);
    const hrBox = await boxOf(hr);
    // Hover slightly above so we don't accidentally aim at the
    // following paragraph's top edge.
    await hoverAt(page, hrBox.x + hrBox.width / 2, hrBox.y + Math.max(1, hrBox.height / 2) - 1);

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Default-rule exclusions — table internals NOT picked
// ────────────────────────────────────────────────────────────────────────

test.describe('Default scoring rules — exclusions', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hovering inside a table cell resolves to the TABLE block, not tableCell/tableRow/tableHeader', async ({ page }) => {
    await setContent(
      page,
      '<table>'
      + '<tr><th>Header</th></tr>'
      + '<tr><td>Body cell</td></tr>'
      + '</table>',
    );
    const cell = page.locator(`${editorSelector} td`).first();
    const cBox = await boxOf(cell);
    await hoverAt(page, cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);

    // Even though `<td>` and `<tr>` are ancestors of the cursor, the
    // `tableStructure` rule excludes them. The handle should resolve to
    // the top-level table block.
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('table');
  });

  test('hovering blockquote → paragraph still resolves to BLOCKQUOTE (paragraph not in allowedNodes for nested mode)', async ({ page }) => {
    await setContent(page, '<blockquote><p>Inner quote</p></blockquote>');
    const bq = page.locator(`${editorSelector} blockquote`);
    const bBox = await boxOf(bq);
    await hoverAt(page, bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });

  test('hovering a code block (pre) resolves to codeBlock at top level (no inner nesting)', async ({ page }) => {
    await setContent(page, '<pre><code>const x = 1;</code></pre>');
    const pre = page.locator(`${editorSelector} pre`);
    const pBox = await boxOf(pre);
    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);

    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Layout — content column is centered with symmetric side gutters
// ────────────────────────────────────────────────────────────────────────

test.describe('Notion demo layout invariants', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('.dm-editor max-width matches the configured 38rem (608px)', async ({ page }) => {
    const editorBox = await boxOf(page.locator('app-notion-demo .dm-editor'));
    // 38rem at default 16px/rem = 608px. Allow a few px of slop for sub-
    // pixel rounding and scroll-bar inclusion in the bbox.
    expect(editorBox.width).toBeLessThanOrEqual(608 + 4);
    expect(editorBox.width).toBeGreaterThanOrEqual(608 - 4);
  });

  test('.dm-editor is horizontally centered inside <app-notion-demo>', async ({ page }) => {
    const host = await boxOf(page.locator('app-notion-demo'));
    const editorBox = await boxOf(page.locator('app-notion-demo .dm-editor'));

    const leftMargin = editorBox.x - host.x;
    const rightMargin = (host.x + host.width) - (editorBox.x + editorBox.width);
    // Margins should be symmetric within a few px (centered).
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(4);
    // And both should be > 0 (actually centered narrower).
    expect(leftMargin).toBeGreaterThan(0);
    expect(rightMargin).toBeGreaterThan(0);
  });

  test('block handle, when shown, sits in the LEFT margin (negative left vs editor)', async ({ page }) => {
    await setContent(page, '<p>Centered</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    const editorBox = await boxOf(page.locator('app-notion-demo .dm-editor'));
    const handle = await boxOf(page.locator(blockHandleSelector));
    // Handle's right edge should be ≤ editor's left edge (handle lives
    // entirely in the left side gutter, not overlapping the content).
    expect(handle.x + handle.width).toBeLessThanOrEqual(editorBox.x + 4);
    // And block content position is unchanged regardless.
    expect(pBox.x).toBeGreaterThanOrEqual(editorBox.x);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Hover hide debounce — quick re-entries don't drop the handle
// ────────────────────────────────────────────────────────────────────────

test.describe('Hover hide-delay (200ms)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('mouse leaving + returning within 200ms keeps handle visible', async ({ page }) => {
    await setContent(page, '<p>Stay visible</p>');
    const para = page.locator(`${editorSelector} p`);
    const pBox = await boxOf(para);

    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    // Move mouse far above (out of editor parent bounds), then return
    // quickly — within the 200ms hide-delay window.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(80);
    await hoverAt(page, pBox.x + pBox.width / 2, pBox.y + pBox.height / 2);

    // Handle should still be visible.
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
  });

  test('mouse leaving for >200ms hides the handle', async ({ page }) => {
    await setContent(page, '<p>Will hide</p>');
    const para = page.locator(`${editorSelector} p`);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    // Move out and wait past the hide delay.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    await expect(page.locator(blockHandleSelector)).not.toHaveAttribute('data-show', '');
  });

  test('hovering directly INTO the handle keeps it shown (no flicker on entry)', async ({ page }) => {
    await setContent(page, '<p>Steady</p>');
    const para = page.locator(`${editorSelector} p`);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

    // Move into the handle itself.
    const handle = page.locator(dragBtnSelector);
    await handle.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Doc-mutation invariants — typing / undo / color-toggle preserve hover
// ────────────────────────────────────────────────────────────────────────

test.describe('Doc-mutation invariants', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('typing characters does not lose the hovered block target', async ({ page }) => {
    await setContent(page, '<p>Type me</p>');
    const para = page.locator(`${editorSelector} p`);
    await para.hover();
    const beforeId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { attrs: Record<string, unknown> } | null } } }
        | undefined;
      return (ed?.state.doc.firstChild?.attrs['id'] as string | undefined) ?? '';
    });

    // Type a few chars at end of the paragraph.
    await page.click(editorSelector);
    await page.keyboard.press('End');
    await page.keyboard.type('!!!');

    // Hover again — handle should still resolve to the same block (id stable).
    await para.hover();
    const afterId = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { attrs: Record<string, unknown> } | null } } }
        | undefined;
      return (ed?.state.doc.firstChild?.attrs['id'] as string | undefined) ?? '';
    });
    expect(afterId).toBe(beforeId);
    expect(afterId).not.toBe('');
  });

  test('undo does not break the hover handle (pos mapping)', async ({ page }) => {
    await setContent(page, '<p>Undoable</p>');
    const para = page.locator(`${editorSelector} p`);
    await page.click(editorSelector);
    await page.keyboard.press('End');
    await page.keyboard.type('xx');
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+z`);

    // Handle still shows on hover after undo.
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('Undoable');
  });

  test('toggling block color via the context menu does not break subsequent hover', async ({ page }) => {
    await setContent(page, '<p>Toggle me</p>');
    const para = page.locator(`${editorSelector} p`);
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    await page.click(dragBtnSelector);
    await expect(page.locator('.dm-block-context-menu')).toHaveAttribute('data-show', '');

    // Pick yellow background.
    await page.click('.dm-block-color-swatch--bg[data-color="yellow"]');
    await expect(page.locator('.dm-block-context-menu')).not.toHaveAttribute('data-show', '');

    // Hover again — handle still works on the color-tinted block.
    await para.hover();
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('Toggle me');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Mixed adjacent block types — independent resolution
// ────────────────────────────────────────────────────────────────────────

test.describe('Mixed adjacent blocks resolve independently', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('paragraph → heading → blockquote → list → code: each surfaces its own handle', async ({ page }) => {
    await setContent(
      page,
      '<p>Para</p>'
      + '<h2>Head</h2>'
      + '<blockquote><p>Quote</p></blockquote>'
      + '<ul><li><p>Item</p></li></ul>'
      + '<pre><code>code</code></pre>',
    );
    const expectations: Array<{ sel: string; type: string }> = [
      { sel: 'p:has-text("Para")', type: 'paragraph' },
      { sel: 'h2', type: 'heading' },
      { sel: 'blockquote', type: 'blockquote' },
      { sel: 'li', type: 'listItem' },
      { sel: 'pre', type: 'codeBlock' },
    ];

    for (const { sel, type } of expectations) {
      const el = page.locator(`${editorSelector} ${sel}`).first();
      const box = await boxOf(el);
      await hoverAt(page, box.x + box.width / 2, box.y + Math.max(8, box.height / 2));
      const pos = await hoveredPos(page);
      const block = pos !== null ? await blockAt(page, pos) : null;
      expect(block?.type, `expected ${type} for selector ${sel}`).toBe(type);
    }
  });
});
