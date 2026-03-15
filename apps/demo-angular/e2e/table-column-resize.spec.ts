import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';

const SIMPLE_TABLE =
  '<table>' +
    '<tr><th>Header A</th><th>Header B</th><th>Header C</th></tr>' +
    '<tr><td>Cell one</td><td>Cell two</td><td>Cell three</td></tr>' +
    '<tr><td>Cell four</td><td>Cell five</td><td>Cell six</td></tr>' +
  '</table>';

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      comp.editor.setContent(h, false);
      comp.editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getCellBox(page: Page, cellIndex: number) {
  const cells = page.locator(`${editorSelector} td, ${editorSelector} th`);
  return cells.nth(cellIndex).boundingBox();
}

/** Count .column-resize-handle elements in the editor. */
async function resizeHandleCount(page: Page): Promise<number> {
  return page.locator(`${editorSelector} .column-resize-handle`).count();
}

/** Check if ProseMirror element has the dm-mouse-drag class. */
async function hasMouseDragClass(page: Page): Promise<boolean> {
  return (await page.locator(`${editorSelector}.dm-mouse-drag`).count()) > 0;
}

/** Check if ProseMirror element has the resize-cursor class. */
async function hasResizeCursorClass(page: Page): Promise<boolean> {
  return (await page.locator(`${editorSelector}.resize-cursor`).count()) > 0;
}

/** Check if the .tableWrapper has a horizontal scrollbar. */
async function hasHorizontalScrollbar(page: Page): Promise<boolean> {
  return page.evaluate((sel) => {
    const wrapper = document.querySelector(sel + ' .tableWrapper') as HTMLElement;
    if (!wrapper) return false;
    return wrapper.scrollWidth > wrapper.clientWidth;
  }, editorSelector);
}

/** Get table.offsetWidth and wrapper.clientWidth. */
async function getTableAndWrapperWidths(page: Page) {
  return page.evaluate((sel) => {
    const wrapper = document.querySelector(sel + ' .tableWrapper') as HTMLElement;
    const table = wrapper?.querySelector('table') as HTMLElement;
    return {
      tableWidth: table?.offsetWidth ?? 0,
      wrapperWidth: wrapper?.clientWidth ?? 0,
    };
  }, editorSelector);
}

/** Get colwidth attributes from all first-row cells in the ProseMirror state. */
async function getColwidths(page: Page): Promise<(number[] | null)[]> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return [];
    const doc = comp.editor.state.doc;
    const table = doc.firstChild;
    if (!table || table.type.name !== 'table') return [];
    const firstRow = table.firstChild;
    if (!firstRow) return [];
    const widths: (number[] | null)[] = [];
    firstRow.forEach((cell: any) => {
      widths.push(cell.attrs.colwidth);
    });
    return widths;
  });
}

/** Get bounding boxes for all cells in a given row (0-indexed). */
async function getRowCellBoxes(page: Page, rowIndex: number) {
  const rows = page.locator(`${editorSelector} tr`);
  const cells = rows.nth(rowIndex).locator('td, th');
  const count = await cells.count();
  const boxes = [];
  for (let i = 0; i < count; i++) {
    boxes.push(await cells.nth(i).boundingBox());
  }
  return boxes;
}

