/**
 * Shrink-to-fit behavior of the caret-anchored suggestion menus (slash
 * command, emoji, mention) across all four demos.
 *
 * Regression coverage for a reported bug: with less than its full CSS
 * max-height free below the caret, a menu flipped fully above the caret even
 * when there was plenty of room for a scrollable menu, covering the content
 * above. Menus must shrink and scroll below the caret while at least 160px
 * fit there, and flip above only under that minimum.
 *
 * Geometry used by the tests (viewport 800px tall, offset 4, padding 10):
 *   caret ~200  -> ~580px below: full-height menu below, internal scroll
 *   caret ~520  -> ~250px below: menu stays below, shrunk, scrolls
 *   caret ~700  ->  ~80px below (< 160 minimum): menu flips above the caret
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const VIEWPORT = { width: 1280, height: 800 };

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

/** Fill the editor with enough empty paragraphs that the caret can be scrolled anywhere. */
async function fillAndFocusEnd(page: Page, target: DemoTarget): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: (pos?: string) => void } }
      | undefined;
    ed?.setContent('<p></p>'.repeat(60), false);
    ed?.commands.focus('end');
  });
  await page.click(target.editorSelector);
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { focus: (pos?: string) => void } }
      | undefined;
    ed?.commands.focus('end');
  });
  await page.waitForTimeout(150);
}

/**
 * Scrolls so the caret sits at the given viewport y. Tries the window first,
 * then the nearest scrollable ancestor (framework demos differ in which one
 * actually scrolls). Returns the final caret top.
 */
async function placeCaretAt(page: Page, targetTop: number): Promise<number | null> {
  const top = await page.evaluate((t) => {
    function caretTop(): number | null {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return null;
      let r: DOMRect | undefined = sel.getRangeAt(0).getClientRects()[0];
      if (!r) {
        const n = sel.focusNode;
        const el = n instanceof Element ? n : n?.parentElement;
        if (el) r = el.getBoundingClientRect();
      }
      return r ? r.top : null;
    }
    let top = caretTop();
    if (top === null) return null;
    window.scrollBy(0, top - t);
    top = caretTop();
    if (top !== null && Math.abs(top - t) > 8) {
      const sel = window.getSelection();
      const n = sel?.focusNode;
      let el: Element | null = n instanceof Element ? n : n?.parentElement ?? null;
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight + 4) {
          el.scrollTop += (caretTop() ?? t) - t;
          break;
        }
        el = el.parentElement;
      }
      top = caretTop();
    }
    return top;
  }, targetTop);
  await page.waitForTimeout(250);
  return top;
}

interface MenuBox {
  top: number;
  bottom: number;
  height: number;
  caretTop: number;
  caretBottom: number;
  side: 'below' | 'above' | 'overlap';
  scrollable: boolean;
  scrollTop: number;
  availVar: string;
}

async function menuBox(page: Page, menuSelector: string): Promise<MenuBox | null> {
  return page.evaluate((sel) => {
    const menu = document.querySelector(sel);
    if (!menu) return null;
    const s = window.getSelection();
    let cr: DOMRect | undefined = s?.rangeCount ? s.getRangeAt(0).getClientRects()[0] : undefined;
    if (!cr) {
      const n = s?.focusNode;
      const el = n instanceof Element ? n : n?.parentElement;
      if (el) cr = el.getBoundingClientRect();
    }
    if (!cr) return null;
    const r = menu.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      caretTop: Math.round(cr.top),
      caretBottom: Math.round(cr.bottom),
      side: (r.top >= cr.bottom ? 'below' : r.bottom <= cr.top + 1 ? 'above' : 'overlap'),
      scrollable: menu.scrollHeight > menu.clientHeight,
      scrollTop: menu.scrollTop,
      availVar: (menu as HTMLElement).style.getPropertyValue('--dm-available-height'),
    };
  }, menuSelector);
}

/** Rect of the highlighted item, for keyboard scroll-follow assertions. */
async function selectedItemVisible(
  page: Page,
  menuSelector: string,
  selectedSelector: string,
): Promise<{ visible: boolean; scrollTop: number } | null> {
  return page.evaluate(
    ({ menuSel, selSel }) => {
      const menu = document.querySelector(menuSel);
      const item = menu?.querySelector(selSel);
      if (!menu || !item) return null;
      const m = menu.getBoundingClientRect();
      const s = item.getBoundingClientRect();
      return {
        visible: s.top >= m.top - 1 && s.bottom <= m.bottom + 1,
        scrollTop: menu.scrollTop,
      };
    },
    { menuSel: menuSelector, selSel: selectedSelector },
  );
}

