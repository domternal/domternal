/**
 * A11y guarantees around block-controls drag reorders, across all four demos.
 *
 * Two concerns from the accessibility pass (commit 51757df):
 *
 *  1. `announce()` (core `utils/announce.ts`) is the shared `aria-live=polite`
 *     status region (`.dm-live-region`) screen readers use to hear the outcome
 *     of a non-visual action. In the FREE build this utility is exported and
 *     unit-tested (`announce.test.ts`), but NOTHING in the free block-controls
 *     drag path calls it: the only production callers live in the pro
 *     extension-columns package (column resize + move-block-to-column). So the
 *     free demo has no gesture that populates the region, and these specs pin
 *     that honest contract rather than fabricate a trigger.
 *
 *  2. The custom drop line `.dm-block-drop-indicator` is made purely of a
 *     `background` colour, which Windows High Contrast / `forced-colors` strips.
 *     The theme repaints it with the `Highlight` system colour under
 *     `@media (forced-colors: active)` (`theme/src/_block-handle.scss`) so the
 *     drop target stays visible. These specs drive a real handle drag and check
 *     the indicator survives both the default palette and forced colours.
 */
import { test } from './fixtures.js';
import { expect, type Page, type JSHandle } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';
const dropIndicatorSelector = '.dm-block-drop-indicator';
const liveRegionSelector = '.dm-live-region';

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

interface Geometry {
  editorLeft: number;
  editorRight: number;
  rows: Array<{ text: string; top: number; bottom: number }>;
}

/** `.dm-editor`'s horizontal edges plus the client rects of its top-level paragraphs. */
async function geometry(page: Page, target: DemoTarget): Promise<Geometry> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const editor = pm?.closest('.dm-editor');
    if (!pm || !editor) throw new Error('notion editor not found');
    const er = editor.getBoundingClientRect();
    const rows = Array.from(pm.querySelectorAll(':scope > p')).map((p) => {
      const r = p.getBoundingClientRect();
      return { text: p.textContent ?? '', top: r.top, bottom: r.bottom };
    });
    return { editorLeft: er.left, editorRight: er.right, rows };
  }, target.editorSelector);
}

function rowOf(geo: Geometry, text: string): { text: string; top: number; bottom: number } {
  const row = geo.rows.find((r) => r.text === text);
  if (!row) throw new Error(`paragraph "${text}" not found`);
  return row;
}

/**
 * Drag a paragraph by its handle and release at a point. Mirrors the proven
 * path in `block-handle-margin.spec.ts`: dragover + drop go to
 * `document.elementFromPoint` with one shared DataTransfer, and the
 * document-level listeners read only the coordinates.
 */
async function dragToPoint(
  page: Page,
  target: DemoTarget,
  sourceText: string,
  x: number,
  y: number,
): Promise<void> {
  await page.locator(`${target.editorSelector} > p`, { hasText: sourceText }).hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);
  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  // The extension commits `draggedFrom` via a deferred dispatch; let it land.
  await page.waitForTimeout(20);
  await page.evaluate(({ dt: data, x: cx, y: cy }) => {
    const el = document.elementFromPoint(cx, cy) ?? document.body;
    const init: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      dataTransfer: data,
    };
    el.dispatchEvent(new DragEvent('dragover', init));
    el.dispatchEvent(new DragEvent('drop', init));
  }, { dt, x, y });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(80);
  await dt.dispose();
}

/**
 * Start a handle drag over `sourceText` and dragover `(x, y)` until the drop
 * indicator becomes visible, WITHOUT releasing. Returns the drag's DataTransfer
 * so the caller can read the still-shown indicator and then `endDrag`.
 *
 * `onDocumentDragover` coalesces the indicator repaint into one rAF, so each
 * poll iteration dispatches a fresh dragover and waits a frame before checking
 * `[data-show]`.
 */