/** Hover on a column border to activate the resize handle, then mousedown. */
async function startColumnResize(page: Page, cellIndex: number) {
  const box = await getCellBox(page, cellIndex);
  if (!box) throw new Error(`Cell ${cellIndex} not found`);
  const borderX = box.x + box.width;
  const y = box.y + box.height / 2;
  await page.mouse.move(borderX - 2, y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(50);
  return { borderX, y };
}

/** Perform a complete column resize drag: hover → mousedown → drag → mouseup. */
async function dragColumnBorder(page: Page, cellIndex: number, deltaX: number) {
  const { borderX, y } = await startColumnResize(page, cellIndex);
  await page.mouse.move(borderX + deltaX, y, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

// =============================================================================
// Column resize handle suppression during cell/text selection drag
// =============================================================================

test.describe('Table — Column resize handle suppression during drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('no resize handle when dragging across cells horizontally', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3); // "Cell one"
    const cell5 = await getCellBox(page, 5); // "Cell three"
    if (!cell3 || !cell5) return;

    // Mousedown inside cell3, away from borders
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag across to cell5, passing through column borders
    await page.mouse.move(cell5.x + cell5.width / 2, cell5.y + cell5.height / 2, { steps: 20 });
    await page.waitForTimeout(100);

    // During drag: no resize handle should be in the DOM
    expect(await resizeHandleCount(page)).toBe(0);
    // dm-mouse-drag class should be present
    expect(await hasMouseDragClass(page)).toBe(true);

    await page.mouse.up();
  });

  test('no resize handle when dragging vertically across rows near border', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3); // Row 2, Col 1
    const cell6 = await getCellBox(page, 6); // Row 3, Col 1
    if (!cell3 || !cell6) return;

    // Mousedown near the right edge of cell3 (close to column border)
    await page.mouse.move(cell3.x + cell3.width - 8, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag down to cell6, staying near the right edge
    await page.mouse.move(cell6.x + cell6.width - 8, cell6.y + cell6.height / 2, { steps: 10 });
    await page.waitForTimeout(100);

    // No resize handle during drag
    expect(await resizeHandleCount(page)).toBe(0);

    await page.mouse.up();
  });

  test('dm-mouse-drag class added on mousedown in cell, removed on mouseup', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;

    // Before mousedown: no class
    expect(await hasMouseDragClass(page)).toBe(false);

    // Mousedown in cell content area
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // During mousedown: class present
    expect(await hasMouseDragClass(page)).toBe(true);

    // Mouseup
    await page.mouse.up();
    await page.waitForTimeout(50);

    // After mouseup: class removed
    expect(await hasMouseDragClass(page)).toBe(false);
  });

  test('no resize-cursor class during drag near column border', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3);
    const cell4 = await getCellBox(page, 4);
    if (!cell3 || !cell4) return;

    // Mousedown inside cell3, away from border
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag towards the right border of cell3 (within 5px of border)
    const borderX = cell3.x + cell3.width;
    await page.mouse.move(borderX - 2, cell3.y + cell3.height / 2, { steps: 10 });
    await page.waitForTimeout(100);

    // resize-cursor should NOT be present during drag
    expect(await hasResizeCursorClass(page)).toBe(false);
    // No resize handle either
    expect(await resizeHandleCount(page)).toBe(0);

    await page.mouse.up();
  });

  test('no resize handle during text selection drag within a single cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3); // "Cell one"
    if (!cell3) return;

    // Mousedown at the left side of cell3
    await page.mouse.move(cell3.x + 5, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag to right side of cell3, near the column border
    await page.mouse.move(cell3.x + cell3.width - 3, cell3.y + cell3.height / 2, { steps: 15 });
    await page.waitForTimeout(100);

    // No resize handle during text selection drag
    expect(await resizeHandleCount(page)).toBe(0);
    expect(await hasMouseDragClass(page)).toBe(true);

    await page.mouse.up();
  });
});

// =============================================================================
// Normal column resize behavior (not suppressed)
// =============================================================================

test.describe('Table — Column resize works normally', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('hover near column border shows resize handle and resize-cursor', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;

    // Move to right edge of cell3 (within 5px — handleWidth default)
    const borderX = cell3.x + cell3.width;
    await page.mouse.move(borderX - 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    // Resize handle should be visible
    expect(await resizeHandleCount(page)).toBeGreaterThan(0);
    // resize-cursor class should be present
    expect(await hasResizeCursorClass(page)).toBe(true);

    // Move away from border
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    // Resize handle and cursor should be gone
    expect(await resizeHandleCount(page)).toBe(0);
    expect(await hasResizeCursorClass(page)).toBe(false);
  });

  test('column resize drag changes column width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;

    // Hover near right border → resize handle appears
    const borderX = cell3.x + cell3.width;
    await page.mouse.move(borderX - 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);
    expect(await resizeHandleCount(page)).toBeGreaterThan(0);

    // Record initial width
    const initialWidth = cell3.width;

    // Mousedown on border to start resize
    await page.mouse.down();
    await page.waitForTimeout(50);

    // dm-mouse-drag should NOT be added (activeHandle > -1 on resize border)
    expect(await hasMouseDragClass(page)).toBe(false);

    // Drag right to resize
    await page.mouse.move(borderX + 50, cell3.y + cell3.height / 2, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Cell should have resized
    const newBox = await getCellBox(page, 3);
    if (!newBox) return;
    expect(newBox.width).toBeGreaterThan(initialWidth);
  });

  test('after cell selection drag, hover near border shows resize handle again', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cell3 = await getCellBox(page, 3);
    const cell4 = await getCellBox(page, 4);
    if (!cell3 || !cell4) return;

    // Drag across cells (cell selection)
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // dm-mouse-drag should be removed
    expect(await hasMouseDragClass(page)).toBe(false);

    // Now hover near border — normal behavior should be restored
    const borderX = cell3.x + cell3.width;
    await page.mouse.move(borderX - 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    // Resize handle should appear
    expect(await resizeHandleCount(page)).toBeGreaterThan(0);
  });
});