async function openMenuAt(
  page: Page,
  target: DemoTarget,
  caretY: number,
  trigger: string,
): Promise<void> {
  await fillAndFocusEnd(page, target);
  const top = await placeCaretAt(page, caretY);
  expect(top, `caret should sit near y=${String(caretY)}`).not.toBeNull();
  expect(Math.abs((top ?? 0) - caretY)).toBeLessThanOrEqual(60);
  await page.keyboard.type(trigger, { delay: 40 });
  await page.waitForTimeout(350);
}

for (const target of demoTargets) {
  test.describe(`${target.name}: suggestion menu available height`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
    });

    // ── Slash command menu ──────────────────────────────────────────────

    test('slash menu opens below at full height with room to spare', async ({ page }) => {
      await openMenuAt(page, target, 200, '/');
      const box = await menuBox(page, '.dm-slash-command-menu');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('below');
      // Full 22rem cap (352px border-box), NOT expanded to the larger
      // available space: the inline variable must not lift the design cap.
      expect(box?.height).toBeGreaterThanOrEqual(340);
      expect(box?.height).toBeLessThanOrEqual(364);
      expect(box?.scrollable).toBe(true);
      expect(box?.bottom).toBeLessThanOrEqual(VIEWPORT.height);
      expect(box?.availVar).not.toBe('');
    });

    test('slash menu shrinks and scrolls below the caret instead of flipping', async ({ page }) => {
      await openMenuAt(page, target, 520, '/');
      const box = await menuBox(page, '.dm-slash-command-menu');
      expect(box).not.toBeNull();
      // The reported bug: this used to flip fully above the caret.
      expect(box?.side).toBe('below');
      expect(box?.height).toBeLessThan(340);
      expect(box?.height).toBeGreaterThanOrEqual(160);
      expect(box?.scrollable).toBe(true);
      expect(box?.bottom).toBeLessThanOrEqual(VIEWPORT.height);
    });

    test('slash menu flips above the caret only when below-space is under the minimum', async ({ page }) => {
      await openMenuAt(page, target, 700, '/');
      const box = await menuBox(page, '.dm-slash-command-menu');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('above');
      expect(box?.bottom).toBeLessThanOrEqual(box?.caretTop ?? 0);
      expect(box?.top).toBeGreaterThanOrEqual(0);
      expect(box?.height).toBeGreaterThanOrEqual(160);
    });

    test('keyboard selection stays visible inside the shrunken slash menu', async ({ page }) => {
      await openMenuAt(page, target, 520, '/');
      for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const sel = await selectedItemVisible(page, '.dm-slash-command-menu', '[data-selected]');
      expect(sel).not.toBeNull();
      expect(sel?.visible).toBe(true);
      expect(sel?.scrollTop).toBeGreaterThan(0);
    });

    // ── Emoji suggestions ───────────────────────────────────────────────

    test('emoji suggestions shrink and scroll below the caret instead of flipping', async ({ page }) => {
      await openMenuAt(page, target, 560, ':s');
      const box = await menuBox(page, '.dm-emoji-suggestion');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('below');
      // Previously this dropdown had no max-height at all and could not
      // scroll; now it shrinks into the space and scrolls.
      expect(box?.scrollable).toBe(true);
      expect(box?.bottom).toBeLessThanOrEqual(VIEWPORT.height);
      expect(box?.availVar).not.toBe('');
    });

    test('emoji suggestions flip above the caret when below-space is under the minimum', async ({ page }) => {
      await openMenuAt(page, target, 700, ':s');
      const box = await menuBox(page, '.dm-emoji-suggestion');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('above');
      expect(box?.bottom).toBeLessThanOrEqual(box?.caretTop ?? 0);
      expect(box?.top).toBeGreaterThanOrEqual(0);
    });

    test('keyboard selection stays visible inside the scrolled emoji list', async ({ page }) => {
      await openMenuAt(page, target, 560, ':s');
      for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const sel = await selectedItemVisible(
        page,
        '.dm-emoji-suggestion',
        '.dm-emoji-suggestion-item--selected',
      );
      expect(sel).not.toBeNull();
      expect(sel?.visible).toBe(true);
      expect(sel?.scrollTop).toBeGreaterThan(0);
    });

    // ── Mention suggestions ─────────────────────────────────────────────

    test('mention suggestions stay below the caret when they fit', async ({ page }) => {
      await openMenuAt(page, target, 400, '@');
      const box = await menuBox(page, '.dm-mention-suggestion');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('below');
      expect(box?.bottom).toBeLessThanOrEqual(VIEWPORT.height);
    });

    test('mention suggestions flip above the caret when below-space is under the minimum', async ({ page }) => {
      await openMenuAt(page, target, 700, '@');
      const box = await menuBox(page, '.dm-mention-suggestion');
      expect(box).not.toBeNull();
      expect(box?.side).toBe('above');
      expect(box?.bottom).toBeLessThanOrEqual(box?.caretTop ?? 0);
      expect(box?.top).toBeGreaterThanOrEqual(0);
    });
  });
}
