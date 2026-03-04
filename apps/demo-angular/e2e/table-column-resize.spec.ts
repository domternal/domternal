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
