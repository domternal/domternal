import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

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

/** Get bounding box of cell by index. */
async function getCellBox(page: Page, cellIndex: number) {
  const cells = page.locator(`${editorSelector} td, ${editorSelector} th`);
  return cells.nth(cellIndex).boundingBox();
}

/** Select text in paragraph outside table. */
async function selectTextInParagraph(page: Page) {
  await page.evaluate(
    (sel) => {
      const p = document.querySelector(sel + ' > p');
      if (!p) return;
      const textNode = p.firstChild;
      if (!textNode) return;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, (textNode as Text).length);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(sel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    editorSelector,
  );
  await page.waitForTimeout(200);
}

// =============================================================================
// Bubble menu context in table cells (demo has contexts.table = ['bold'])
// =============================================================================

test.describe('Table + Bubble menu — Table context items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bubble menu shows table-context items when text is selected in a table cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3); // "Cell one"

    // Demo has contexts.table = ['bold'], so bubble menu shows with bold only
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const buttons = page.locator(`${bubbleMenu} button`);
    await expect(buttons).toHaveCount(1);
    await expect(buttons.first()).toHaveAttribute('title', 'Bold');
  });

  test('bubble menu shows table-context items in header cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 0); // "Header A"

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const buttons = page.locator(`${bubbleMenu} button`);
    await expect(buttons).toHaveCount(1);
  });

  test('bubble menu shows text-context items for paragraph text', async ({ page }) => {
    await setContentAndFocus(page, TABLE_AFTER_PARAGRAPH);
    await selectTextInParagraph(page);

    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    // Text context has more items: bold, italic, underline, strike, code, |, link
    const buttons = page.locator(`${bubbleMenu} button`);
    const count = await buttons.count();
    expect(count).toBeGreaterThan(1);
  });

  test('bubble menu switches items when moving between paragraph and table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_AFTER_PARAGRAPH);

    // Paragraph — text context (multiple items)
    await selectTextInParagraph(page);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const textCount = await page.locator(`${bubbleMenu} button`).count();
    expect(textCount).toBeGreaterThan(1);

    // Table cell — table context (bold only)
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    await expect(page.locator(`${bubbleMenu} button`)).toHaveCount(1);
  });
});

// =============================================================================
// CellSelection hides bubble menu (no text selected → no bubble)
// =============================================================================

test.describe('Table + Bubble menu — CellSelection hides bubble menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bubble menu hides when CellSelection is created', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

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
// Drag across cells
// =============================================================================

test.describe('Table + Bubble menu — Drag across cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('drag from one cell to another creates CellSelection and hides bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    const cell3 = await getCellBox(page, 3);
    const cell4 = await getCellBox(page, 4);
    if (!cell3 || !cell4) return;

    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);

    await page.mouse.move(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2, { steps: 10 });
    await page.waitForTimeout(200);

    await page.mouse.up();
    await page.waitForTimeout(200);

    expect(await isCellSelection(page)).toBe(true);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('continuous drag upward across multiple cells — bubble menu hidden', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    const cell8 = await getCellBox(page, 8);
    const cell2 = await getCellBox(page, 2);
    if (!cell8 || !cell2) return;

    await page.mouse.move(cell8.x + 10, cell8.y + cell8.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell2.x + cell2.width / 2, cell2.y + cell2.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('continuous drag downward across rows — bubble menu hidden', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    const cell3 = await getCellBox(page, 3);
    const cell6 = await getCellBox(page, 6);
    if (!cell3 || !cell6) return;

    await page.mouse.move(cell3.x + 10, cell3.y + cell3.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell6.x + cell6.width / 2, cell6.y + cell6.height / 2, { steps: 10 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(300);

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

  test('cell handle hidden when text is selected in cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);
    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');

    // Select text — cell handle hides, bubble menu shows (table context)
    await selectTextInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(cellHandle).not.toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
  });

  test('clicking cell handle creates CellSelection, bubble menu hides', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');

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

  test('bubble menu shows for paragraph text, hides on blur, stays hidden on refocus into table cursor', async ({ page }) => {
    await setContentAndFocus(page, TABLE_AFTER_PARAGRAPH);

    await selectTextInParagraph(page);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Click outside to blur
    await page.locator('h1').click();
    await page.waitForTimeout(200);
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Click inside a table cell — cursor only, no bubble menu
    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(200);

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Cell toolbar vs bubble menu coexistence
// =============================================================================

test.describe('Table — Cell toolbar vs bubble menu coexistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('CellSelection shows cell toolbar, not bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    await createCellSelection(page, 0, 2);
    await page.waitForTimeout(300);

    const cellToolbar = page.locator('.dm-table-cell-toolbar');
    await expect(cellToolbar).toBeVisible();

    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('transitioning from CellSelection to cursor hides cell toolbar, no bubble menu', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    await createCellSelection(page, 0, 2);
    await page.waitForTimeout(300);
    await expect(page.locator('.dm-table-cell-toolbar')).toBeVisible();

    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(300);

    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });

  test('cell handle reappears after CellSelection collapses to cursor in cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    await createCellSelection(page, 3, 4);
    await page.waitForTimeout(200);
    expect(await isCellSelection(page)).toBe(true);

    const cell3 = await getCellBox(page, 3);
    if (!cell3) return;
    await page.mouse.click(cell3.x + cell3.width / 2, cell3.y + cell3.height / 2);
    await page.waitForTimeout(300);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});

// =============================================================================
// Rapid transitions
// =============================================================================

test.describe('Table + Bubble menu — Rapid transitions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('rapid: select text in cell → click different cell → bubble menu follows', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    for (let i = 0; i < 3; i++) {
      // Select text in cell 3 — bubble menu with table context
      await selectTextInCell(page, 3);
      await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

      // Click in cell 4 (cursor only) — bubble menu hides
      const cell4 = await getCellBox(page, 4);
      if (!cell4) return;
      await page.mouse.click(cell4.x + cell4.width / 2, cell4.y + cell4.height / 2);
      await page.waitForTimeout(150);

      await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
    }
  });

  test('rapid: paragraph text → table text → paragraph text', async ({ page }) => {
    await setContentAndFocus(page, TABLE_AFTER_PARAGRAPH);

    // Paragraph — text context
    await selectTextInParagraph(page);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const textCount = await page.locator(`${bubbleMenu} button`).count();

    // Table cell — table context (fewer items)
    await selectTextInCell(page, 3);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const tableCount = await page.locator(`${bubbleMenu} button`).count();
    expect(tableCount).toBeLessThan(textCount);

    // Back to paragraph — text context again
    await selectTextInParagraph(page);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');
    const textCount2 = await page.locator(`${bubbleMenu} button`).count();
    expect(textCount2).toBe(textCount);
  });

  test('cell handle hidden when text selected, visible when collapsed back to cursor', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_TEXT);

    // Cursor → cell handle visible
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(300);
    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');

    // Select text → cell handle hidden, bubble menu with table context
    await selectTextInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(cellHandle).not.toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).toHaveAttribute('data-show', '');

    // Collapse → cell handle visible again, bubble menu hidden
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(200);
    await expect(cellHandle).toHaveCSS('display', 'flex');
    await expect(page.locator(bubbleMenu)).not.toHaveAttribute('data-show');
  });
});
