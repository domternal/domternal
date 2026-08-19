/**
 * extension-table min-width floor + horizontal scroll, across all four demos.
 *
 * A table whose columns carry no explicit `colwidth` (a fresh table, or one
 * grown with add-column while unfrozen) is floored by TableView.updateColumns
 * at `columns * defaultCellMinWidth` (100px) via `table.style.minWidth`. The
 * `.tableWrapper` is `overflow-x: auto`, so once the floor exceeds the wrapper
 * the table scrolls horizontally instead of crushing the cells to slivers
 * (Notion behavior). A small table that fits never overflows its wrapper.
 *
 * The Notion demo page is capped at 56rem (896px), so a 10-column table
 * (1000px floor) overflows while a 3-column table (300px floor) fits.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/**
 * TableView's `defaultCellMinWidth` default (packages/extension-table/src/
 * Table.ts). None of the four Notion demos override it, so an unfrozen table
 * floors at `columns * DEFAULT_CELL_MIN_WIDTH` px.
 */
const DEFAULT_CELL_MIN_WIDTH = 100;

/** Fresh 3-column table: header row + two data rows, no explicit colwidths. */
const TABLE_3COL =
  '<table>' +
    '<tr><th>Header A</th><th>Header B</th><th>Header C</th></tr>' +
    '<tr><td>Cell one</td><td>Cell two</td><td>Cell three</td></tr>' +
    '<tr><td>Cell four</td><td>Cell five</td><td>Cell six</td></tr>' +
  '</table>';

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

/** Run `addColumnAfter` once via the demo editor's command API. */
async function addColumnAfter(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { addColumnAfter: () => boolean } }
      | undefined;
    ed?.commands.addColumnAfter();
  });
  // The command dispatches synchronously; give the NodeView update a beat.
  await page.waitForTimeout(20);
}

/** Column count from the first row of the (only) table in the editor. */
async function columnCount(page: Page, target: DemoTarget): Promise<number> {
  return page.locator(`${target.editorSelector} tr`).first().locator('th, td').count();
}

interface TableGeometry {
  /** `table.style.minWidth` (the inline floor), e.g. "1000px". */
  minWidth: string;
  /** `table.offsetWidth` - the rendered table width. */
  tableWidth: number;
  wrapperClientWidth: number;
  wrapperScrollWidth: number;
  /** Computed `overflow-x` of the `.tableWrapper`. */
  overflowX: string;
  colCount: number;
}

/** Read the table + wrapper layout in a single evaluate to avoid re-layout races. */
async function tableGeometry(page: Page, target: DemoTarget): Promise<TableGeometry> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const wrapper = pm?.querySelector('.tableWrapper');
    const table = wrapper?.querySelector('table');
    if (!(wrapper instanceof HTMLElement) || !(table instanceof HTMLTableElement)) {
      throw new Error('table not found');
    }
    const firstRow = table.querySelector('tr');
    const colCount = firstRow ? firstRow.querySelectorAll('th, td').length : 0;
    return {
      minWidth: table.style.minWidth,
      tableWidth: table.offsetWidth,
      wrapperClientWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
      overflowX: getComputedStyle(wrapper).overflowX,
      colCount,
    };
  }, target.editorSelector);
}

interface ScrollProbe {
  /** Last cell's right edge, before scrolling: it sits past the wrapper. */
  beforeLastCellRight: number;
  wrapperRight: number;
  /** Wrapper `scrollLeft` after scrolling to the end (browser-clamped to max). */
  afterScrollLeft: number;
  /** Last cell's right edge after scrolling: now inside the wrapper. */
  afterLastCellRight: number;
}

/**
 * Scroll the wrapper fully right and report the last cell's reachability. The
 * browser clamps `scrollLeft` to `scrollWidth - clientWidth`, so a positive
 * value proves real horizontal scroll.
 */
async function scrollToTableEnd(page: Page, target: DemoTarget): Promise<ScrollProbe> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const wrapper = pm?.querySelector('.tableWrapper');
    if (!(wrapper instanceof HTMLElement)) throw new Error('wrapper not found');
    const cells = wrapper.querySelectorAll('tr:first-child > th, tr:first-child > td');
    const last = cells[cells.length - 1];
    if (!(last instanceof HTMLElement)) throw new Error('last cell not found');

    const wrapperRight = wrapper.getBoundingClientRect().right;
    const beforeLastCellRight = last.getBoundingClientRect().right;

    wrapper.scrollLeft = wrapper.scrollWidth; // clamped to (scrollWidth - clientWidth)

    return {
      beforeLastCellRight,
      wrapperRight,
      afterScrollLeft: wrapper.scrollLeft,
      afterLastCellRight: last.getBoundingClientRect().right,
    };
  }, target.editorSelector);
}

for (const target of demoTargets) {
  test.describe(`${target.name} - table min-width floor + horizontal scroll`, () => {
    test('many columns floor at the default width and scroll horizontally', async ({ page }) => {
      const startCols = 3;
      const targetCols = 10;

      await goNotion(page, target);
      await setContent(page, TABLE_3COL);
      await page.waitForSelector(`${target.editorSelector} .tableWrapper`);
      // Put the caret inside a cell so `addColumnAfter` operates on the table.
      await page.locator(`${target.editorSelector} td`).first().click();

      for (let i = 0; i < targetCols - startCols; i++) {
        await addColumnAfter(page);
      }
      await expect.poll(() => columnCount(page, target)).toBe(targetCols);

      const geo = await tableGeometry(page, target);
      expect(geo.colCount).toBe(targetCols);
      // Floor: no explicit colwidths, so table.style.minWidth === cols * 100 px.
      expect(geo.minWidth).toBe(`${String(targetCols * DEFAULT_CELL_MIN_WIDTH)}px`);
      // Rendered near the floor (border-collapse adds ~1px), well over cols*95.
      expect(geo.tableWidth).toBeGreaterThanOrEqual(targetCols * 95);
      // Table is wider than its wrapper: it overflows.
      expect(geo.tableWidth).toBeGreaterThan(geo.wrapperClientWidth);
      // Wrapper is the scroll container and actually has scrollable overflow.
      expect(geo.overflowX).toBe('auto');
      expect(geo.wrapperScrollWidth).toBeGreaterThan(geo.wrapperClientWidth);

      // The last column is off to the right, then scrolling reveals it.
      const probe = await scrollToTableEnd(page, target);
      expect(probe.beforeLastCellRight).toBeGreaterThan(probe.wrapperRight);
      expect(probe.afterScrollLeft).toBeGreaterThan(0);
      expect(probe.afterLastCellRight).toBeLessThanOrEqual(probe.wrapperRight + 2);
    });

    test('a small table that fits does not overflow its wrapper', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, TABLE_3COL);
      await page.waitForSelector(`${target.editorSelector} .tableWrapper`);
      await expect.poll(() => columnCount(page, target)).toBe(3);

      const geo = await tableGeometry(page, target);
      expect(geo.colCount).toBe(3);
      // 3 columns floor at 300px, far under the ~800px wrapper, so the table
      // stays within the wrapper (width: 100%) and there is nothing to scroll.
      expect(geo.overflowX).toBe('auto');
      expect(geo.tableWidth).toBeLessThanOrEqual(geo.wrapperClientWidth + 2);
      expect(geo.wrapperScrollWidth).toBeLessThanOrEqual(geo.wrapperClientWidth + 2);
    });
  });
}
