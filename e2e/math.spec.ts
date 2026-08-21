/**
 * Long / oversized equations across all four demos. KaTeX never line-breaks
 * display math and only soft-wraps breakable inline math, so the theme must
 * scroll or bound the rest instead of clipping the formula or letting the edit
 * popover stretch off-screen. These cover every layout edge: block scroll,
 * centering, vertical fit, the edit popover, and inline wrap vs overflow. The
 * behavior is shared theme CSS, verified once per framework.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

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

function insertBlock(page: Page, latex: string): Promise<void> {
  return page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathBlock: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathBlock(l);
  }, latex);
}

function insertInline(page: Page, latex: string): Promise<void> {
  return page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathInline: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathInline(l);
  }, latex);
}

const longBlock = Array.from({ length: 60 }, (_, i) => `x_{${String(i + 1)}}`).join(' + ') + ' = 0';
const shortBlock = 'E = mc^2';
const tallMatrix = '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}';
const wideWithDescenders = Array.from({ length: 30 }, (_, i) => `\\sum_{k=1}^{${String(i + 1)}} a_k`).join(
  ' + ',
);
const longInlineBreakable = Array.from({ length: 60 }, (_, i) => `\\alpha_{${String(i + 1)}}`).join(' + ');

/** Layout metrics read off a single `.dm-math-block` and its editor clip box. */
interface BlockLayout {
  overflowX: string;
  scrollableX: boolean;
  maxScrollLeft: number;
  withinEditor: boolean;
  fitsHeight: boolean;
}