// =============================================================================
// Table width stability (no 1px growth on first resize)
// =============================================================================

test.describe('Table — No width growth on first resize', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table does not grow when starting first column resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const before = await getTableAndWrapperWidths(page);
    expect(before.tableWidth).toBeLessThanOrEqual(before.wrapperWidth);

    // Start a resize on the first column border (hover + mousedown triggers freezeColumnWidths)
    await startColumnResize(page, 3); // "Cell one" right border
    await page.waitForTimeout(100);

    const after = await getTableAndWrapperWidths(page);
    expect(after.tableWidth).toBeLessThanOrEqual(after.wrapperWidth);

    // No horizontal scrollbar should appear
    expect(await hasHorizontalScrollbar(page)).toBe(false);

    await page.mouse.up();
  });

  test('no scrollbar after completing first resize drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Perform a small resize drag
    await dragColumnBorder(page, 3, 30);

    // Wrapper should not scroll
    expect(await hasHorizontalScrollbar(page)).toBe(false);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
  });

  test('no scrollbar after resizing second column border', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize via the second column's right border (cell index 4 = "Cell two")
    await dragColumnBorder(page, 4, -20);

    expect(await hasHorizontalScrollbar(page)).toBe(false);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
  });
});

// =============================================================================
// Column width freezing (colwidth attributes)
// =============================================================================

test.describe('Table — Column width freezing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('fresh table has no colwidth attributes', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const colwidths = await getColwidths(page);
    // All cells should have null colwidth (no explicit widths)
    for (const cw of colwidths) {
      expect(cw).toBeNull();
    }
  });

  test('all columns get colwidth attributes after first resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Start and complete a resize drag
    await dragColumnBorder(page, 3, 30);

    const colwidths = await getColwidths(page);
    // All 3 columns should now have explicit widths
    expect(colwidths).toHaveLength(3);
    for (const cw of colwidths) {
      expect(cw).not.toBeNull();
      expect(cw![0]).toBeGreaterThan(0);
    }
  });

  test('colwidth values sum to table width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 3, 30);

    const colwidths = await getColwidths(page);
    const sum = colwidths.reduce((s, cw) => s + (cw?.[0] ?? 0), 0);

    const { tableWidth } = await getTableAndWrapperWidths(page);
    // Sum of colwidths should match table width (within 1px tolerance for rounding)
    expect(Math.abs(sum - tableWidth)).toBeLessThanOrEqual(1);
  });

  test('colwidth attributes persist across second resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // First resize
    await dragColumnBorder(page, 3, 30);
    const firstColwidths = await getColwidths(page);

    // Second resize on a different border
    await dragColumnBorder(page, 4, -20);
    const secondColwidths = await getColwidths(page);

    // All columns should still have widths
    expect(secondColwidths).toHaveLength(3);
    for (const cw of secondColwidths) {
      expect(cw).not.toBeNull();
      expect(cw![0]).toBeGreaterThan(0);
    }

    // First column should be unchanged (we resized columns 2-3 border)
    expect(secondColwidths[0]![0]).toBe(firstColwidths[0]![0]);
  });
});

// =============================================================================
// Neighbor mode resize behavior (default)
// =============================================================================