async function startDragAndShowIndicator(
  page: Page,
  target: DemoTarget,
  sourceText: string,
  x: number,
  y: number,
): Promise<JSHandle<DataTransfer>> {
  await page.locator(`${target.editorSelector} > p`, { hasText: sourceText }).hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(dragBtnSelector).dispatchEvent('dragstart', { dataTransfer: dt });
  await page.waitForTimeout(20);

  await expect
    .poll(
      async () => {
        await page.evaluate(async (pt) => {
          const el = document.elementFromPoint(pt.x, pt.y) ?? document.body;
          const init: DragEventInit = {
            bubbles: true,
            cancelable: true,
            clientX: pt.x,
            clientY: pt.y,
            dataTransfer: new DataTransfer(),
          };
          el.dispatchEvent(new DragEvent('dragover', init));
          await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
        }, { x, y });
        return page.evaluate(
          (sel) => Boolean(document.querySelector(`${sel}[data-show]`)),
          dropIndicatorSelector,
        );
      },
      { message: 'drop indicator never became visible', timeout: 2000 },
    )
    .toBe(true);

  return dt;
}

async function endDrag(page: Page, dt: JSHandle<DataTransfer>): Promise<void> {
  await page.locator(dragBtnSelector).dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(20);
  await dt.dispose();
}

interface IndicatorInfo {
  display: string;
  backgroundColor: string;
  boxShadow: string;
  dataMode: string | null;
  width: number;
  height: number;
  editorBackgroundColor: string;
  forcedColorsActive: boolean;
}

/** Computed paint + geometry of the currently-shown drop indicator (null if hidden). */
async function readIndicator(page: Page, target: DemoTarget): Promise<IndicatorInfo | null> {
  return page.evaluate(({ sel, indicatorSel }) => {
    const el = document.querySelector(indicatorSel + '[data-show]');
    if (!(el instanceof HTMLElement)) return null;
    const pm = document.querySelector(sel);
    const editor = pm?.closest('.dm-editor');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      display: cs.display,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow,
      dataMode: el.getAttribute('data-mode'),
      width: r.width,
      height: r.height,
      editorBackgroundColor:
        editor instanceof HTMLElement ? getComputedStyle(editor).backgroundColor : '',
      forcedColorsActive: window.matchMedia('(forced-colors: active)').matches,
    };
  }, { sel: target.editorSelector, indicatorSel: dropIndicatorSelector });
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