for (const target of demoTargets) {
  test.describe(`${target.name} - long and oversized equations`, () => {
    const blockSelector = `${target.editorSelector} .dm-math-block`;
    const inlineSelector = `${target.editorSelector} .dm-math-inline`;

    const blockLayout = (page: Page): Promise<BlockLayout> =>
      page.locator(blockSelector).evaluate((el) => {
        const editor = el.closest('.dm-editor')!;
        const er = editor.getBoundingClientRect();
        const br = el.getBoundingClientRect();
        const k = (el.querySelector('.katex-display') ?? el.querySelector('.katex'))!;
        const katexHeight = Math.round(k.getBoundingClientRect().height);
        el.scrollLeft = 1_000_000;
        const maxScrollLeft = el.scrollLeft; // >0 means the far end is reachable
        el.scrollLeft = 0;
        return {
          overflowX: getComputedStyle(el).overflowX,
          // A real overflow is hundreds of px; the >8 floor ignores KaTeX's few-px
          // strut spill so a formula that fits is not counted as scrollable.
          scrollableX: el.scrollWidth - el.clientWidth > 8,
          maxScrollLeft,
          withinEditor: br.right <= er.right + 1 && br.left >= er.left - 1,
          // The block grows to fit the formula's height, so overflow-y:hidden
          // never clips tall display math (matrices, big operators).
          fitsHeight: el.clientHeight >= katexHeight - 2,
        };
      });

    const openPopoverOnBlock = async (page: Page): Promise<void> => {
      await page.locator(blockSelector).click();
      await expect(page.locator('.dm-math-popover')).toBeVisible();
    };

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p></p>');
    });

    test('long block: establishes its own horizontal scroll (overflow-x: auto)', async ({ page }) => {
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.overflowX).toBe('auto');
      expect(m.scrollableX).toBe(true);
    });

    test('long block: stays inside the editor content box (no spill past the edge)', async ({
      page,
    }) => {
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      expect((await blockLayout(page)).withinEditor).toBe(true);
    });

    test('long block: both ends of the formula are reachable by scrolling', async ({ page }) => {
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      // Start is at scrollLeft 0; a positive scroll range means the end is
      // reachable too (safe center pins the start rather than hiding it).
      expect((await blockLayout(page)).maxScrollLeft).toBeGreaterThan(0);
    });

    test('short block: stays centered with no scrollbar', async ({ page }) => {
      await insertBlock(page, shortBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const c = await page.locator(blockSelector).evaluate((el) => {
        const k = (el.querySelector('.katex-display') ?? el.querySelector('.katex'))!;
        const eb = el.getBoundingClientRect();
        const kb = k.getBoundingClientRect();
        return {
          leftGap: Math.round(kb.left - eb.left),
          rightGap: Math.round(eb.right - kb.right),
        };
      });
      expect(Math.abs(c.leftGap - c.rightGap)).toBeLessThanOrEqual(2);
      expect((await blockLayout(page)).scrollableX).toBe(false);
    });

    test('tall block (3x3 matrix): renders full height, not vertically clipped', async ({ page }) => {
      await insertBlock(page, tallMatrix);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.fitsHeight).toBe(true);
      expect(m.scrollableX).toBe(false); // a matrix fits horizontally
    });

    test('wide block with descenders: scrolls horizontally without clipping the bottom', async ({
      page,
    }) => {
      await insertBlock(page, wideWithDescenders);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.scrollableX).toBe(true);
      expect(m.fitsHeight).toBe(true);
    });

    test('editing a long block: the popover stays within the viewport', async ({ page }) => {
      await insertBlock(page, longBlock);
      await openPopoverOnBlock(page);

      const pb = await page.locator('.dm-math-popover').boundingBox();
      const vp = page.viewportSize();
      expect(pb).not.toBeNull();
      expect(vp).not.toBeNull();
      expect(pb!.x).toBeGreaterThanOrEqual(0);
      expect(pb!.x + pb!.width).toBeLessThanOrEqual(vp!.width + 1);
    });

    test('editing a long block: the preview scrolls the wide render (both ends reachable)', async ({
      page,
    }) => {
      await insertBlock(page, longBlock);
      await openPopoverOnBlock(page);

      const p = await page.locator('.dm-math-popover-preview').evaluate((el) => {
        el.scrollLeft = 1_000_000;
        const maxScrollLeft = el.scrollLeft;
        el.scrollLeft = 0;
        return { scrolls: el.scrollWidth - el.clientWidth > 8, maxScrollLeft };
      });
      expect(p.scrolls).toBe(true);
      expect(p.maxScrollLeft).toBeGreaterThan(0);
    });

    test('editing a long block: the textarea is not stretched to the formula width', async ({
      page,
    }) => {
      await insertBlock(page, longBlock);
      await openPopoverOnBlock(page);

      const taWidth = await page
        .locator('.dm-math-popover textarea')
        .evaluate((el) => el.getBoundingClientRect().width);
      // Bounded by the 32rem popover cap, nowhere near the formula's intrinsic width.
      expect(taWidth).toBeLessThan(560);
    });

    test('narrow viewport: the popover still fits (respects 90vw)', async ({ page }) => {
      await page.setViewportSize({ width: 380, height: 720 });
      await insertBlock(page, longBlock);
      await openPopoverOnBlock(page);

      const pb = await page.locator('.dm-math-popover').boundingBox();
      expect(pb).not.toBeNull();
      expect(pb!.x).toBeGreaterThanOrEqual(0);
      expect(pb!.x + pb!.width).toBeLessThanOrEqual(381);
      expect(pb!.width).toBeLessThanOrEqual(380 * 0.9 + 1);
    });

    test('long breakable inline: wraps across lines and stays within the editor', async ({ page }) => {
      await setContent(page, '<p>Start </p>');
      await insertInline(page, longInlineBreakable);
      await expect(page.locator(`${inlineSelector} .katex`)).toBeVisible();

      const m = await page.locator(inlineSelector).evaluate((el) => {
        const editor = el.closest('.dm-editor')!;
        const er = editor.getBoundingClientRect();
        const br = el.getBoundingClientRect();
        return { height: Math.round(br.height), withinEditor: br.right <= er.right + 1 };
      });
      expect(m.height).toBeGreaterThan(40); // taller than one line => wrapped
      expect(m.withinEditor).toBe(true);
    });

    test('inline fraction: overflow stays visible so tall glyphs are not clipped', async ({ page }) => {
      await setContent(page, '<p>x </p>');
      await insertInline(page, '\\frac{a}{b}');
      await expect(page.locator(`${inlineSelector} .katex`)).toBeVisible();

      const cs = await page.locator(inlineSelector).evaluate((el) => {
        const s = getComputedStyle(el);
        return { overflowX: s.overflowX, overflowY: s.overflowY };
      });
      // Inline math must not clip either axis, or fractions/integrals lose their
      // ascenders/descenders. This guards the deliberate no-overflow choice.
      expect(cs.overflowX).toBe('visible');
      expect(cs.overflowY).toBe('visible');
    });
  });
}
