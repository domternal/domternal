/**
 * E2E: FloatingTocOutline picks up dynamically inserted headings AND the
 * outline becomes visible as soon as the first heading exists.
 *
 * Default `minHeadings: 1` (matches Notion). The "delete-all then add 1
 * H1" regression specifically guards against the prior 2-heading
 * threshold that left the outline `display: none` after typing a single
 * heading into an empty doc.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

async function gotoMode(page: Page, label: 'Notion scrollable' | 'Notion style'): Promise<void> {
  await page.goto('/');
  const btn = `.toolbar-mode-toggle button:has-text("${label}")`;
  await page.waitForSelector(btn);
  await page.click(btn);
  await page.waitForSelector('.ProseMirror');
  await page.waitForSelector('.dm-toc-outline');
  await page.waitForTimeout(200);
}

async function placeCursorAtEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    if (!pm) return;
    pm.focus();
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(pm);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  });
}

async function selectAllAndDelete(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('.ProseMirror')?.focus();
  });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(150);
}

async function readOutlineState(page: Page): Promise<{
  tickCount: number;
  state: string | null;
  display: string | null;
  anchors: string[];
}> {
  return await page.evaluate(() => {
    const outline = document.querySelector<HTMLElement>('.dm-toc-outline');
    const ticks = Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-outline-tick'));
    return {
      tickCount: ticks.length,
      state: outline?.dataset['state'] ?? null,
      display: outline ? getComputedStyle(outline).display : null,
      anchors: ticks.map((t) => t.dataset['tocAnchor'] ?? ''),
    };
  });
}

for (const mode of ['Notion scrollable', 'Notion style'] as const) {
  test.describe(`${mode} - TOC tracks new headings`, () => {
    test('appending H1 via # shortcut adds a tick', async ({ page }) => {
      await gotoMode(page, mode);
      const before = await readOutlineState(page);

      await placeCursorAtEnd(page);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('# Appended H1');
      await page.waitForTimeout(300);

      const after = await readOutlineState(page);
      expect(after.tickCount).toBe(before.tickCount + 1);
      expect(after.anchors[after.anchors.length - 1]).toBeTruthy();
    });

    test('appending H1 via slash command adds a tick', async ({ page }) => {
      await gotoMode(page, mode);
      const before = await readOutlineState(page);

      await placeCursorAtEnd(page);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await page.waitForSelector('.dm-slash-command-menu');
      await page.keyboard.type('Heading 1');
      await page.waitForTimeout(150);
      await page.keyboard.press('Enter');
      await page.keyboard.type('Slash H1');
      await page.waitForTimeout(300);

      expect((await readOutlineState(page)).tickCount).toBe(before.tickCount + 1);
    });

    test('clearing the doc then typing one H1 shows the outline (minHeadings:1)', async ({ page }) => {
      await gotoMode(page, mode);
      await selectAllAndDelete(page);
      await page.keyboard.type('# Lone H1');
      await page.waitForTimeout(400);

      const observed = await readOutlineState(page);
      expect(observed.tickCount).toBe(1);
      expect(observed.state).toBe('collapsed');
      expect(observed.display).not.toBe('none');
    });

    test('empty doc keeps the outline hidden until a heading exists', async ({ page }) => {
      await gotoMode(page, mode);
      await selectAllAndDelete(page);
      await page.waitForTimeout(200);

      const empty = await readOutlineState(page);
      expect(empty.tickCount).toBe(0);
      expect(empty.state).toBe('hidden');
      expect(empty.display).toBe('none');

      await page.keyboard.type('# First');
      await page.waitForTimeout(400);

      const withOne = await readOutlineState(page);
      expect(withOne.tickCount).toBe(1);
      expect(withOne.state).toBe('collapsed');
      expect(withOne.display).not.toBe('none');
    });
  });
}