for (const target of demoTargets) {
  const paragraphs = (page: Page): ReturnType<Page['locator']> =>
    page.locator(`${target.editorSelector} > p`);

  test.describe(`${target.name} - aria-live announce region`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Aaa</p><p>Bbb</p><p>Ccc</p>');
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Bbb', 'Ccc']);
    });

    // A completed handle-drag reorder is exactly the action the pro columns
    // extension announces. In the FREE build that path stays silent: no
    // `.dm-live-region` is created. This pins the current contract and would
    // catch either an unexpected region leak or an un-mirrored wiring of
    // `announce()` into the free drag path. The positive population contract
    // (role/aria-live/text) is covered by the core unit test announce.test.ts.
    test('a free handle-drag reorder surfaces no aria-live region', async ({ page }) => {
      const geo = await geometry(page, target);
      const x = geo.editorRight + 50;
      const y = (rowOf(geo, 'Aaa').bottom + rowOf(geo, 'Bbb').top) / 2;

      await dragToPoint(page, target, 'Ccc', x, y);

      // The announce-eligible action really happened.
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Ccc', 'Bbb']);

      const regionCount = await page.evaluate(({ sel, regionSel }) => {
        const pm = document.querySelector(sel);
        const editor = pm?.closest('.dm-editor');
        if (!editor) return -1;
        return editor.querySelectorAll(`:scope > ${regionSel}`).length;
      }, { sel: target.editorSelector, regionSel: liveRegionSelector });

      // -1 would mean the editor container vanished; 0 is the free contract.
      expect(regionCount).toBe(0);
    });
  });

  // Baseline (explicit default palette): the indicator's visibility comes from
  // a coloured background plus a box-shadow glow - precisely the paint that
  // forced colours strips. Establishes the premise the forced-colors rule fixes.
  test.describe(`${target.name} - drop indicator (default colors)`, () => {
    // `forcedColors` is not a top-level test-use option in this Playwright
    // version; it lives on the browser context, so set it via `contextOptions`.
    test.use({ contextOptions: { forcedColors: 'none' } });

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Aaa</p><p>Bbb</p><p>Ccc</p>');
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Bbb', 'Ccc']);
    });

    test('is a painted, shadowed line in normal contrast mode', async ({ page }) => {
      const geo = await geometry(page, target);
      const x = (geo.editorLeft + geo.editorRight) / 2;
      const y = (rowOf(geo, 'Aaa').bottom + rowOf(geo, 'Bbb').top) / 2;

      // Drag Ccc up into the Aaa/Bbb gap: a real move, so the indicator shows
      // (a no-op slot is suppressed by `updateDropIndicator`).
      const dt = await startDragAndShowIndicator(page, target, 'Ccc', x, y);
      const info = await readIndicator(page, target);
      await endDrag(page, dt);

      if (!info) throw new Error('drop indicator not found after show');
      expect(info.forcedColorsActive).toBe(false);
      expect(info.dataMode).not.toBe('nested');
      expect(info.display).not.toBe('none');
      expect(info.height).toBeGreaterThan(0);
      expect(info.width).toBeGreaterThan(0);
      // Visible because it is painted: a coloured fill and the glow box-shadow.
      expect(info.backgroundColor).not.toBe(TRANSPARENT);
      expect(info.backgroundColor).not.toBe('transparent');
      expect(info.boxShadow).not.toBe('none');
    });
  });

  // Forced colours strip the accent background; the theme repaints the sibling
  // line with the `Highlight` system colour (and drops the shadow) so the drop
  // target stays visible. Grounded in theme/src/_block-handle.scss:
  //   @media (forced-colors: active) { .dm-block-drop-indicator { background: Highlight; box-shadow: none; } }
  test.describe(`${target.name} - drop indicator (forced colors)`, () => {
    // `forcedColors` is not a top-level test-use option in this Playwright
    // version; it lives on the browser context, so set it via `contextOptions`.
    test.use({ contextOptions: { forcedColors: 'active' } });

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Aaa</p><p>Bbb</p><p>Ccc</p>');
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Bbb', 'Ccc']);
    });

    test('stays visible and repainted under forced colors', async ({ page }) => {
      const geo = await geometry(page, target);
      const x = (geo.editorLeft + geo.editorRight) / 2;
      const y = (rowOf(geo, 'Aaa').bottom + rowOf(geo, 'Bbb').top) / 2;

      const dt = await startDragAndShowIndicator(page, target, 'Ccc', x, y);
      const info = await readIndicator(page, target);
      await endDrag(page, dt);

      if (!info) throw new Error('drop indicator not found after show');
      // Emulation actually took effect (otherwise the test proves nothing).
      expect(info.forcedColorsActive).toBe(true);
      // Sibling line, so the opaque-background branch of the rule applies.
      expect(info.dataMode).not.toBe('nested');
      // Still rendered: forced colours must not hide the drop target.
      expect(info.display).not.toBe('none');
      expect(info.height).toBeGreaterThan(0);
      expect(info.width).toBeGreaterThan(0);
      // Repainted with a system colour, not stripped to transparent...
      expect(info.backgroundColor).not.toBe(TRANSPARENT);
      expect(info.backgroundColor).not.toBe('transparent');
      // ...and contrasting against the editor surface, so the line reads.
      expect(info.backgroundColor).not.toBe(info.editorBackgroundColor);
      // The forced-colors branch drops the glow (base style has a shadow).
      expect(info.boxShadow).toBe('none');
    });
  });
}
