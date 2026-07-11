/**
 * E2E for the math extension in the Notion-style demo: inserting block and
 * inline equations via commands renders KaTeX, and clicking a node opens the
 * edit popover (LaTeX source + live preview) which applies on Enter.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
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

async function insertBlock(page: Page, latex: string): Promise<void> {
  await page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathBlock: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathBlock(l);
  }, latex);
}

async function insertInline(page: Page, latex: string): Promise<void> {
  await page.evaluate((l) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { insertMathInline: (latex: string) => void } }
      | undefined;
    ed?.commands.insertMathInline(l);
  }, latex);
}

async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (f: (n: { type: { name: string } }) => void) => void } } }
      | undefined;
    const names: string[] = [];
    ed?.state.doc.forEach((n) => names.push(n.type.name));
    return names;
  });
}

test.describe('Math extension', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
  });

  test('renders a block equation as KaTeX', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, 'x^2 + y^2');
    const block = page.locator('.app-notion-demo .dm-math-block');
    await expect(block).toBeVisible();
    await expect(block.locator('.katex')).toBeVisible();
  });

  test('renders an inline equation and edits it via the popover', async ({ page }) => {
    await setContent(page, '<p>before </p>');
    await insertInline(page, 'a_1');

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    await expect(inline.locator('.katex')).toBeVisible();

    await inline.click();
    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();

    const input = popover.locator('textarea');
    await expect(input).toHaveValue('a_1');
    await input.fill('b_2');
    await input.press('Enter');

    await expect(popover).toBeHidden();
    await expect(inline.locator('.katex')).toContainText('b');
  });

  test('inserting an empty equation focuses the LaTeX field, not the document', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('/inline equation');
    await page.waitForSelector('.dm-slash-command-menu');
    await page.keyboard.press('Enter');

    const input = page.locator('.dm-math-popover textarea');
    await expect(input).toBeFocused();

    await page.keyboard.type('a^2');
    await expect(input).toHaveValue('a^2');
    await expect(page.locator(editorSelector)).not.toContainText('a^2');
  });

  test('inserting a block equation on an empty line replaces it (no dangling paragraph)', async ({
    page,
  }) => {
    await setContent(page, '<p></p>');
    await insertBlock(page, 'x^2');
    await expect(page.locator('.app-notion-demo .dm-math-block')).toBeVisible();
    // The empty paragraph is replaced by the block, not left dangling beside it.
    expect(await topLevelTypes(page)).toEqual(['mathBlock']);
  });

  test('the block equation edit popover is centered under the block', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, '');

    const block = page.locator('.app-notion-demo .dm-math-block');
    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(block).toBeVisible();

    const bb = await block.boundingBox();
    const pb = await popover.boundingBox();
    expect(bb).not.toBeNull();
    expect(pb).not.toBeNull();
    const blockCenter = bb!.x + bb!.width / 2;
    const popCenter = pb!.x + pb!.width / 2;
    // The popover hugs the block's center (Notion-style), not its far-left edge.
    expect(Math.abs(blockCenter - popCenter)).toBeLessThan(16);
  });

  test('Escape on a freshly inserted empty equation removes it', async ({ page }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, '');

    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('.app-notion-demo .dm-math-block')).toHaveCount(1);

    await page.locator('.dm-math-popover textarea').press('Escape');
    await expect(popover).toBeHidden();
    await expect(page.locator('.app-notion-demo .dm-math-block')).toHaveCount(0);
  });

  test('a node-selected block equation opens the edit popover on Enter (keyboard a11y)', async ({
    page,
  }) => {
    await setContent(page, '<p>x</p>');
    await insertBlock(page, 'a^2');
    await page.locator(editorSelector).click();
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { focus: (pos?: string) => boolean } }
        | undefined;
      ed?.commands.focus('start');
    });
    // Arrow down out of the paragraph to node-select the block atom, then Enter
    // opens the same popover a click would (WCAG 2.1.1 keyboard access).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const popover = page.locator('.dm-math-popover');
    await expect(popover).toBeVisible();
    await expect(popover.locator('textarea')).toHaveValue('a^2');
  });

  test('the text bubble menu turns a selection into inline math', async ({ page }) => {
    await setContent(page, '<p>x^2</p>');
    await page.locator(`${editorSelector} p`).first().click({ clickCount: 3 });
    await page.waitForSelector('.dm-bubble-menu[data-show]');

    const inlineBtn = page.locator('.dm-bubble-menu button[title="Inline equation"]');
    await expect(inlineBtn).toBeVisible();
    await inlineBtn.click();

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    // The selected text became the equation source.
    await inline.click();
    await expect(page.locator('.dm-math-popover textarea')).toHaveValue('x^2');
  });

  test('typing $$ inserts a block equation and opens the editor', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('$$');

    await expect(page.locator('.app-notion-demo .dm-math-block')).toBeVisible();
    const input = page.locator('.dm-math-popover textarea');
    await expect(input).toBeFocused();

    // Finishing the equation in the popover renders it.
    await input.fill('a^2');
    await input.press('Enter');
    await expect(page.locator('.dm-math-popover')).toBeHidden();
    await expect(page.locator('.app-notion-demo .dm-math-block .katex')).toBeVisible();
  });

  test('typing $x^2$ inserts an inline equation', async ({ page }) => {
    await setContent(page, '<p></p>');
    await page.locator(editorSelector).click();
    await page.keyboard.type('$x^2$');

    const inline = page.locator('.app-notion-demo .dm-math-inline');
    await expect(inline).toBeVisible();
    await expect(inline.locator('.katex')).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Long / oversized equations. KaTeX never line-breaks display math and only
  // soft-wraps breakable inline math, so the theme is responsible for scrolling
  // or bounding the rest. These cover every layout edge: block scroll, centering,
  // vertical clipping, the edit popover, and inline wrap vs overflow.
  // ---------------------------------------------------------------------------
  test.describe('long and oversized equations', () => {
    const longBlock = Array.from({ length: 60 }, (_, i) => `x_{${i + 1}}`).join(' + ') + ' = 0';
    const shortBlock = 'E = mc^2';
    const tallMatrix = '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}';
    const wideWithDescenders = Array.from({ length: 30 }, (_, i) => `\\sum_{k=1}^{${i + 1}} a_k`).join(
      ' + ',
    );
    const longInlineBreakable = Array.from({ length: 60 }, (_, i) => `\\alpha_{${i + 1}}`).join(' + ');

    const blockSelector = '.app-notion-demo .dm-math-block';
    const inlineSelector = '.app-notion-demo .dm-math-inline';

    // Layout metrics for the single block node vs its editor clip box.
    const blockLayout = (page: Page) =>
      page.locator(blockSelector).evaluate((el) => {
        const editor = el.closest('.dm-editor') as HTMLElement;
        const er = editor.getBoundingClientRect();
        const br = el.getBoundingClientRect();
        const k = (el.querySelector('.katex-display') ?? el.querySelector('.katex')) as HTMLElement;
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

    test('long block: establishes its own horizontal scroll (overflow-x: auto)', async ({ page }) => {
      await setContent(page, '<p></p>');
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.overflowX).toBe('auto');
      expect(m.scrollableX).toBe(true);
    });

    test('long block: stays inside the editor content box (no spill past the edge)', async ({
      page,
    }) => {
      await setContent(page, '<p></p>');
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      expect((await blockLayout(page)).withinEditor).toBe(true);
    });

    test('long block: both ends of the formula are reachable by scrolling', async ({ page }) => {
      await setContent(page, '<p></p>');
      await insertBlock(page, longBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      // Start is at scrollLeft 0; a positive scroll range means the end is
      // reachable too (safe center pins the start rather than hiding it).
      expect((await blockLayout(page)).maxScrollLeft).toBeGreaterThan(0);
    });

    test('short block: stays centered with no scrollbar', async ({ page }) => {
      await setContent(page, '<p></p>');
      await insertBlock(page, shortBlock);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const c = await page.locator(blockSelector).evaluate((el) => {
        const k = (el.querySelector('.katex-display') ?? el.querySelector('.katex')) as HTMLElement;
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
      await setContent(page, '<p></p>');
      await insertBlock(page, tallMatrix);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.fitsHeight).toBe(true);
      expect(m.scrollableX).toBe(false); // a matrix fits horizontally
    });

    test('wide block with descenders: scrolls horizontally without clipping the bottom', async ({
      page,
    }) => {
      await setContent(page, '<p></p>');
      await insertBlock(page, wideWithDescenders);
      await expect(page.locator(`${blockSelector} .katex`)).toBeVisible();

      const m = await blockLayout(page);
      expect(m.scrollableX).toBe(true);
      expect(m.fitsHeight).toBe(true);
    });

    test('editing a long block: the popover stays within the viewport', async ({ page }) => {
      await setContent(page, '<p></p>');
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
      await setContent(page, '<p></p>');
      await insertBlock(page, longBlock);
      await openPopoverOnBlock(page);

      const p = await page.locator('.dm-math-popover-preview').evaluate((el) => {
        el.scrollLeft = 1_000_000;
        const maxScrollLeft = el.scrollLeft;
        el.scrollLeft = 0;
        return { scrolls: el.scrollWidth > el.clientWidth, maxScrollLeft };
      });
      expect(p.scrolls).toBe(true);
      expect(p.maxScrollLeft).toBeGreaterThan(0);
    });

    test('editing a long block: the textarea is not stretched to the formula width', async ({
      page,
    }) => {
      await setContent(page, '<p></p>');
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
      await setContent(page, '<p></p>');
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
        const editor = el.closest('.dm-editor') as HTMLElement;
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
});
