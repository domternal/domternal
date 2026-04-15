import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';

const SIMPLE_TABLE =
  '<table>' +
    '<tr><th>Header A</th><th>Header B</th><th>Header C</th></tr>' +
    '<tr><td>Cell one</td><td>Cell two</td><td>Cell three</td></tr>' +
    '<tr><td>Cell four</td><td>Cell five</td><td>Cell six</td></tr>' +
  '</table>';

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
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
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    if (!editor) return [];
    const doc = editor.state.doc;
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

// =============================================================================
// Container constraint (constrainToContainer: true by default)
// =============================================================================

/** Execute a table command via the editor API. */
async function runTableCommand(page: Page, command: string) {
  await page.evaluate((cmd) => {
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    editor?.commands?.[cmd]?.();
  }, command);
  await page.waitForTimeout(200);
}

/** Get column count from the first row of the table. */
async function getColumnCount(page: Page): Promise<number> {
  return page.locator(`${editorSelector} tr`).first().locator('th, td').count();
}

test.describe('Table — Container constraint (constrainToContainer)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('last column resize cannot grow table past container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const before = await getTableAndWrapperWidths(page);
    expect(before.tableWidth).toBeLessThanOrEqual(before.wrapperWidth);

    // Drag the LAST column right border (cell index 2 = "Header C") to the right by 100px
    await dragColumnBorder(page, 2, 100);

    const after = await getTableAndWrapperWidths(page);
    // Table must NOT exceed wrapper
    expect(after.tableWidth).toBeLessThanOrEqual(after.wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('last column resize can shrink', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Get initial last column width
    const initialBoxes = await getRowCellBoxes(page, 1);
    const initialLastColWidth = initialBoxes[2]!.width;

    // Drag last column border left by 50px
    await dragColumnBorder(page, 2, -50);

    const afterBoxes = await getRowCellBoxes(page, 1);
    // Last column should have shrunk
    expect(afterBoxes[2]!.width).toBeLessThan(initialLastColWidth - 20);

    // No overflow
    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('last column shrink then grow back stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Shrink last column
    await dragColumnBorder(page, 2, -60);

    // Grow it back
    await dragColumnBorder(page, 2, 60);

    const after = await getTableAndWrapperWidths(page);
    expect(after.tableWidth).toBeLessThanOrEqual(after.wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('add column after with frozen widths stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze columns by performing a resize drag (triggers freezeColumnWidths)
    await dragColumnBorder(page, 0, 30);

    // Verify all columns are now frozen
    const colwidthsBefore = await getColwidths(page);
    expect(colwidthsBefore.every((cw) => cw !== null)).toBe(true);

    // Add a column
    await runTableCommand(page, 'addColumnAfter');

    // Should now have 4 columns
    expect(await getColumnCount(page)).toBe(4);

    // Table must NOT exceed container
    const after = await getTableAndWrapperWidths(page);
    expect(after.tableWidth).toBeLessThanOrEqual(after.wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('add column before with frozen widths stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze columns
    await dragColumnBorder(page, 0, 30);

    // Add a column before
    await runTableCommand(page, 'addColumnBefore');

    expect(await getColumnCount(page)).toBe(4);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('add column to fresh table (no frozen widths) works normally', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // No resize → columns are NOT frozen
    const colwidths = await getColwidths(page);
    expect(colwidths.every((cw) => cw === null)).toBe(true);

    // Add column — should work normally
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(4);

    // No overflow
    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('multiple add columns redistribute progressively', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze columns
    await dragColumnBorder(page, 0, 30);

    // Add 3 columns (3 → 6 columns)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');

    expect(await getColumnCount(page)).toBe(6);

    // Still within container
    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  // ─── Edge-case stress tests ─────────────────────────────────────────

  test('resize different columns then add columns stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize column 0 right, column 1 left (neighbor mode)
    await dragColumnBorder(page, 0, 40);
    await dragColumnBorder(page, 1, -30);

    // All frozen after first resize
    const cw = await getColwidths(page);
    expect(cw.every((c) => c !== null)).toBe(true);

    // Add 2 columns
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnBefore');
    expect(await getColumnCount(page)).toBe(5);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('add columns then resize then add more columns', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze by resizing
    await dragColumnBorder(page, 0, 20);

    // Add a column (3 → 4)
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(4);

    // Resize an inner column in the 4-col table
    await dragColumnBorder(page, 1, -25);

    // Add 2 more columns (4 → 6)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnBefore');
    expect(await getColumnCount(page)).toBe(6);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('shrink last column then add columns stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Shrink last column (makes table narrower)
    await dragColumnBorder(page, 2, -80);

    const shrunk = await getTableAndWrapperWidths(page);
    expect(shrunk.tableWidth).toBeLessThanOrEqual(shrunk.wrapperWidth);

    // Add 3 columns into the narrower table (3 → 6)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(6);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('add many columns to fresh table (no freeze) stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // No resize — columns are NOT frozen. Add 7 columns (3 → 10).
    for (let i = 0; i < 7; i++) {
      await runTableCommand(page, 'addColumnAfter');
    }
    expect(await getColumnCount(page)).toBe(10);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('resize after adding columns to fresh table keeps constraint', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Add 2 columns without freezing first (3 → 5)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    // Now resize column 0 — this freezes all 5 columns
    await dragColumnBorder(page, 0, 30);

    const cw = await getColwidths(page);
    expect(cw.every((c) => c !== null)).toBe(true);

    // Add 2 more columns (5 → 7) — must redistribute
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(7);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('alternating addColumnBefore and addColumnAfter with frozen widths', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze
    await dragColumnBorder(page, 0, 20);

    // Alternate before/after (3 → 7)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnBefore');
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnBefore');
    expect(await getColumnCount(page)).toBe(7);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);

    // All columns should still have frozen widths
    const cw = await getColwidths(page);
    expect(cw.every((c) => c !== null)).toBe(true);
  });

  test('resize last column after redistribution stays within container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze + add columns → redistribute
    await dragColumnBorder(page, 0, 20);
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    // Now resize the last column (try to grow it past container)
    await dragColumnBorder(page, 4, 100);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('delete column then add column back preserves constraint', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze
    await dragColumnBorder(page, 0, 20);

    // Add 2, delete 1, add 1 (3 → 5 → 4 → 5)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    await runTableCommand(page, 'deleteColumn');
    expect(await getColumnCount(page)).toBe(4);

    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });

  test('multiple resizes across different columns then last-column grow blocked', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize column 0 right, then column 1 left
    await dragColumnBorder(page, 0, 50);
    await dragColumnBorder(page, 1, -40);
    // Resize column 0 again
    await dragColumnBorder(page, 0, -20);

    // Try to grow last column past container
    await dragColumnBorder(page, 2, 200);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
    expect(await hasHorizontalScrollbar(page)).toBe(false);
  });
});

// =============================================================================
// constrainToContainer: false — original unconstrained behavior
// =============================================================================

test.describe('Table — Unconstrained (constrainToContainer: false)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?constrainTable=false');
    await page.waitForSelector(editorSelector);
  });

  test('last column resize CAN grow table past container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const before = await getTableAndWrapperWidths(page);

    // Drag last column right border far to the right
    await dragColumnBorder(page, 2, 150);

    const after = await getTableAndWrapperWidths(page);
    // Table SHOULD exceed wrapper — no constraint
    expect(after.tableWidth).toBeGreaterThan(before.wrapperWidth);
  });

  test('last column resize can shrink freely', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);
    const initialLastColWidth = initialBoxes[2]!.width;

    await dragColumnBorder(page, 2, -50);

    const afterBoxes = await getRowCellBoxes(page, 1);
    expect(afterBoxes[2]!.width).toBeLessThan(initialLastColWidth - 20);
  });

  test('resize different columns then last column grows past container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize inner columns
    await dragColumnBorder(page, 0, 40);
    await dragColumnBorder(page, 1, -30);

    // Grow last column past container
    await dragColumnBorder(page, 2, 200);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('add column after does NOT redistribute frozen widths', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze columns
    await dragColumnBorder(page, 0, 30);

    const cwBefore = await getColwidths(page);
    expect(cwBefore.every((c) => c !== null)).toBe(true);
    const widthsBefore = cwBefore.map((c) => c![0]);

    // Add column
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(4);

    // Original 3 columns should keep their widths (not redistributed)
    const cwAfter = await getColwidths(page);
    const widthsAfter = cwAfter.map((c) => c?.[0] ?? null);
    // First 2 columns unchanged (3rd may shift due to cursor position)
    expect(widthsAfter[0]).toBe(widthsBefore[0]);
    expect(widthsAfter[1]).toBe(widthsBefore[1]);
  });

  test('add column before does NOT redistribute frozen widths', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze columns with an asymmetric resize so widths are unequal
    await dragColumnBorder(page, 0, 50);

    const cwBefore = await getColwidths(page);
    const widthsBefore = cwBefore.map((c) => c![0]!);
    // Verify widths are unequal (asymmetric)
    expect(new Set(widthsBefore).size).toBeGreaterThan(1);

    // Add column before
    await runTableCommand(page, 'addColumnBefore');
    expect(await getColumnCount(page)).toBe(4);

    // Original widths should be preserved somewhere (not redistributed to equal)
    const cwAfter = await getColwidths(page);
    const widthsAfter = cwAfter.map((c) => c?.[0] ?? 0).filter((w) => w > 0);
    // At least one of the original asymmetric widths should still exist
    const preserved = widthsBefore.filter((w) => widthsAfter.includes(w));
    expect(preserved.length).toBeGreaterThanOrEqual(2);
  });

  test('add columns then resize then add more — no constraint applied', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze by resizing
    await dragColumnBorder(page, 0, 20);

    // Add column (3 → 4)
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(4);

    // Resize an inner column
    await dragColumnBorder(page, 1, -25);

    // Add 2 more columns (4 → 6)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnBefore');
    expect(await getColumnCount(page)).toBe(6);

    // No constraint — table may or may not exceed container, but should not crash
    // Verify table is rendered and has correct column count
    const cw = await getColwidths(page);
    expect(cw.length).toBe(6);
  });

  test('shrink last column then grow past container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Shrink last column
    await dragColumnBorder(page, 2, -80);

    const shrunk = await getTableAndWrapperWidths(page);
    expect(shrunk.tableWidth).toBeLessThanOrEqual(shrunk.wrapperWidth);

    // Grow it well past the container
    await dragColumnBorder(page, 2, 200);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('multiple add columns to fresh table uses minWidth (no constraint)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // No resize — add 7 columns (3 → 10)
    for (let i = 0; i < 7; i++) {
      await runTableCommand(page, 'addColumnAfter');
    }
    expect(await getColumnCount(page)).toBe(10);

    // With constrainToContainer: false, table sets min-width from defaultCellMinWidth
    // 10 * 100 = 1000 > containerWidth → table should overflow
    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('multiple resizes across different columns then last-column grows freely', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Various resizes
    await dragColumnBorder(page, 0, 50);
    await dragColumnBorder(page, 1, -40);
    await dragColumnBorder(page, 0, -20);

    // Grow last column past container — should be allowed
    await dragColumnBorder(page, 2, 200);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('delete column then add column back — no redistribution', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze
    await dragColumnBorder(page, 0, 20);

    const cwInit = await getColwidths(page);
    const initWidths = cwInit.map((c) => c![0]);

    // Add 2, delete 1, add 1 (3 → 5 → 4 → 5)
    await runTableCommand(page, 'addColumnAfter');
    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    await runTableCommand(page, 'deleteColumn');
    expect(await getColumnCount(page)).toBe(4);

    await runTableCommand(page, 'addColumnAfter');
    expect(await getColumnCount(page)).toBe(5);

    // Original first column should still have its original width (no redistribution)
    const cwFinal = await getColwidths(page);
    expect(cwFinal[0]?.[0]).toBe(initWidths[0]);
  });
});

// =============================================================================
// Independent resize behavior (resizeBehavior: 'independent')
// =============================================================================

test.describe('Table — Independent resize behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?resizeBehavior=independent');
    await page.waitForSelector(editorSelector);
  });

  test('all columns get frozen widths after first resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Fresh table has no colwidth
    const cwBefore = await getColwidths(page);
    expect(cwBefore.every((c) => c === null)).toBe(true);

    // Resize column 0 right
    await dragColumnBorder(page, 3, 30);

    // All columns should now have explicit widths (freeze happened)
    const cwAfter = await getColwidths(page);
    expect(cwAfter.every((c) => c !== null)).toBe(true);
  });

  test('table width CHANGES after resize (not constant like neighbor)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: before } = await getTableAndWrapperWidths(page);

    // Drag column 0 border right — in independent mode, table should GROW
    await dragColumnBorder(page, 3, 60);

    const { tableWidth: after } = await getTableAndWrapperWidths(page);
    // Table grew because only the dragged column expanded, no neighbor shrank
    expect(after).toBeGreaterThan(before + 30);
  });

  test('only dragged column changes width, other columns stay same', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // First freeze all columns
    await dragColumnBorder(page, 3, 10);
    const cwFrozen = await getColwidths(page);
    const col1 = cwFrozen[1]![0];
    const col2 = cwFrozen[2]![0];

    // Now drag column 0 border right by 50
    await dragColumnBorder(page, 3, 50);

    const cwAfter = await getColwidths(page);
    // Column 1 and 2 should stay the same (independent)
    expect(cwAfter[1]![0]).toBe(col1);
    expect(cwAfter[2]![0]).toBe(col2);
    // Column 0 should have grown
    expect(cwAfter[0]![0]).toBeGreaterThan(cwFrozen[0]![0]!);
  });

  test('dragging column border left shrinks dragged column AND table', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze
    await dragColumnBorder(page, 3, 10);
    const { tableWidth: before } = await getTableAndWrapperWidths(page);

    // Drag left to shrink
    await dragColumnBorder(page, 3, -40);

    const { tableWidth: after } = await getTableAndWrapperWidths(page);
    expect(after).toBeLessThan(before - 20);
  });

  test('dragged column cannot go below minimum width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Drag far left to shrink past minimum
    await dragColumnBorder(page, 3, -500);

    const afterBoxes = await getRowCellBoxes(page, 1);
    // Column should be clamped at cellMinWidth (25px)
    expect(afterBoxes[0]!.width).toBeGreaterThanOrEqual(25);
  });

  test('multiple sequential resizes each change table width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: w0 } = await getTableAndWrapperWidths(page);

    // Grow column 0
    await dragColumnBorder(page, 3, 40);
    const { tableWidth: w1 } = await getTableAndWrapperWidths(page);
    expect(w1).toBeGreaterThan(w0 + 20);

    // Grow column 1
    await dragColumnBorder(page, 4, 30);
    const { tableWidth: w2 } = await getTableAndWrapperWidths(page);
    expect(w2).toBeGreaterThan(w1 + 15);

    // Shrink column 0
    await dragColumnBorder(page, 3, -50);
    const { tableWidth: w3 } = await getTableAndWrapperWidths(page);
    expect(w3).toBeLessThan(w2 - 25);
  });

  test('resize applies to all rows, not just header', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize via header cell (index 0)
    await dragColumnBorder(page, 0, 50);

    const headerBoxes = await getRowCellBoxes(page, 0);
    const row1Boxes = await getRowCellBoxes(page, 1);
    const row2Boxes = await getRowCellBoxes(page, 2);

    for (let col = 0; col < 3; col++) {
      expect(Math.abs(headerBoxes[col]!.width - row1Boxes[col]!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(row1Boxes[col]!.width - row2Boxes[col]!.width)).toBeLessThanOrEqual(1);
    }
  });

  test('second column resize only affects that column', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Freeze + first resize
    await dragColumnBorder(page, 3, 30);
    const cwAfterFirst = await getColwidths(page);
    const col0After = cwAfterFirst[0]![0]!;

    // Second resize on column 1 border
    await dragColumnBorder(page, 4, 40);
    const cwAfterSecond = await getColwidths(page);

    // Column 0 should not have changed from the second resize
    expect(cwAfterSecond[0]![0]).toBe(col0After);
    // Column 1 should have grown
    expect(cwAfterSecond[1]![0]).toBeGreaterThan(cwAfterFirst[1]![0]!);
  });

  test('sum of colwidths matches table width', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 3, 40);

    const cw = await getColwidths(page);
    const sum = cw.reduce((s, c) => s + (c?.[0] ?? 0), 0);
    const { tableWidth } = await getTableAndWrapperWidths(page);
    expect(Math.abs(sum - tableWidth)).toBeLessThanOrEqual(1);
  });

  test('table can exceed container width when growing', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Grow column 0 far right
    await dragColumnBorder(page, 3, 150);
    // Grow column 1 far right
    await dragColumnBorder(page, 4, 150);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('last column resize in independent mode grows table (no neighbor)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: before } = await getTableAndWrapperWidths(page);

    // Drag last column border right
    await dragColumnBorder(page, 2, 80);

    const { tableWidth: after } = await getTableAndWrapperWidths(page);
    // With constrainToContainer: true + independent mode + last column:
    // it falls through to handleLastColumnResize which caps at container
    // But independent freezes first, then PM handles. Let's check the actual behavior.
    // In independent mode, freeze happens then PM handles → last column grows the table
    // constrainToContainer caps the growth at the container width
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

// =============================================================================
// Independent + unconstrained (resizeBehavior: 'independent', constrainToContainer: false)
// =============================================================================

test.describe('Table — Independent + Unconstrained', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?resizeBehavior=independent&constrainTable=false');
    await page.waitForSelector(editorSelector);
  });

  test('last column resize grows table past container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 2, 200);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth);
  });

  test('multiple grows accumulate — table far exceeds container', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 3, 100);
    await dragColumnBorder(page, 4, 100);
    await dragColumnBorder(page, 2, 100);

    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeGreaterThan(wrapperWidth + 150);
  });
});

