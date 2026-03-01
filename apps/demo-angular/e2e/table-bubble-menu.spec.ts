import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';

// Simple 3×3 table with text content in every cell
const TABLE_WITH_TEXT =
  '<table>' +
    '<tr><th>Header A</th><th>Header B</th><th>Header C</th></tr>' +
    '<tr><td>Cell one</td><td>Cell two</td><td>Cell three</td></tr>' +
    '<tr><td>Cell four</td><td>Cell five</td><td>Cell six</td></tr>' +
  '</table>';

// Table preceded by a paragraph (for testing transitions)
const TABLE_AFTER_PARAGRAPH =
  '<p>Some text before the table</p>' + TABLE_WITH_TEXT;

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

/** Select text within a specific cell (td or th) by index. */
async function selectTextInCell(page: Page, cellIndex: number, startOffset = 0, endOffset?: number) {
  await page.evaluate(
    ({ sel, idx, start, end }) => {
      const cells = document.querySelectorAll(sel + ' td, ' + sel + ' th');
      const cell = cells[idx];
      if (!cell) return;
      const p = cell.querySelector('p') || cell;
      const textNode = p.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end ?? (textNode as Text).length);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { sel: editorSelector, idx: cellIndex, start: startOffset, end: endOffset },
  );
  await page.waitForTimeout(200);
}

/** Place cursor in a cell without selecting text. */
async function placeCursorInCell(page: Page, cellIndex: number) {
  await page.evaluate(
    ({ sel, idx }) => {
      const cells = document.querySelectorAll(sel + ' td, ' + sel + ' th');
      const cell = cells[idx];
      if (!cell) return;
      const p = cell.querySelector('p') || cell;
      const textNode = p.firstChild;
      const range = document.createRange();
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        range.setStart(textNode, 0);
      } else {
        range.setStart(p, 0);
      }
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { sel: editorSelector, idx: cellIndex },
  );
  await page.waitForTimeout(150);
}

/** Create CellSelection for specified cell indices using ProseMirror doc traversal. */
async function createCellSelection(page: Page, anchorCellIndex: number, headCellIndex?: number) {
  await page.evaluate(
    ({ sel, anchorIdx, headIdx }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      const editor = comp?.editor;
      if (!editor) return;

      // Find cell positions by walking the doc
      const cellPositions: number[] = [];
      editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cellPositions.push(pos);
          return false; // don't descend into cells
        }
        return true;
      });

      const anchorPos = cellPositions[anchorIdx];
      const headPos = cellPositions[headIdx ?? anchorIdx];
      if (anchorPos == null || headPos == null) return;

      editor.commands.setCellSelection({ anchorCell: anchorPos, headCell: headPos });
    },
    { sel: editorSelector, anchorIdx: anchorCellIndex, headIdx: headCellIndex },
  );
  await page.waitForTimeout(200);
}

/** Check if the current selection is a CellSelection. */
async function isCellSelection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    const state = comp?.editor?.state;
    if (!state) return false;
    return '$anchorCell' in state.selection;
  });
}

/** Check if the current selection is a TextSelection. */
async function isTextSelection(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    const state = comp?.editor?.state;
    if (!state) return false;
    return !('$anchorCell' in state.selection) && !('node' in state.selection && state.selection.node);
  });
}

/** Check if bubble menu is visible (has data-show attribute). */
async function isBubbleMenuVisible(page: Page): Promise<boolean> {
  const menu = page.locator(bubbleMenu);
  return (await menu.getAttribute('data-show')) !== null;
}

/** Get bounding box of cell by index. */
async function getCellBox(page: Page, cellIndex: number) {
  const cells = page.locator(`${editorSelector} td, ${editorSelector} th`);
  return cells.nth(cellIndex).boundingBox();
}

// =============================================================================
// Bubble menu hides when selection changes from text to cell selection
// =============================================================================

