/**
 * Notion block-handle cluster layout, across all four demos (commit 3de4afd).
 *
 * The handle root `.dm-block-handle` is built once and holds two buttons in
 * Notion order: `.dm-block-handle-plus` is appended FIRST, then
 * `.dm-block-handle-drag`, so the grip renders adjacent to the block it moves
 * and the plus is the outer, peripheral action (see BlockHandle.ts buildHandle,
 * ~L863-879). Both are `.dm-block-handle-btn`.
 *
 * Geometry contract (theme/_block-handle.scss + _notion-mode.scss): each button
 * is `1.25rem` (20px) wide and the two sit flush (no `gap`), so the cluster is
 * ~40px. In Notion mode `--dm-block-handle-left` is a calc derived from
 * `--dm-notion-column-width`, so the cluster ends 4px before the text at any
 * frame width (pinned by `notion-column-token.spec.ts`). These tests pin the
 * ORDER and the flush ADJACENCY so a refactor that swaps the buttons or
 * strands the grip out in the margin is caught as a regression.
 */
import { test } from './fixtures.js';
import { expect, type Locator, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const handleSelector = '.dm-block-handle';

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

/** Hover a top-level paragraph and wait for the handle to appear on its row. */
async function showHandleOn(page: Page, target: DemoTarget, text: string): Promise<void> {
  await page.locator(`${target.editorSelector} > p`, { hasText: text }).hover();
  await expect(page.locator(handleSelector)).toHaveAttribute('data-show', '');
  // `top`/`left` are written in the same show() call that sets `data-show`; a
  // short settle lets the rAF-coalesced hover tick land before we read rects.
  await page.waitForTimeout(20);
}

interface Rect {
  left: number;
  right: number;
  width: number;
}

interface HandleLayout {
  handle: Rect;
  plus: Rect;
  drag: Rect;
  block: Rect;
}

/** Client rects of the handle root, its two buttons, and the hovered block. */
async function readLayout(page: Page, target: DemoTarget, text: string): Promise<HandleLayout> {
  return page.evaluate(
    ({ sel, blockText }) => {
      const rect = (el: Element): { left: number; right: number; width: number } => {
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, width: b.width };
      };
      const pm = document.querySelector(sel);
      if (!pm) throw new Error('notion editor not found');
      const handle = document.querySelector('.dm-block-handle');
      if (!handle) throw new Error('block handle not rendered');
      const plus = handle.querySelector('.dm-block-handle-plus');
      const drag = handle.querySelector('.dm-block-handle-drag');
      if (!plus || !drag) throw new Error('handle buttons not found');
      const block = Array.from(pm.querySelectorAll(':scope > p')).find(
        (p) => p.textContent === blockText,
      );
      if (!block) throw new Error(`paragraph "${blockText}" not found`);
      return { handle: rect(handle), plus: rect(plus), drag: rect(drag), block: rect(block) };
    },
    { sel: target.editorSelector, blockText: text },
  );
}

/** Class names of the handle root's direct children, in DOM order. */
async function readChildOrder(page: Page): Promise<{ count: number; classes: string[] }> {
  return page.evaluate(() => {
    const handle = document.querySelector('.dm-block-handle');
    if (!handle) throw new Error('block handle not rendered');
    const kids = Array.from(handle.children);
    return { count: kids.length, classes: kids.map((k) => k.className) };
  });
}

for (const target of demoTargets) {
  test.describe(`${target.name} - notion block-handle layout`, () => {
    const paragraphs = (page: Page): Locator => page.locator(`${target.editorSelector} > p`);

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Alpha</p><p>Beta</p><p>Gamma</p>');
      await expect(paragraphs(page)).toHaveText(['Alpha', 'Beta', 'Gamma']);
    });

    test('handle shows in Notion order with both buttons left of the block text', async ({ page }) => {
      await showHandleOn(page, target, 'Beta');
      const { plus, drag, block } = await readLayout(page, target, 'Beta');

      // Notion order: the plus is the OUTER (left) action, the grip is inner.
      expect(plus.left).toBeLessThan(drag.left);
      // The grip is the rightmost button; the whole cluster sits in the gutter
      // to the LEFT of the block's content column (~4px before it).
      expect(drag.right).toBeLessThanOrEqual(block.left + 3);
    });

    test('the button cluster is compact and the grip is flush against the text column', async ({ page }) => {
      await showHandleOn(page, target, 'Beta');
      const { handle, drag, block } = await readLayout(page, target, 'Beta');

      // Two flush 1.25rem (20px) buttons -> ~40px cluster.
      expect(handle.width).toBeGreaterThanOrEqual(30);
      expect(handle.width).toBeLessThanOrEqual(56);

      // Grip right edge ends ~4px before the content column (-44px token + 40px
      // cluster = -4px). Loose bounds catch a stranded grip (order flip pushes
      // it ~24px out) or one overlapping into the text, while tolerating
      // subpixel rendering differences across frameworks.
      const gapToText = block.left - drag.right;
      expect(gapToText).toBeGreaterThanOrEqual(-4);
      expect(gapToText).toBeLessThanOrEqual(16);
    });

    test('the handle root holds exactly [plus][drag] in that DOM order', async ({ page }) => {
      await showHandleOn(page, target, 'Beta');
      const { count, classes } = await readChildOrder(page);

      // Notion append order in buildHandle: plusBtn first, then dragBtn.
      expect(count).toBe(2);
      expect(classes[0]).toContain('dm-block-handle-plus');
      expect(classes[1]).toContain('dm-block-handle-drag');
      // Both are shared handle buttons.
      expect(classes[0]).toContain('dm-block-handle-btn');
      expect(classes[1]).toContain('dm-block-handle-btn');
    });
  });
}