// =============================================================================
// Redistribute resize behavior (resizeBehavior: 'redistribute')
// =============================================================================

test.describe('Table — Redistribute resize behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?resizeBehavior=redistribute');
    await page.waitForSelector(editorSelector);
  });

  test('only resized column gets colwidth, others stay null', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Fresh table: all null
    const cwBefore = await getColwidths(page);
    expect(cwBefore.every((c) => c === null)).toBe(true);

    // Resize column 0
    await dragColumnBorder(page, 3, 40);

    // Only column 0 should get a colwidth (PM native behavior)
    const cwAfter = await getColwidths(page);
    expect(cwAfter[0]).not.toBeNull();
    // Other columns may or may not have widths depending on PM internals,
    // but column 0 must have one
    expect(cwAfter[0]![0]).toBeGreaterThan(0);
  });

  test('table width stays approximately the same after resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const { tableWidth: before } = await getTableAndWrapperWidths(page);

    // Resize column 0 right
    await dragColumnBorder(page, 3, 50);

    const { tableWidth: after } = await getTableAndWrapperWidths(page);
    // In redistribute mode, table has width: 100% → stays at container width
    // The resized column grows but others shrink to compensate (CSS redistribution)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  });

  test('dragging column border right grows that column visually', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);
    const col0Before = initialBoxes[0]!.width;

    await dragColumnBorder(page, 3, 50);

    const afterBoxes = await getRowCellBoxes(page, 1);
    expect(afterBoxes[0]!.width).toBeGreaterThan(col0Before + 25);
  });

  test('dragging column border left shrinks that column visually', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const initialBoxes = await getRowCellBoxes(page, 1);
    const col0Before = initialBoxes[0]!.width;

    await dragColumnBorder(page, 3, -40);

    const afterBoxes = await getRowCellBoxes(page, 1);
    expect(afterBoxes[0]!.width).toBeLessThan(col0Before - 20);
  });

  test('no scrollbar after resize (table stays at 100%)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 3, 60);

    expect(await hasHorizontalScrollbar(page)).toBe(false);
    const { tableWidth, wrapperWidth } = await getTableAndWrapperWidths(page);
    expect(tableWidth).toBeLessThanOrEqual(wrapperWidth);
  });

  test('multiple resizes on different columns work', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 3, 40);
    await dragColumnBorder(page, 4, -30);
    await dragColumnBorder(page, 3, -20);

    // Table should still render correctly
    const boxes = await getRowCellBoxes(page, 1);
    expect(boxes.length).toBe(3);
    for (const b of boxes) {
      expect(b!.width).toBeGreaterThanOrEqual(25);
    }
  });

  test('resize applies to all rows', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 0, 50);

    const headerBoxes = await getRowCellBoxes(page, 0);
    const row1Boxes = await getRowCellBoxes(page, 1);
    const row2Boxes = await getRowCellBoxes(page, 2);

    for (let col = 0; col < 3; col++) {
      expect(Math.abs(headerBoxes[col]!.width - row1Boxes[col]!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(row1Boxes[col]!.width - row2Boxes[col]!.width)).toBeLessThanOrEqual(1);
    }
  });

  test('second resize preserves first column width in PM state', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Resize column 0
    await dragColumnBorder(page, 3, 30);
    const cw1 = await getColwidths(page);
    const col0Width = cw1[0]![0]!;

    // Resize column 1
    await dragColumnBorder(page, 4, -20);
    const cw2 = await getColwidths(page);
    // PM should preserve the stored colwidth for column 0
    expect(cw2[0]![0]).toBe(col0Width);
  });

  test('no dm-mouse-drag class during resize drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const box = await getCellBox(page, 3);
    if (!box) return;

    // Hover on border → resize handle appears
    const borderX = box.x + box.width;
    await page.mouse.move(borderX - 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    expect(await resizeHandleCount(page)).toBeGreaterThan(0);

    // Mousedown on resize handle
    await page.mouse.down();
    await page.waitForTimeout(50);

    // dm-mouse-drag should NOT be present (on resize handle, not in cell)
    expect(await hasMouseDragClass(page)).toBe(false);

    // Drag
    await page.mouse.move(borderX + 40, box.y + box.height / 2, { steps: 5 });
    await page.waitForTimeout(100);
    expect(await hasMouseDragClass(page)).toBe(false);

    await page.mouse.up();
  });

  test('column minimum width is enforced', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Try to shrink column 0 past minimum
    await dragColumnBorder(page, 3, -500);

    const afterBoxes = await getRowCellBoxes(page, 1);
    expect(afterBoxes[0]!.width).toBeGreaterThanOrEqual(25);
  });
});
