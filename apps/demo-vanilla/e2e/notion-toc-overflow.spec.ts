/**
 * E2E: tick column caps at 50% of the container and clips extras
 * (Notion behavior - no compression, no scroll on the column). The
 * hover card opens at the top and is fully scrollable.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

async function gotoMode(page: Page, label: 'Notion scrollable' | 'Notion style'): Promise<void> {
  await page.goto('/');
  const btn = `.toolbar-mode-toggle button:has-text("${label}")`;
  await page.waitForSelector(btn);
  await page.click(btn);
  await page.waitForSelector('.ProseMirror');
  await page.waitForSelector('.dm-toc-outline-ticks');
  await page.waitForTimeout(200);
}

async function pasteManyH2s(page: Page, count: number): Promise<void> {
  const html = Array.from({ length: count }, (_, i) => `<h2>S${String(i)}</h2>`).join('');
  await page.evaluate((h) => {
    const pm = document.querySelector<HTMLElement>('.ProseMirror');
    if (!pm) return;
    pm.focus();
    const data = new DataTransfer();
    data.setData('text/html', h);
    pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  }, html);
  await page.waitForTimeout(700);
}

for (const mode of ['Notion scrollable', 'Notion style'] as const) {
  test.describe(`${mode} - tick column caps at 50% + card scrolls`, () => {
    test('DOM structure: ticks live in `.dm-toc-outline-ticks`, sibling of `.dm-toc-outline-card`', async ({ page }) => {
      await gotoMode(page, mode);
      const data = await page.evaluate(() => {
        const nav = document.querySelector<HTMLElement>('.dm-toc-outline');
        const wrapper = nav?.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        const card = nav?.querySelector<HTMLElement>('.dm-toc-outline-card');
        return {
          wrapperExists: !!wrapper,
          cardExists: !!card,
          wrapperHasTicks: (wrapper?.querySelectorAll('.dm-toc-outline-tick').length ?? 0) > 0,
          cardIsSiblingOfWrapper: card?.parentElement === nav && wrapper?.parentElement === nav,
        };
      });
      expect(data.wrapperExists).toBe(true);
      expect(data.cardExists).toBe(true);
      expect(data.wrapperHasTicks).toBe(true);
      expect(data.cardIsSiblingOfWrapper).toBe(true);
    });

    test('inter-tick gap stays at the CSS default with many headings (no compression)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      const gap = await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        return w ? parseFloat(getComputedStyle(w).gap) : -1;
      });
      // Default is 10px - must stay constant regardless of heading count.
      expect(gap).toBeCloseTo(10, 0);
    });

    test('ticks wrapper caps at ~50% and clips overflow (hidden, not scroll)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      const data = await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        if (!w) return null;
        const cs = getComputedStyle(w);
        const maxH = parseFloat(cs.maxHeight);
        return {
          overflow: cs.overflow,
          overflowX: cs.overflowX,
          overflowY: cs.overflowY,
          maxHeight: maxH,
          scrollHeight: w.scrollHeight,
          clientHeight: w.clientHeight,
          tickCount: w.querySelectorAll('.dm-toc-outline-tick').length,
        };
      });
      expect(data).not.toBeNull();
      // Overflow MUST be hidden, never auto/scroll - the column doesn't scroll.
      expect(data!.overflowY).not.toBe('auto');
      expect(data!.overflowY).not.toBe('scroll');
      expect(['hidden', 'clip']).toContain(data!.overflowY);
      // Natural content far exceeds the visible wrapper.
      expect(data!.scrollHeight).toBeGreaterThan(data!.clientHeight + 100);
      // ~50% of the container; page-mode 50vh ≈ 360, container ≈ 382.
      expect(data!.maxHeight).toBeGreaterThan(300);
      expect(data!.maxHeight).toBeLessThan(450);
    });

    test('hover opens the card with scrollTop = 0 (starts at the first row)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);

      // Pre-scroll the (collapsed) card so we can prove the reset on open.
      await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        if (card) card.scrollTop = 200;
      });

      // Hover the nav to trigger the in-delay (120ms default) + expand.
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);

      const data = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        if (!card) return null;
        return {
          opacity: parseFloat(getComputedStyle(card).opacity),
          scrollTop: card.scrollTop,
        };
      });
      expect(data).not.toBeNull();
      expect(data!.opacity).toBeGreaterThan(0.5);
      // Plugin reset scrollTop to 0 on the collapsed→expanded transition.
      expect(data!.scrollTop).toBe(0);
    });

    test('card itself is scrollable for long heading lists', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      const data = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        if (!card) return null;
        return {
          overflowY: getComputedStyle(card).overflowY,
          scrollHeight: card.scrollHeight,
          clientHeight: card.clientHeight,
          rowCount: card.querySelectorAll('.dm-toc-outline-row').length,
        };
      });
      expect(data).not.toBeNull();
      expect(data!.overflowY).toBe('auto');
      expect(data!.rowCount).toBeGreaterThan(100);
      expect(data!.scrollHeight).toBeGreaterThan(data!.clientHeight);
    });

    test('card rows keep a uniform height regardless of count (no flex compression)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      const heights = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-outline-row'));
        return rows.slice(0, 20).map((r) => r.getBoundingClientRect().height);
      });
      expect(heights.length).toBeGreaterThanOrEqual(10);
      // All rows match the first - no flex-shrink compression.
      const first = heights[0];
      expect(first).toBeGreaterThan(10);
      for (const h of heights) {
        expect(Math.abs(h - first)).toBeLessThan(0.5);
      }
    });

    test('card max-height matches the ticks wrapper (= 50% of the container)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      const data = await page.evaluate(() => {
        const wrapper = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        if (!wrapper || !card) return null;
        return {
          wrapperMaxH: parseFloat(getComputedStyle(wrapper).maxHeight),
          cardMaxH: parseFloat(getComputedStyle(card).maxHeight),
        };
      });
      expect(data).not.toBeNull();
      // Card uses the same CSS var so the values match exactly.
      expect(data!.cardMaxH).toBeCloseTo(data!.wrapperMaxH, 1);
    });

    test('removing headings shifts the visible window (no orphan ticks)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      const beforeCount = await page.evaluate(
        () => document.querySelectorAll('.dm-toc-outline-tick').length,
      );

      // Clear the doc; the outline should re-render with just the seeded heading(s).
      await page.evaluate(() => {
        const pm = document.querySelector<HTMLElement>('.ProseMirror');
        pm?.focus();
      });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(300);
      await page.keyboard.type('# Only one');
      await page.waitForTimeout(300);

      const after = await page.evaluate(() => ({
        count: document.querySelectorAll('.dm-toc-outline-tick').length,
        wrapperChildrenCount:
          document.querySelector('.dm-toc-outline-ticks')?.children.length ?? 0,
      }));
      expect(beforeCount).toBeGreaterThan(100);
      expect(after.count).toBe(1);
      expect(after.wrapperChildrenCount).toBe(1);
    });

    test('every heading produces a tick in the DOM (clipped, not truncated)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 80);
      const data = await page.evaluate(() => {
        const wrapper = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        const headings = document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
        return {
          tickCount: wrapper?.querySelectorAll('.dm-toc-outline-tick').length ?? 0,
          headingCount: headings.length,
        };
      });
      // Plugin renders ALL; CSS clip hides the ones past the 50% mark.
      expect(data.tickCount).toBe(data.headingCount);
      expect(data.tickCount).toBeGreaterThan(80);
    });

    test('a clipped tick exists in DOM with valid anchor (just not visible)', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 100);
      const data = await page.evaluate(() => {
        const wrapper = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        const ticks = Array.from(wrapper?.querySelectorAll<HTMLElement>('.dm-toc-outline-tick') ?? []);
        const wrapperRect = wrapper?.getBoundingClientRect();
        // Find a tick that sits below the wrapper's visible bottom edge.
        const clipped = ticks.find((t) => {
          const r = t.getBoundingClientRect();
          return wrapperRect && r.top > wrapperRect.bottom;
        });
        return {
          clippedExists: !!clipped,
          clippedAnchor: clipped?.dataset['tocAnchor'] ?? '',
          totalTicks: ticks.length,
        };
      });
      expect(data.totalTicks).toBeGreaterThan(80);
      expect(data.clippedExists).toBe(true);
      // UniqueID stamped it - the anchor is non-empty even for clipped ticks.
      expect(data.clippedAnchor).toBeTruthy();
    });

    test('tick column does not scroll on wheel - scrollTop stays 0', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      // Synthesize a wheel event on the wrapper - overflow:hidden ignores it.
      await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        if (!w) return;
        w.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true }));
      });
      await page.waitForTimeout(100);
      const scrollTop = await page.evaluate(() => {
        const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        return w?.scrollTop ?? -1;
      });
      expect(scrollTop).toBe(0);
    });

    test('clicking a visible tick scrolls the editor to that heading', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 60);
      const before = await page.evaluate(() => ({
        winY: window.scrollY,
        hostTop: (document.querySelector('.notion-page--scrollable') as HTMLElement | null)?.scrollTop ?? 0,
      }));
      // Click a tick deep enough that the scroll has to move appreciably.
      const anchor = await page.evaluate(() => {
        const wrapper = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
        const ticks = wrapper?.querySelectorAll<HTMLElement>('.dm-toc-outline-tick');
        const target = ticks?.[ticks.length - 5];
        target?.click();
        return target?.dataset['tocAnchor'] ?? '';
      });
      expect(anchor).toBeTruthy();
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => ({
        winY: window.scrollY,
        hostTop: (document.querySelector('.notion-page--scrollable') as HTMLElement | null)?.scrollTop ?? 0,
      }));
      // EITHER the window OR the container scrolled - depends on mode.
      const movedWindow = after.winY - before.winY;
      const movedHost = after.hostTop - before.hostTop;
      expect(Math.max(movedWindow, movedHost)).toBeGreaterThan(50);
    });

    test('clicking a row in the expanded card scrolls the editor to that heading', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 80);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      // Click the 5th row deep in the card (likely below the fold for tick column).
      const anchor = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        const rows = card?.querySelectorAll<HTMLElement>('.dm-toc-outline-row');
        const target = rows?.[4];
        target?.click();
        return target?.dataset['tocAnchor'] ?? '';
      });
      expect(anchor).toBeTruthy();
      await page.waitForTimeout(600);
      const found = await page.evaluate((id) => {
        const h = document.querySelector<HTMLElement>(`[id="${id}"]`);
        return !!h;
      }, anchor);
      expect(found).toBe(true);
    });

    test('card stays expanded while the mouse is over the card itself', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 40);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      // Move pointer into the card center; avoids the brief gap-leave
      // that Playwright's `.hover()` can hit between elements.
      const cardBox = await page.locator('.dm-toc-outline-card').boundingBox();
      if (cardBox) {
        await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 8 });
      }
      await page.waitForTimeout(150);
      const state = await page.evaluate(
        () => document.querySelector<HTMLElement>('.dm-toc-outline')?.dataset['state'] ?? '',
      );
      expect(state).toBe('expanded');
    });

    test('card collapses after the hover-out delay when leaving the outline', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 20);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      expect(
        await page.evaluate(
          () => document.querySelector<HTMLElement>('.dm-toc-outline')?.dataset['state'] ?? '',
        ),
      ).toBe('expanded');
      // Move the pointer somewhere harmless.
      await page.mouse.move(10, 10);
      // Default hover-out delay is 350ms; allow a buffer.
      await page.waitForTimeout(500);
      expect(
        await page.evaluate(
          () => document.querySelector<HTMLElement>('.dm-toc-outline')?.dataset['state'] ?? '',
        ),
      ).toBe('collapsed');
    });

    test('reopening the card resets scrollTop to 0 even after the user scrolled it', async ({ page }) => {
      await gotoMode(page, mode);
      await pasteManyH2s(page, 120);
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      // User scrolls the card mid-list.
      await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        if (card) card.scrollTop = 600;
      });
      // Collapse.
      await page.mouse.move(10, 10);
      await page.waitForTimeout(500);
      // Reopen.
      await page.locator('.dm-toc-outline').hover();
      await page.waitForTimeout(300);
      const top = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.dm-toc-outline-card');
        return card?.scrollTop ?? -1;
      });
      expect(top).toBe(0);
    });

    if (mode === 'Notion style') {
      // Page-scroll only: `50vh` tracks viewport. Container mode's host
      // is pinned at `max-height: 700px`, so resize is a no-op there.
      test('viewport resize updates the ticks wrapper max-height (page-scroll)', async ({ page }) => {
        await gotoMode(page, mode);
        await pasteManyH2s(page, 100);
        const before = await page.evaluate(() => {
          const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
          return parseFloat(getComputedStyle(w!).maxHeight);
        });
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.waitForTimeout(200);
        const after = await page.evaluate(() => {
          const w = document.querySelector<HTMLElement>('.dm-toc-outline-ticks');
          return parseFloat(getComputedStyle(w!).maxHeight);
        });
        expect(after).toBeGreaterThan(before + 50);
      });
    }
  });
}