test.describe('Table — Neighbor mode resize behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('total table width stays constant after resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const beforeWidths = await getTableAndWrapperWidths(page);
    const tableBefore = beforeWidths.tableWidth;

    // Resize first column right by 50px
    await dragColumnBorder(page, 3, 50);

    const afterWidths = await getTableAndWrapperWidths(page);
    // Table width should stay the same (neighbor compensates)
    expect(Math.abs(afterWidths.tableWidth - tableBefore)).toBeLessThanOrEqual(1);
  });

  test('dragging column border right grows dragged column and shrinks neighbor', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Get initial cell widths (row 2: indices 3, 4, 5)
    const initialBoxes = await getRowCellBoxes(page, 1);

    // Drag first column border right by 50px
    await dragColumnBorder(page, 3, 50);

    const afterBoxes = await getRowCellBoxes(page, 1);

    // Column 1 (dragged) should be wider
    expect(afterBoxes[0]!.width).toBeGreaterThan(initialBoxes[0]!.width + 30);
    // Column 2 (neighbor) should be narrower
    expect(afterBoxes[1]!.width).toBeLessThan(initialBoxes[1]!.width - 30);
    // Column 3 (untouched) should stay ~same
    expect(Math.abs(afterBoxes[2]!.width - initialBoxes[2]!.width)).toBeLessThanOrEqual(2);
  });

  test('dragging column border left shrinks dragged column and grows neighbor', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);

    // Drag first column border left by 30px
    await dragColumnBorder(page, 3, -30);

    const afterBoxes = await getRowCellBoxes(page, 1);

    // Column 1 (dragged) should be narrower
    expect(afterBoxes[0]!.width).toBeLessThan(initialBoxes[0]!.width - 15);
    // Column 2 (neighbor) should be wider
    expect(afterBoxes[1]!.width).toBeGreaterThan(initialBoxes[1]!.width + 15);
  });

  test('sum of all cell widths stays constant after resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);
    const initialSum = initialBoxes.reduce((s, b) => s + b!.width, 0);

    await dragColumnBorder(page, 3, 50);

    const afterBoxes = await getRowCellBoxes(page, 1);
    const afterSum = afterBoxes.reduce((s, b) => s + b!.width, 0);

    // Sum should stay constant (within 2px tolerance for borders)
    expect(Math.abs(afterSum - initialSum)).toBeLessThanOrEqual(2);
  });

  test('resizing second column border affects columns 2 and 3', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);

    // Drag second column border (cell index 4 = "Cell two") right by 40px
    await dragColumnBorder(page, 4, 40);

    const afterBoxes = await getRowCellBoxes(page, 1);

    // Column 1 should stay ~same
    expect(Math.abs(afterBoxes[0]!.width - initialBoxes[0]!.width)).toBeLessThanOrEqual(2);
    // Column 2 (dragged) should be wider
    expect(afterBoxes[1]!.width).toBeGreaterThan(initialBoxes[1]!.width + 25);
    // Column 3 (neighbor) should be narrower
    expect(afterBoxes[2]!.width).toBeLessThan(initialBoxes[2]!.width - 25);
  });

  test('multiple sequential resizes preserve total table width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: initialWidth } = await getTableAndWrapperWidths(page);

    // Resize first border right
    await dragColumnBorder(page, 3, 40);
    // Resize second border left
    await dragColumnBorder(page, 4, -30);
    // Resize first border left
    await dragColumnBorder(page, 3, -20);

    const { tableWidth: finalWidth } = await getTableAndWrapperWidths(page);
    expect(Math.abs(finalWidth - initialWidth)).toBeLessThanOrEqual(1);

    // No scrollbar after all resizes
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('resize applies to all rows, not just the header', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize first column border right by 50px (using header cell, index 0)
    await dragColumnBorder(page, 0, 50);

    // Check widths in header row and both data rows
    const headerBoxes = await getRowCellBoxes(page, 0);
    const row1Boxes = await getRowCellBoxes(page, 1);
    const row2Boxes = await getRowCellBoxes(page, 2);

    // All rows should have consistent column widths
    for (let col = 0; col < 3; col++) {
      expect(Math.abs(headerBoxes[col]!.width - row1Boxes[col]!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(row1Boxes[col]!.width - row2Boxes[col]!.width)).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// Resize clamping (cellMinWidth enforcement)
// =============================================================================

test.describe('Table — Resize clamping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dragged column cannot be shrunk below minimum width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Try to drag first column border far to the left (shrink to near zero)
    await dragColumnBorder(page, 3, -500);

    const afterBoxes = await getRowCellBoxes(page, 1);
    // Column should be clamped to cellMinWidth (25px default)
    expect(afterBoxes[0]!.width).toBeGreaterThanOrEqual(25);
  });

  test('neighbor column cannot be shrunk below minimum width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Try to drag first column border far to the right (shrink neighbor to near zero)
    await dragColumnBorder(page, 3, 500);

    const afterBoxes = await getRowCellBoxes(page, 1);
    // Neighbor column should be clamped to cellMinWidth
    expect(afterBoxes[1]!.width).toBeGreaterThanOrEqual(25);
  });

  test('total width preserved even at clamp limits', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: initialWidth } = await getTableAndWrapperWidths(page);

    // Extreme drag that hits clamp
    await dragColumnBorder(page, 3, 500);

    const { tableWidth: afterWidth } = await getTableAndWrapperWidths(page);
    expect(Math.abs(afterWidth - initialWidth)).toBeLessThanOrEqual(1);
  });
});