test.describe('Table + Bubble menu — Selection transitions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bubble menu shows when text is selected in a cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3); // "Cell one"

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('bubble menu hides when cursor is placed in another cell (no text selection)', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3); // "Cell one" selected
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click in different cell — collapses selection
    await placeCursorInCell(page, 4); // "Cell two"
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('bubble menu hides when clicking into a different cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3); // select "Cell one"
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click inside "Cell two"
    const cellBox = await getCellBox(page, 4);
    if (!cellBox) return;
    await page.mouse.click(cellBox.x + cellBox.width / 2, cellBox.y + cellBox.height / 2);
    await page.waitForTimeout(200);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('bubble menu hides when CellSelection is created programmatically', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Create CellSelection via command
    await createCellSelection(page, 3);
    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('bubble menu stays hidden during CellSelection', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await createCellSelection(page, 0, 0);
    await page.waitForTimeout(200);

    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Drag from text selection to multi-cell selection
// =============================================================================

test.describe('Table + Bubble menu — Drag across cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('drag from one cell to another creates CellSelection and hides bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    const cell3 = await getCellBox(page, 3); // "Cell one"
    const cell4 = await getCellBox(page, 4); // "Cell two"
    if (!cell3 || !cell4) return;

    // Mousedown in cell3
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag to cell4 (cross cell boundary → CellSelection)
    await page.mouse.move(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2, { steps: 10 });
    await page.waitForTimeout(200);

    await page.mouse.up();
    await page.waitForTimeout(200);

    // Expect CellSelection
    expect(await isCellSelection(page)).toBe(true);
    // Bubble menu should be hidden
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('text selected in cell A, then drag from cell B to cell C hides bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Select text in cell 3 ("Cell one")
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Now drag from cell4 to cell5
    const cell4 = await getCellBox(page, 4);
    const cell5 = await getCellBox(page, 5);
    if (!cell4 || !cell5) return;

    await page.mouse.move(cell4.x + 10, cell4.y + cell4.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    await page.mouse.move(cell5.x + cell5.width / 2, cell5.y + cell5.height / 2, { steps: 10 });
    await page.waitForTimeout(200);

    await page.mouse.up();
    await page.waitForTimeout(200);

    // Bubble menu should be hidden
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('text selected, click bold in bubble menu, then drag across cells hides bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Select text in cell 3
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click bold button in bubble menu
    const boldBtn = page.locator(`${bubbleMenu} button[title="Bold"]`);
    await boldBtn.click();
    await page.waitForTimeout(100);

    // Bubble menu should still be visible (text still selected, now bold)
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Now drag from cell4 to cell5
    const cell4 = await getCellBox(page, 4);
    const cell5 = await getCellBox(page, 5);
    if (!cell4 || !cell5) return;

    await page.mouse.move(cell4.x + 10, cell4.y + cell4.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    await page.mouse.move(cell5.x + cell5.width / 2, cell5.y + cell5.height / 2, { steps: 10 });
    await page.waitForTimeout(200);

    await page.mouse.up();
    await page.waitForTimeout(200);

    // Bubble menu should be hidden
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('drag starting from same cell with text selected crosses to another cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Select text in cell 3 ("Cell one")
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Start drag FROM the same cell, extend to next cell
    const cell3 = await getCellBox(page, 3);
    const cell4 = await getCellBox(page, 4);
    if (!cell3 || !cell4) return;

    // Mousedown inside cell3
    await page.mouse.move(cell3.x + 5, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    // Drag to cell4 — cross-cell TextSelection
    await page.mouse.move(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2, { steps: 10 });
    await page.waitForTimeout(200);

    await page.mouse.up();
    await page.waitForTimeout(200);

    // Bubble menu must be hidden
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('continuous drag: start in cell, drag upward across multiple cells — bubble menu hidden', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Reproduces user scenario: mousedown in cell, drag upward across rows.
    // After release, cross-cell TextSelection → bubble menu must be hidden.
    const cell8 = await getCellBox(page, 8); // "Cell six" (bottom-right)
    const cell2 = await getCellBox(page, 2); // "Header C" (top-right)
    if (!cell8 || !cell2) return;

    // Mousedown in cell 8 and drag upward to cell 2
    await page.mouse.move(cell8.x + 10, cell8.y + cell8.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // After release, bubble menu must be hidden (cross-cell selection)
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('continuous drag: start in cell, drag downward across rows — bubble menu hidden', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    const cell3 = await getCellBox(page, 3); // "Cell one" (row 2, col 1)
    const cell6 = await getCellBox(page, 6); // "Cell four" (row 3, col 1)
    if (!cell3 || !cell6) return;

    // Mousedown in cell 3 and drag down to cell 6
    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell6.x + cell6.width / 2, cell6.y + cell6.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    // After release, bubble menu must be hidden (cross-cell selection)
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Cell handle interactions
// =============================================================================

test.describe('Table + Bubble menu — Cell handle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('cell handle visible when cursor is in a cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');
  });

  test('cell handle hidden when text is selected (bubble menu takes precedence)', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Place cursor first — cell handle should be visible
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);
    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');

    // Select text in cell 3 — bubble menu appears, cell handle hides
    await selectTextInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    // Cell handle should be hidden (non-empty selection → no cell handle)
    await expect(cellHandle).not.toHaveCSS('display', 'flex');
  });

  test('clicking cell handle with cursor creates CellSelection', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Place cursor in cell 3 — cell handle appears
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');

    // Click cell handle — should create CellSelection
    await cellHandle.click();
    await page.waitForTimeout(200);

    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('cell handle click creates CellSelection, bubble menu stays hidden', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');

    // Click cell handle to create CellSelection on cell 3
    await cellHandle.click();
    await page.waitForTimeout(200);
    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Focus/blur transitions with table
// =============================================================================

test.describe('Table + Bubble menu — Focus transitions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bubble menu hides when editor loses focus after text selection in cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_AFTER_PARAGRAPH);

    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click outside the editor
    await page.locator('h1').click();
    await page.waitForTimeout(200);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('text selected in cell, blur and refocus keeps bubble menu behavior consistent', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click outside to blur
    await page.locator('h1').click();
    await page.waitForTimeout(200);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Click back in the editor — selection is collapsed (cursor)
    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    // After clicking in a cell, selection is collapsed → no bubble menu
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Toolbar button + table cell drag interaction
// =============================================================================

test.describe('Table + Bubble menu — Toolbar interaction then drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('click toolbar button with text selected in cell, then drag across cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Select text in cell 3
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click the main toolbar bold button
    const toolbarBold = page.locator('domternal-toolbar button[aria-label="Bold"]');
    if (await toolbarBold.isVisible()) {
      await toolbarBold.click();
      await page.waitForTimeout(100);
    }

    // Now drag from cell4 to cell5
    const cell4 = await getCellBox(page, 4);
    const cell5 = await getCellBox(page, 5);
    if (!cell4 || !cell5) return;

    await page.mouse.move(cell4.x + 10, cell4.y + cell4.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell5.x + cell5.width / 2, cell5.y + cell5.height / 2, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Bubble menu must be hidden
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('CellSelection → click in cell → select text → bubble menu shows, then collapse → hides', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Create CellSelection programmatically
    await createCellSelection(page, 0, 1);
    await page.waitForTimeout(200);
    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Click inside a cell to get TextSelection
    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    // Cursor (TextSelection empty) — no bubble menu
    expect(await isTextSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Select text
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });
});

// =============================================================================
// Rapid transitions — stress tests for race conditions
// =============================================================================

test.describe('Table + Bubble menu — Rapid transitions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('rapid: select text → click different cell → no stale bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    for (let i = 0; i < 3; i++) {
      // Select text in cell 3
      await selectTextInCell(page, 3);
      await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

      // Immediately click in cell 4
      const cell4 = await getCellBox(page, 4);
      if (!cell4) return;
      await page.mouse.click(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2);
      await page.waitForTimeout(150);

      // Bubble menu should be hidden
      await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
    }
  });

  test('rapid: text select → CellSelection → text select → CellSelection', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Text selection → bubble menu visible
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // CellSelection → bubble menu hidden
    await createCellSelection(page, 0, 1);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Back to text selection → bubble menu visible
    await selectTextInCell(page, 4);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // CellSelection again → hidden
    await createCellSelection(page, 6, 8);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('cell handle hidden when text selected prevents overlap with bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Place cursor → cell handle visible, no bubble menu
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);
    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Select text → bubble menu visible, cell handle hidden
    await selectTextInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    await expect(cellHandle).not.toHaveCSS('display', 'flex');

    // Collapse selection → cell handle visible again, bubble menu hidden
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(cellHandle).toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Cell toolbar (CellSelection toolbar) doesn't conflict with bubble menu
// =============================================================================

test.describe('Table — Cell toolbar vs bubble menu coexistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('CellSelection shows cell toolbar, not bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Create CellSelection spanning two cells
    await createCellSelection(page, 0, 2);
    await page.waitForTimeout(300);

    // Cell toolbar should be visible
    const cellToolbar = page.locator('.dm-table-cell-toolbar');
    await expect(cellToolbar).toBeVisible();

    // Bubble menu should NOT be visible
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('transitioning from CellSelection to TextSelection hides cell toolbar, can show bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Create CellSelection
    await createCellSelection(page, 0, 2);
    await page.waitForTimeout(300);
    await expect(page.locator('.dm-table-cell-toolbar')).toBeVisible();

    // Click inside a cell to transition to TextSelection
    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(300);

    // Cell toolbar should be hidden
    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();
    // Bubble menu should be hidden (no text selected yet)
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Now select text — bubble menu should appear
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });
});
