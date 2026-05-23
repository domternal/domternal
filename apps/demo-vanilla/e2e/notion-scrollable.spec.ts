/**
 * E2E for "Notion scrollable" mode: editor inside a fixed-height
 * `.notion-page--scrollable` wrapper. Plugin runs `data-scroll-mode='container'`
 * (skips 50vh sticky + bottom-visible IO + middle/center/frozen modes).
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleScrollable = '.toolbar-mode-toggle button:has-text("Notion scrollable")';
const containerSelector = '.notion-page--scrollable';

async function goScrollable(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleScrollable);
  await page.click(modeToggleScrollable);
  await page.waitForSelector(editorSelector);
  // Outline mounts as soon as TableOfContents storage has >= minHeadings.
  await page.waitForSelector('.dm-toc-outline');
  // Wait for the plugin's first `recomputeContainerCenter()` to set an
  // inline top - otherwise the initial boundingBox() may snapshot the
  // pre-positioned state.
  await page.waitForFunction(() => {
    const o = document.querySelector('.dm-toc-outline') as HTMLElement | null;
    return o !== null && o.style.top !== '';
  });
}

test.describe('Notion scrollable - container layout', () => {
  test.beforeEach(async ({ page }) => { await goScrollable(page); });

  test('page wrapper has max-height + overflow-y: auto', async ({ page }) => {
    const styles = await page.locator(containerSelector).evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
    });
    expect(styles.maxHeight).toBe('700px');
    expect(styles.overflowY).toBe('auto');
  });

  test('outline carries data-scroll-mode="container"', async ({ page }) => {
    const outline = page.locator('.dm-toc-outline');
    await expect(outline).toHaveAttribute('data-scroll-mode', 'container');
    const shell = page.locator('.dm-toc-outline-shell');
    await expect(shell).toHaveAttribute('data-scroll-mode', 'container');
  });

  test('mounting the outline does not introduce a horizontal scrollbar', async ({ page }) => {
    // Regression: absolute nav without `right` pokes past the host's right
    // edge and triggers the host's overflow-x scrollbar.
    const dims = await page.locator(containerSelector).evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(dims.scrollWidth).toBeLessThanOrEqual(dims.clientWidth + 1);
  });

  test('outline uses absolute positioning (no sticky 50vh)', async ({ page }) => {
    const data = await page.locator('.dm-toc-outline').evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        position: cs.position,
        midTopVar: (el as HTMLElement).style.getPropertyValue('--dm-toc-mid-top'),
        bottomVisible: (el as HTMLElement).dataset['bottomVisible'] ?? null,
        mode: (el as HTMLElement).dataset['mode'] ?? null,
      };
    });
    expect(data.position).toBe('absolute');
    // Page-scroll model is fully skipped in container mode.
    expect(data.midTopVar).toBe('');
    expect(data.bottomVisible).toBeNull();
    expect(data.mode).toBeNull();
  });
});

test.describe('Notion scrollable - outline stays centered on container scroll', () => {
  test.beforeEach(async ({ page }) => { await goScrollable(page); });

  test('outline.y stays the same regardless of host scrollTop', async ({ page }) => {
    const initial = await page.locator('.dm-toc-outline').boundingBox();
    expect(initial).not.toBeNull();

    // Drive host scroll directly; the outline must not move with content.
    for (const scrollTop of [50, 200, 500, 800]) {
      await page.evaluate(({ sel, y }) => {
        const host = document.querySelector(sel) as HTMLElement | null;
        if (host) host.scrollTop = y;
      }, { sel: containerSelector, y: scrollTop });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      const after = await page.locator('.dm-toc-outline').boundingBox();
      expect(after).not.toBeNull();
      expect(Math.abs(after!.y - initial!.y)).toBeLessThanOrEqual(2);
    }
  });

  test('outline sits at the vertical middle of the visible container viewport', async ({ page }) => {
    const outlineBox = await page.locator('.dm-toc-outline').boundingBox();
    const hostBox = await page.locator(containerSelector).boundingBox();
    if (!outlineBox || !hostBox) throw new Error('missing rect');
    const hostMid = hostBox.y + hostBox.height / 2;
    const outlineMid = outlineBox.y + outlineBox.height / 2;
    expect(Math.abs(outlineMid - hostMid)).toBeLessThanOrEqual(4);
  });

  test('outline never escapes the container bounds at any scroll position', async ({ page }) => {
    for (const scrollTop of [0, 100, 300, 600, 900]) {
      await page.evaluate(({ sel, y }) => {
        const host = document.querySelector(sel) as HTMLElement | null;
        if (host) host.scrollTop = y;
      }, { sel: containerSelector, y: scrollTop });
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
      const outlineBox = await page.locator('.dm-toc-outline').boundingBox();
      const hostBox = await page.locator(containerSelector).boundingBox();
      if (!outlineBox || !hostBox) continue;
      expect(outlineBox.y).toBeGreaterThanOrEqual(hostBox.y - 2);
      expect(outlineBox.y + outlineBox.height)
        .toBeLessThanOrEqual(hostBox.y + hostBox.height + 2);
    }
  });
});

test.describe('Notion scrollable - scroll-spy follows host scroll', () => {
  test.beforeEach(async ({ page }) => { await goScrollable(page); });

  test('scrolling host past first H2 makes that H2 the active tick', async ({ page }) => {
    const ticks = page.locator('.dm-toc-outline-tick');
    expect(await ticks.count()).toBeGreaterThanOrEqual(2);

    // scrollIntoView scrolls the nearest overflow:auto ancestor (= host).
    await page.evaluate(() => {
      const h2 = document.querySelector('.app-notion-demo .ProseMirror h2');
      if (h2) h2.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    await page.waitForTimeout(300);

    const data = await page.evaluate(() => {
      const active = document.querySelector('.dm-toc-outline-tick.dm-toc--active') as HTMLElement | null;
      const h2 = document.querySelector('.app-notion-demo .ProseMirror h2') as HTMLElement | null;
      return { activeAnchor: active?.dataset['tocAnchor'] ?? null, firstH2Id: h2?.id ?? null };
    });
    expect(data.firstH2Id).toBeTruthy();
    expect(data.activeAnchor).toBe(data.firstH2Id);
  });
});
