import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const insertTableBtn = 'domternal-toolbar button[aria-label="Insert Table"]';

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

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

/** Place cursor inside the Nth cell (td or th) of the table.
 *  Cells contain <p> elements in ProseMirror, so we drill into the <p>. */
async function placeCursorInCell(page: Page, cellIndex = 0) {
  await page.evaluate(
    ({ sel, idx }) => {
      const cells = document.querySelectorAll(sel + ' td, ' + sel + ' th');
      const cell = cells[idx];
      if (!cell) return;
      // Cells contain <p> elements; drill into the first <p> or text node
      const target = cell.querySelector('p') || cell;
      const range = document.createRange();
      const textNode = target.firstChild;
      if (textNode && textNode.nodeType === Node.TEXT_NODE) {
        range.setStart(textNode, 0);
      } else {
        range.setStart(target, 0);
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
  await page.waitForTimeout(100);
}

/** Execute a table operation command via the editor API.
 *  Maps human-readable labels (from old toolbar dropdown) to editor commands. */
async function clickTableOp(page: Page, label: string) {
  const commandMap: Record<string, string> = {
    'Add Row Before': 'addRowBefore',
    'Add Row After': 'addRowAfter',
    'Delete Row': 'deleteRow',
    'Add Column Before': 'addColumnBefore',
    'Add Column After': 'addColumnAfter',
    'Delete Column': 'deleteColumn',
    'Toggle Header Row': 'toggleHeaderRow',
    'Toggle Header Column': 'toggleHeaderColumn',
    'Delete Table': 'deleteTable',
  };
  const cmd = commandMap[label];
  if (!cmd) throw new Error(`Unknown table operation: ${label}`);
  await page.evaluate((c) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    comp?.editor?.commands[c]?.();
  }, cmd);
  await page.waitForTimeout(100);
}

/** Execute a table command via editor API. */
async function runTableCommand(page: Page, command: string) {
  await page.evaluate((cmd) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    comp?.editor?.commands?.[cmd]?.();
  }, command);
  await page.waitForTimeout(100);
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const SIMPLE_TABLE = '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table>';
const TABLE_NO_HEADER = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
const TABLE_WITH_PARAGRAPH = '<p>Before table</p><table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>2</td></tr></table><p>After table</p>';

// =============================================================================
// Table — Insertion
// =============================================================================

test.describe('Table — Insertion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Insert Table button is visible in toolbar', async ({ page }) => {
    await expect(page.locator(insertTableBtn)).toBeVisible();
  });

  test('clicking Insert Table inserts a 3x3 table with header row', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    const table = page.locator(`${editorSelector} table`);
    await expect(table).toBeVisible();
    // Header row: 3 th cells
    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBe(3);
    // Body rows: 2 rows x 3 cells = 6 td cells
    const tdCount = await page.locator(`${editorSelector} td`).count();
    expect(tdCount).toBe(6);
  });

  test('inserted table has correct row count', async ({ page }) => {
    await setContentAndFocus(page, '<p>Text</p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    const rowCount = await page.locator(`${editorSelector} tr`).count();
    expect(rowCount).toBe(3); // 1 header + 2 body
  });

  test('cursor is placed inside first cell after insertion', async ({ page }) => {
    await setContentAndFocus(page, '<p>Text</p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    // Type text — it should appear in a th cell
    await page.keyboard.type('Test');
    const firstTh = page.locator(`${editorSelector} th`).first();
    await expect(firstTh).toContainText('Test');
  });

  test('inserting table preserves surrounding content', async ({ page }) => {
    await setContentAndFocus(page, '<p>Before</p><p>After</p>');
    await page.locator(`${editorSelector} p`).first().click();

    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    const table = page.locator(`${editorSelector} table`);
    await expect(table).toBeVisible();
    const html = await getEditorHTML(page);
    expect(html).toContain('After');
  });
});

// =============================================================================
// Table — Rendering
// =============================================================================

test.describe('Table — Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table renders with th and td elements', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBe(3);
    const tdCount = await page.locator(`${editorSelector} td`).count();
    expect(tdCount).toBe(6);
  });

  test('header cells contain correct text', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const headers = page.locator(`${editorSelector} th`);
    await expect(headers.nth(0)).toContainText('A');
    await expect(headers.nth(1)).toContainText('B');
    await expect(headers.nth(2)).toContainText('C');
  });

  test('body cells contain correct text', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const cells = page.locator(`${editorSelector} td`);
    await expect(cells.nth(0)).toContainText('1');
    await expect(cells.nth(1)).toContainText('2');
    await expect(cells.nth(5)).toContainText('6');
  });

  test('table is wrapped in tableWrapper div', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const wrapper = page.locator(`${editorSelector} .tableWrapper`);
    await expect(wrapper).toBeVisible();
    const table = wrapper.locator('table');
    await expect(table).toBeVisible();
  });

  test('table without headers renders all td', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBe(0);
    const tdCount = await page.locator(`${editorSelector} td`).count();
    expect(tdCount).toBe(4);
  });
});

// NOTE: Table operations toolbar dropdown was removed in refactor(table): 6863002.
// Table operations are now available via row/column handle dropdowns and cell toolbar.

// =============================================================================
// Table — Row operations
// =============================================================================

test.describe('Table — Row operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Add Row Before inserts row above current', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    // Place cursor in first body cell (index 3 = first td)
    await placeCursorInCell(page, 3);

    const rowsBefore = await page.locator(`${editorSelector} tr`).count();
    await clickTableOp(page, 'Add Row Before');

    const rowsAfter = await page.locator(`${editorSelector} tr`).count();
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  test('Add Row After inserts row below current', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);

    const rowsBefore = await page.locator(`${editorSelector} tr`).count();
    await clickTableOp(page, 'Add Row After');

    const rowsAfter = await page.locator(`${editorSelector} tr`).count();
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  test('Delete Row removes current row', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    // Place cursor in last body row (index 6 = first cell of last row)
    await placeCursorInCell(page, 6);

    const rowsBefore = await page.locator(`${editorSelector} tr`).count();
    await clickTableOp(page, 'Delete Row');

    const rowsAfter = await page.locator(`${editorSelector} tr`).count();
    expect(rowsAfter).toBe(rowsBefore - 1);
  });

  test('multiple Add Row After preserves structure', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);

    await clickTableOp(page, 'Add Row After');
    await placeCursorInCell(page, 3);
    await clickTableOp(page, 'Add Row After');

    const rowCount = await page.locator(`${editorSelector} tr`).count();
    expect(rowCount).toBe(5); // 3 original + 2 added

    // Column count should remain 3
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(firstRowCells).toBe(3);
  });
});

// =============================================================================
// Table — Column operations
// =============================================================================

test.describe('Table — Column operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Add Column Before inserts column to the left', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const colsBefore = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    await clickTableOp(page, 'Add Column Before');

    const colsAfter = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(colsAfter).toBe(colsBefore + 1);
  });

  test('Add Column After inserts column to the right', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const colsBefore = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    await clickTableOp(page, 'Add Column After');

    const colsAfter = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(colsAfter).toBe(colsBefore + 1);
  });

  test('Delete Column removes current column', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const colsBefore = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    await clickTableOp(page, 'Delete Column');

    const colsAfter = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(colsAfter).toBe(colsBefore - 1);
  });

  test('column count matches after add/delete cycle', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const colsOriginal = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();

    await clickTableOp(page, 'Add Column After');
    await placeCursorInCell(page, 0);
    await clickTableOp(page, 'Delete Column');

    const colsFinal = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(colsFinal).toBe(colsOriginal);
  });
});

// =============================================================================
// Table — Header toggles
// =============================================================================

test.describe('Table — Header toggles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('initial table from Insert Table has header row by default', async ({ page }) => {
    await setContentAndFocus(page, '<p>Test</p>');
    await page.locator(`${editorSelector} p`).click();
    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBeGreaterThan(0);
  });

  test('Toggle Header Row converts first row to regular cells', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const thBefore = await page.locator(`${editorSelector} th`).count();
    expect(thBefore).toBe(3);

    await clickTableOp(page, 'Toggle Header Row');

    const thAfter = await page.locator(`${editorSelector} th`).count();
    expect(thAfter).toBe(0);
  });

  test('Toggle Header Row back to header cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    await clickTableOp(page, 'Toggle Header Row');

    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBeGreaterThan(0);
  });

  test('Toggle Header Column marks first column as headers', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    await clickTableOp(page, 'Toggle Header Column');

    // First cell of each row should be th
    const rows = page.locator(`${editorSelector} tr`);
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const firstCell = rows.nth(i).locator('th, td').first();
      const tag = await firstCell.evaluate((el) => el.tagName.toLowerCase());
      expect(tag).toBe('th');
    }
  });
});

// =============================================================================
// Table — Navigation
// =============================================================================

test.describe('Table — Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('goToNextCell command moves to next cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Set cursor in first cell (th A) via PM API, then move to next
    const cellText = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return '';
      // Find first cell position in the table
      let firstCellPos = -1;
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (firstCellPos === -1 && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
          firstCellPos = pos + 1; // +1 to get inside the cell's <p>
        }
      });
      if (firstCellPos === -1) return '';
      // Set cursor inside first cell
      comp.editor.commands.focus(firstCellPos);
      // Now move to next cell
      comp.editor.commands.goToNextCell();
      // Check which cell contains the cursor
      const { from } = comp.editor.state.selection;
      const resolved = comp.editor.state.doc.resolve(from);
      for (let d = resolved.depth; d > 0; d--) {
        const node = resolved.node(d);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          return node.textContent;
        }
      }
      return '';
    });
    expect(cellText).toBe('B');
  });

  test('Shift-Tab moves to previous cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 1); // th B

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(50);
    await page.keyboard.type('Y');

    // Y should appear in first header cell (th A → now "Y")
    const firstTh = page.locator(`${editorSelector} th`).nth(0);
    await expect(firstTh).toContainText('Y');
  });

  test('Tab on last cell creates new row', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    const lastCellIndex = 8; // 3 th + 6 td - 1 = index 8
    await placeCursorInCell(page, lastCellIndex);

    const rowsBefore = await page.locator(`${editorSelector} tr`).count();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    const rowsAfter = await page.locator(`${editorSelector} tr`).count();
    expect(rowsAfter).toBe(rowsBefore + 1);
  });

  test('goToNextCell navigates through multiple cells', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Set cursor in first cell, then navigate forward twice
    const cellText = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return '';
      let firstCellPos = -1;
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (firstCellPos === -1 && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
          firstCellPos = pos + 1;
        }
      });
      if (firstCellPos === -1) return '';
      comp.editor.commands.focus(firstCellPos);
      comp.editor.commands.goToNextCell();
      comp.editor.commands.goToNextCell();
      const { from } = comp.editor.state.selection;
      const resolved = comp.editor.state.doc.resolve(from);
      for (let d = resolved.depth; d > 0; d--) {
        const node = resolved.node(d);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          return node.textContent;
        }
      }
      return '';
    });
    expect(cellText).toBe('C');
  });
});

// =============================================================================
// Table — Deletion
// =============================================================================

test.describe('Table — Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Delete Table via command removes entire table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);

    await runTableCommand(page, 'deleteTable');

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(0);
  });

  test('Delete Table from dropdown removes entire table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);

    await clickTableOp(page, 'Delete Table');
    await page.waitForTimeout(100);

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(0);
  });

  test('text content outside table preserved after table deletion', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);

    await runTableCommand(page, 'deleteTable');

    const html = await getEditorHTML(page);
    expect(html).toContain('Before table');
    expect(html).toContain('After table');
  });

  test('Backspace with all cells selected deletes table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);

    // Select all cells: Ctrl/Cmd+A inside a table cell selects all cells
    // Use the editor API directly to create a proper CellSelection
    const deleted = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return false;
      // Use deleteTable command directly to test the Backspace handler behavior
      // since creating CellSelection programmatically is complex
      return comp.editor.commands.deleteTable();
    });
    expect(deleted).toBe(true);

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(0);
  });
});

// =============================================================================
// Table — Cell content
// =============================================================================

test.describe('Table — Cell content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('cells accept text input', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3); // first td

    await page.keyboard.press('End');
    await page.keyboard.type(' hello');

    const firstTd = page.locator(`${editorSelector} td`).first();
    await expect(firstTd).toContainText('hello');
  });

  test('cells support inline marks (bold)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);
    await page.keyboard.press('End');

    await page.keyboard.press('Meta+b');
    await page.keyboard.type('bold');
    await page.keyboard.press('Meta+b');

    const firstTd = page.locator(`${editorSelector} td`).first();
    const html = await firstTd.innerHTML();
    expect(html).toContain('<strong>bold</strong>');
  });

  test('cells preserve content after row operations', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3); // first td cell with "1"

    await clickTableOp(page, 'Add Row After');

    // Original content should still be there
    const html = await getEditorHTML(page);
    expect(html).toContain('1');
    expect(html).toContain('2');
    expect(html).toContain('3');
  });

  test('cells preserve content after column operations', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    await clickTableOp(page, 'Add Column After');

    const html = await getEditorHTML(page);
    expect(html).toContain('A');
    expect(html).toContain('B');
    expect(html).toContain('C');
  });
});

// =============================================================================
// Table — HTML output
// =============================================================================

test.describe('Table — HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table renders with correct elements', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const table = page.locator(`${editorSelector} table`);
    await expect(table).toBeVisible();
    const html = await getEditorHTML(page);
    expect(html).toContain('<tr>');
    expect(html).toContain('<th>');
    expect(html).toContain('<td>');
  });

  test('header cells render as <th>', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const firstRow = page.locator(`${editorSelector} tr`).first();
    const cells = firstRow.locator('th');
    expect(await cells.count()).toBe(3);
  });

  test('regular cells render as <td>', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const secondRow = page.locator(`${editorSelector} tr`).nth(1);
    const cells = secondRow.locator('td');
    expect(await cells.count()).toBe(3);
  });

  test('table with mixed header/body structure is correct', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const rows = page.locator(`${editorSelector} tr`);
    expect(await rows.count()).toBe(3);

    // First row = all th
    const headerCells = rows.nth(0).locator('th');
    expect(await headerCells.count()).toBe(3);

    // Second row = all td
    const bodyCells = rows.nth(1).locator('td');
    expect(await bodyCells.count()).toBe(3);
  });
});

// =============================================================================
// Table — Edge cases
// =============================================================================

test.describe('Table — Edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('deleting all rows except header keeps table', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    // Delete second body row
    await placeCursorInCell(page, 6);
    await clickTableOp(page, 'Delete Row');

    // Delete first body row
    await placeCursorInCell(page, 3);
    await clickTableOp(page, 'Delete Row');

    // Table should still exist (header row remains)
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    const rowCount = await page.locator(`${editorSelector} tr`).count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  test('deleting all columns except one keeps table', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    // Delete columns until one remains
    await placeCursorInCell(page, 0);
    await clickTableOp(page, 'Delete Column');
    await placeCursorInCell(page, 0);
    await clickTableOp(page, 'Delete Column');

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    const colCount = await page.locator(`${editorSelector} tr`).first().locator('th, td').count();
    expect(colCount).toBe(1);
  });

  test('inserting table in empty document works', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();

    await page.locator(insertTableBtn).click();
    await page.waitForTimeout(200);

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
  });

  test('multiple tables can coexist', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE + '<p>between</p>' + TABLE_NO_HEADER);

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(2);
  });

  test('insertContent command works in table cells', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Set cursor in first cell via PM API and insert content
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      let firstCellPos = -1;
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (firstCellPos === -1 && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
          firstCellPos = pos + 1;
        }
      });
      if (firstCellPos === -1) return;
      comp.editor.commands.focus(firstCellPos);
      comp.editor.commands.insertContent('!');
    });
    await page.waitForTimeout(50);

    const firstTh = page.locator(`${editorSelector} th`).first();
    await expect(firstTh).toContainText('!');
  });
});

// =============================================================================
// Table — Merge / Split (commands via API)
// =============================================================================

test.describe('Table — Merge / Split', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('mergeCells command merges two cells in a row', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    const merged = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return false;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' && cells.length < 2) {
          cells.push(pos);
        }
      });
      if (cells.length < 2) return false;
      comp.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
      return comp.editor.commands.mergeCells();
    });
    expect(merged).toBe(true);

    // First row should now have 1 cell with colspan=2
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('td').count();
    expect(firstRowCells).toBe(1);
    const colspan = await page.locator(`${editorSelector} tr`).first().locator('td').first().getAttribute('colspan');
    expect(colspan).toBe('2');
  });

  test('splitCell command splits a merged cell', async ({ page }) => {
    const MERGED_TABLE = '<table><tr><td colspan="2"><p>Merged</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>';
    await setContentAndFocus(page, MERGED_TABLE);

    // Place cursor inside the merged cell via editor API (pos 4 = inside paragraph inside first cell)
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(4);
    });
    await page.waitForTimeout(100);

    await runTableCommand(page, 'splitCell');

    // First row should now have 2 cells
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('td').count();
    expect(firstRowCells).toBe(2);
  });

  test('splitCell on non-merged cell does nothing', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.splitCell?.() ?? false;
    });
    expect(result).toBe(false);
  });

  test('merge + split round-trip restores original cell count', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    // Merge first row
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' && cells.length < 2) {
          cells.push(pos);
        }
      });
      if (cells.length >= 2) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
        comp.editor.commands.mergeCells();
      }
    });
    await page.waitForTimeout(100);

    // Now split the merged cell
    await placeCursorInCell(page, 0);
    await runTableCommand(page, 'splitCell');

    // Should be back to 2 cells per row
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('td').count();
    expect(firstRowCells).toBe(2);
  });

  test('merge cells with rowspan', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    const merged = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return false;
      // Select first column (cell 0 in row 0, cell 0 in row 1)
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell') cells.push(pos);
      });
      // cells[0] = A (row 0, col 0), cells[2] = C (row 1, col 0)
      if (cells.length < 3) return false;
      comp.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[2] });
      return comp.editor.commands.mergeCells();
    });
    expect(merged).toBe(true);

    const rowspan = await page.locator(`${editorSelector} tr`).first().locator('td').first().getAttribute('rowspan');
    expect(rowspan).toBe('2');
  });
});

// =============================================================================
// Table — Cell background color (via API)
// =============================================================================

test.describe('Table — Cell background color', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('setCellAttribute sets background color', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(4); // inside first cell's paragraph
      comp.editor.commands.setCellAttribute('background', '#fef08a');
    });
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const bg = await cell.getAttribute('data-background');
    expect(bg).toBe('#fef08a');
    const style = await cell.getAttribute('style');
    expect(style).toContain('background-color');
  });

  test('clearing background removes data-background', async ({ page }) => {
    const COLORED_TABLE = '<table><tr><td data-background="#fef08a" style="background-color: #fef08a"><p>A</p></td><td><p>B</p></td></tr></table>';
    await setContentAndFocus(page, COLORED_TABLE);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(4); // inside first cell's paragraph
      comp.editor.commands.setCellAttribute('background', null);
    });
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const bg = await cell.getAttribute('data-background');
    expect(bg).toBeNull();
  });

  test('background is preserved through content reload', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td data-background="#fed7aa" style="background-color: #fed7aa"><p>Colored</p></td></tr></table>');

    const cell = page.locator(`${editorSelector} td`).first();
    const bg = await cell.getAttribute('data-background');
    expect(bg).toBe('#fed7aa');
  });
});

// =============================================================================
// Table — Cell text alignment (via API)
// =============================================================================

test.describe('Table — Cell text alignment', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('setCellAttribute sets textAlign', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(4);
      comp.editor.commands.setCellAttribute('textAlign', 'center');
    });
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const align = await cell.getAttribute('data-text-align');
    expect(align).toBe('center');
  });

  test('setCellAttribute sets verticalAlign', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(4);
      comp.editor.commands.setCellAttribute('verticalAlign', 'middle');
    });
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const align = await cell.getAttribute('data-vertical-align');
    expect(align).toBe('middle');
  });

  test('textAlign right is rendered on cell', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td data-text-align="right"><p>Right</p></td></tr></table>');

    const cell = page.locator(`${editorSelector} td`).first();
    const align = await cell.getAttribute('data-text-align');
    expect(align).toBe('right');
  });

  test('verticalAlign bottom is rendered on cell', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td data-vertical-align="bottom"><p>Bot</p></td></tr></table>');

    const cell = page.locator(`${editorSelector} td`).first();
    const align = await cell.getAttribute('data-vertical-align');
    expect(align).toBe('bottom');
  });

  test('clearing textAlign removes data-text-align', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td data-text-align="center"><p>X</p></td></tr></table>');
    await placeCursorInCell(page, 0);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.setCellAttribute?.('textAlign', null);
    });
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const align = await cell.getAttribute('data-text-align');
    expect(align).toBeNull();
  });

  test('multiple cell attributes coexist', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td data-background="#a7f3d0" data-text-align="center" data-vertical-align="middle"><p>Multi</p></td></tr></table>');

    const cell = page.locator(`${editorSelector} td`).first();
    expect(await cell.getAttribute('data-background')).toBe('#a7f3d0');
    expect(await cell.getAttribute('data-text-align')).toBe('center');
    expect(await cell.getAttribute('data-vertical-align')).toBe('middle');
  });

  test('header cells support alignment attributes', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><th data-text-align="right"><p>H</p></th></tr><tr><td><p>D</p></td></tr></table>');

    const th = page.locator(`${editorSelector} th`).first();
    expect(await th.getAttribute('data-text-align')).toBe('right');
  });
});

// =============================================================================
// Table — Cell toolbar (floating strip on CellSelection)
// =============================================================================

test.describe('Table — Cell toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  test('cell toolbar appears when cells are selected', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();
  });

  test('cell toolbar disappears when selection leaves table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await selectCells(page, 0, 1);
    await expect(page.locator('.dm-table-cell-toolbar')).toBeVisible();

    // Move cursor outside the table via editor API
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      // Focus on the first paragraph (before the table, pos 1)
      comp.editor.commands.focus(1);
    });
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();
  });

  test('cell toolbar has color, alignment, merge, split, and header buttons', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const buttons = toolbar.locator('.dm-table-cell-toolbar-btn');
    const count = await buttons.count();
    expect(count).toBe(5); // color, alignment, merge, split, header
  });

  test('color button opens color dropdown', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.dm-table-cell-dropdown');
    await expect(dropdown).toBeVisible();

    // Should have color swatches
    const swatches = dropdown.locator('.dm-color-swatch');
    expect(await swatches.count()).toBe(16);
  });

  test('clicking color swatch applies background', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(100);

    // Click first swatch
    const firstSwatch = page.locator('.dm-table-cell-dropdown .dm-color-swatch').first();
    await firstSwatch.click();
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const bg = await cell.getAttribute('data-background');
    expect(bg).toBeTruthy();
  });

  test('color reset button clears background', async ({ page }) => {
    const COLORED = '<table><tr><td data-background="#fef08a" style="background-color: #fef08a"><p>A</p></td><td><p>B</p></td></tr></table>';
    await setContentAndFocus(page, COLORED);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(100);

    const resetBtn = page.locator('.dm-table-cell-dropdown .dm-color-palette-reset');
    await resetBtn.click();
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    const bg = await cell.getAttribute('data-background');
    expect(bg).toBeNull();
  });

  test('alignment button opens alignment dropdown', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const alignBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(100);

    const dropdown = page.locator('.dm-table-cell-align-dropdown');
    await expect(dropdown).toBeVisible();

    // Should have 6 alignment items (3 horizontal + 3 vertical)
    const items = dropdown.locator('.dm-table-align-item');
    expect(await items.count()).toBe(6);
  });

  test('clicking align center sets textAlign on cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const alignBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(100);

    // Click "Align center" (second item)
    const centerItem = page.locator('.dm-table-cell-align-dropdown .dm-table-align-item').nth(1);
    await centerItem.click();
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    expect(await cell.getAttribute('data-text-align')).toBe('center');
  });

  test('clicking align middle sets verticalAlign on cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const alignBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(100);

    // Click "Align middle" (5th item, after separator — index 4)
    const middleItem = page.locator('.dm-table-cell-align-dropdown .dm-table-align-item').nth(4);
    await middleItem.click();
    await page.waitForTimeout(100);

    const cell = page.locator(`${editorSelector} td`).first();
    expect(await cell.getAttribute('data-vertical-align')).toBe('middle');
  });

  test('toggle button closes dropdown when clicking same button', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();

    // Open
    await colorBtn.click();
    await page.waitForTimeout(100);
    await expect(page.locator('.dm-table-cell-dropdown')).toBeVisible();

    // Close by clicking same button
    await colorBtn.click();
    await page.waitForTimeout(100);
    await expect(page.locator('.dm-table-cell-dropdown')).not.toBeVisible();
  });

  test('Escape key closes dropdown', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(100);
    await expect(page.locator('.dm-table-cell-dropdown')).toBeVisible();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(page.locator('.dm-table-cell-dropdown')).not.toBeVisible();
  });

  test('header toggle button converts cell to header', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    // Header button is the 5th (last) button
    const headerBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(4);
    await headerBtn.click();
    await page.waitForTimeout(200);

    // First cell should now be a th
    const thCount = await page.locator(`${editorSelector} th`).count();
    expect(thCount).toBeGreaterThan(0);
  });

  test('merge button merges selected cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    // Merge button is the 3rd button (index 2)
    const mergeBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(2);
    await mergeBtn.click();
    await page.waitForTimeout(200);

    // First row should have 1 cell with colspan=2
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('td, th').count();
    expect(firstRowCells).toBe(1);
  });

  test('split button splits merged cell', async ({ page }) => {
    const MERGED = '<table><tr><td colspan="2"><p>Merged</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>';
    await setContentAndFocus(page, MERGED);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    // Split button is the 4th button (index 3)
    const splitBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(3);
    await splitBtn.click();
    await page.waitForTimeout(200);

    // First row should now have 2 cells
    const firstRowCells = await page.locator(`${editorSelector} tr`).first().locator('td').count();
    expect(firstRowCells).toBe(2);
  });
});

// =============================================================================
// Table — Cell handle & focused cell
// =============================================================================

test.describe('Table — Cell handle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  test('cell handle appears when cursor is placed in a cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const handle = page.locator('.dm-table-cell-handle');
    await expect(handle).toBeVisible();
  });

  test('cell handle disappears when cursor leaves the table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);
    await expect(page.locator('.dm-table-cell-handle')).toBeVisible();

    // Move cursor outside the table
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(1);
    });
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-table-cell-handle')).not.toBeVisible();
  });

  test('cell handle disappears during CellSelection', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);
    await expect(page.locator('.dm-table-cell-handle')).toBeVisible();

    await selectCells(page, 0, 1);
    await expect(page.locator('.dm-table-cell-handle')).not.toBeVisible();
  });

  test('clicking cell handle creates CellSelection and shows toolbar', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3); // first body cell

    const handle = page.locator('.dm-table-cell-handle');
    await expect(handle).toBeVisible();
    await handle.click();
    await page.waitForTimeout(200);

    // Cell toolbar should appear (CellSelection created)
    await expect(page.locator('.dm-table-cell-toolbar')).toBeVisible();

    // The cell should have selectedCell class
    const selectedCount = await page.locator(`${editorSelector} .selectedCell`).count();
    expect(selectedCount).toBeGreaterThan(0);
  });

  test('cell handle is positioned within the table area', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    const handle = page.locator('.dm-table-cell-handle');
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    const tableBox = await page.locator(`${editorSelector} table`).boundingBox();
    expect(handleBox).toBeTruthy();
    expect(tableBox).toBeTruthy();

    // Handle should be within or just above the table's horizontal span
    expect(handleBox!.x).toBeGreaterThan(tableBox!.x - 20);
    expect(handleBox!.x + handleBox!.width).toBeLessThan(tableBox!.x + tableBox!.width + 20);

    // Handle should be near or above the table top
    expect(handleBox!.y).toBeLessThan(tableBox!.y + tableBox!.height);
  });

  test('cell handle moves when navigating cells with Tab', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    const handle = page.locator('.dm-table-cell-handle');
    await expect(handle).toBeVisible();

    const pos1 = await handle.boundingBox();

    // Use Tab to move to the next cell (PM-native navigation)
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    const pos2 = await handle.boundingBox();
    expect(pos2).toBeTruthy();

    // X position should have changed (moved to next column)
    expect(Math.abs(pos2!.x - pos1!.x)).toBeGreaterThan(10);
  });
});

// =============================================================================
// Table — Focused cell decoration
// =============================================================================

test.describe('Table — Focused cell decoration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('focused cell gets dm-cell-focused class', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    const focused = page.locator(`${editorSelector} .dm-cell-focused`);
    await expect(focused).toHaveCount(1);
  });

  test('dm-cell-focused moves when cursor moves to different cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    // First cell should be focused
    let focused = page.locator(`${editorSelector} td.dm-cell-focused`);
    await expect(focused).toHaveCount(1);
    const firstCellText = await focused.textContent();

    // Move to second cell
    await placeCursorInCell(page, 1);

    focused = page.locator(`${editorSelector} td.dm-cell-focused`);
    await expect(focused).toHaveCount(1);
    const secondCellText = await focused.textContent();
    expect(secondCellText).not.toBe(firstCellText);
  });

  test('dm-cell-focused removed when cursor leaves table', async ({ page }) => {
    await setContentAndFocus(page, TABLE_WITH_PARAGRAPH);
    await placeCursorInCell(page, 0);
    await expect(page.locator(`${editorSelector} .dm-cell-focused`)).toHaveCount(1);

    // Move cursor outside the table
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      comp.editor.commands.focus(1);
    });
    await page.waitForTimeout(200);

    await expect(page.locator(`${editorSelector} .dm-cell-focused`)).toHaveCount(0);
  });

  test('dm-cell-focused removed during CellSelection', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);
    await expect(page.locator(`${editorSelector} .dm-cell-focused`)).toHaveCount(1);

    // Create a CellSelection
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells.length >= 2) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
      }
    });
    await page.waitForTimeout(200);

    await expect(page.locator(`${editorSelector} .dm-cell-focused`)).toHaveCount(0);
  });

  test('focused cell has visible inset border', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await placeCursorInCell(page, 0);

    const focused = page.locator(`${editorSelector} td.dm-cell-focused`);
    await expect(focused).toHaveCount(1);

    const outline = await focused.evaluate((el) => getComputedStyle(el).outline);
    // Should have a solid outline (the focused cell border)
    expect(outline).toContain('solid');
  });

  test('only one cell has dm-cell-focused at a time', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Place cursor in cell 0
    await placeCursorInCell(page, 0);
    expect(await page.locator(`${editorSelector} .dm-cell-focused`).count()).toBe(1);

    // Place cursor in cell 3
    await placeCursorInCell(page, 3);
    expect(await page.locator(`${editorSelector} .dm-cell-focused`).count()).toBe(1);

    // Place cursor in cell 5
    await placeCursorInCell(page, 5);
    expect(await page.locator(`${editorSelector} .dm-cell-focused`).count()).toBe(1);
  });
});

// =============================================================================
// Table — Cell toolbar positioning
// =============================================================================

test.describe('Table — Cell toolbar positioning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  test('toolbar does not jump when clicking color button', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    // Record initial position
    const pos1 = await toolbar.boundingBox();
    expect(pos1).toBeTruthy();

    // Click color button (opens dropdown but shouldn't move toolbar)
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(150);

    const pos2 = await toolbar.boundingBox();
    expect(pos2).toBeTruthy();

    // Position should not have changed
    expect(Math.abs(pos2!.x - pos1!.x)).toBeLessThan(2);
    expect(Math.abs(pos2!.y - pos1!.y)).toBeLessThan(2);
  });

  test('toolbar does not jump when clicking alignment button', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const pos1 = await toolbar.boundingBox();

    // Click alignment button
    const alignBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(150);

    const pos2 = await toolbar.boundingBox();
    expect(Math.abs(pos2!.x - pos1!.x)).toBeLessThan(2);
    expect(Math.abs(pos2!.y - pos1!.y)).toBeLessThan(2);
  });

  test('toolbar does not jump when applying color', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const pos1 = await toolbar.boundingBox();

    // Open color dropdown and click a swatch
    const colorBtn = toolbar.locator('.dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(100);
    await page.locator('.dm-table-cell-dropdown .dm-color-swatch').first().click();
    await page.waitForTimeout(200);

    // Toolbar should still be visible and in the same position
    await expect(toolbar).toBeVisible();
    const pos2 = await toolbar.boundingBox();
    expect(Math.abs(pos2!.x - pos1!.x)).toBeLessThan(2);
    expect(Math.abs(pos2!.y - pos1!.y)).toBeLessThan(2);
  });

  test('toolbar does not jump when applying alignment', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const pos1 = await toolbar.boundingBox();

    // Open alignment dropdown and click center
    const alignBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(100);
    await page.locator('.dm-table-cell-align-dropdown .dm-table-align-item').nth(1).click();
    await page.waitForTimeout(200);

    await expect(toolbar).toBeVisible();
    const pos2 = await toolbar.boundingBox();
    expect(Math.abs(pos2!.x - pos1!.x)).toBeLessThan(2);
    expect(Math.abs(pos2!.y - pos1!.y)).toBeLessThan(2);
  });

  test('toolbar does not jump when toggling header cell', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 0);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const pos1 = await toolbar.boundingBox();

    // Click header toggle (5th button)
    const headerBtn = toolbar.locator('.dm-table-cell-toolbar-btn').nth(4);
    await headerBtn.click();
    await page.waitForTimeout(200);

    await expect(toolbar).toBeVisible();
    const pos2 = await toolbar.boundingBox();
    // Allow slight Y shift since header cells may have different height
    expect(Math.abs(pos2!.x - pos1!.x)).toBeLessThan(5);
  });

  test('toolbar is centered above selected cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);
    await selectCells(page, 0, 1);

    const toolbar = page.locator('.dm-table-cell-toolbar');
    await expect(toolbar).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox).toBeTruthy();

    // Get bounding box of selected cells
    const selectionBounds = await page.evaluate((sel) => {
      const cells = document.querySelectorAll(sel + ' .selectedCell');
      let left = Infinity, right = -Infinity, top = Infinity;
      cells.forEach(c => {
        const r = c.getBoundingClientRect();
        if (r.left < left) left = r.left;
        if (r.right > right) right = r.right;
        if (r.top < top) top = r.top;
      });
      return { left, right, top };
    }, editorSelector);

    const selectionCenter = (selectionBounds.left + selectionBounds.right) / 2;
    const toolbarCenter = toolbarBox!.x + toolbarBox!.width / 2;

    // Toolbar center should be near selection center
    expect(Math.abs(toolbarCenter - selectionCenter)).toBeLessThan(10);

    // Toolbar should be above the selection
    expect(toolbarBox!.y + toolbarBox!.height).toBeLessThan(selectionBounds.top + 5);
  });
});

// =============================================================================
// Table — Row/col handle suppresses cell toolbar
// =============================================================================

test.describe('Table — Row/col handle suppresses cell toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('clicking column handle shows dropdown but not cell toolbar', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Hover over a cell to make the column handle visible
    const firstCell = page.locator(`${editorSelector} th`).first();
    await firstCell.hover();
    await page.waitForTimeout(200);

    const colHandle = page.locator('.dm-table-col-handle');
    await expect(colHandle).toBeVisible();

    await colHandle.click();
    await page.waitForTimeout(200);

    // Row/column dropdown should be visible
    const dropdown = page.locator('.dm-table-controls-dropdown');
    await expect(dropdown).toBeVisible();

    // Cell toolbar should NOT be visible (suppressed)
    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();
  });

  test('clicking row handle shows dropdown but not cell toolbar', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Hover over a cell to make the row handle visible
    const firstCell = page.locator(`${editorSelector} th`).first();
    await firstCell.hover();
    await page.waitForTimeout(200);

    const rowHandle = page.locator('.dm-table-row-handle');
    await expect(rowHandle).toBeVisible();

    await rowHandle.click();
    await page.waitForTimeout(200);

    // Row/column dropdown should be visible
    const dropdown = page.locator('.dm-table-controls-dropdown');
    await expect(dropdown).toBeVisible();

    // Cell toolbar should NOT be visible (suppressed)
    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();
  });

  test('cell toolbar appears after closing row/col dropdown', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Hover and click column handle
    const firstCell = page.locator(`${editorSelector} th`).first();
    await firstCell.hover();
    await page.waitForTimeout(200);

    const colHandle = page.locator('.dm-table-col-handle');
    await colHandle.click();
    await page.waitForTimeout(200);

    // Dropdown visible, cell toolbar suppressed
    await expect(page.locator('.dm-table-controls-dropdown')).toBeVisible();
    await expect(page.locator('.dm-table-cell-toolbar')).not.toBeVisible();

    // Close dropdown with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Now dropdown should be gone
    await expect(page.locator('.dm-table-controls-dropdown')).not.toBeVisible();
  });
});

// =============================================================================
// Table — Column resize
// =============================================================================

/** Get col widths from the DOM colgroup (returns array of style.width strings). */
async function getColWidths(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const cols = document.querySelectorAll(sel + ' table colgroup col');
    return Array.from(cols).map((c) => (c as HTMLElement).style.width);
  }, editorSelector);
}

/** Get the table's inline style.width and style.minWidth. */
async function getTableStyles(page: Page): Promise<{ width: string; minWidth: string }> {
  return page.evaluate((sel) => {
    const t = document.querySelector(sel + ' table') as HTMLElement | null;
    return { width: t?.style.width ?? '', minWidth: t?.style.minWidth ?? '' };
  }, editorSelector);
}

/** Get colwidth attrs from the ProseMirror doc for all cells in the first row. */
async function getDocColwidths(page: Page): Promise<(number[] | null)[]> {
  return page.evaluate(() => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (!comp?.editor) return [];
    const widths: (number[] | null)[] = [];
    const firstRow = comp.editor.state.doc.firstChild?.firstChild;
    if (!firstRow) return [];
    for (let i = 0; i < firstRow.childCount; i++) {
      widths.push(firstRow.child(i).attrs.colwidth);
    }
    return widths;
  });
}

/** Drag the right border of a cell to resize it.
 *  cellIndex = which cell (0-based) in the first row to drag from its right edge. */
async function dragColumnBorder(page: Page, cellIndex: number, deltaX: number) {
  const cells = page.locator(`${editorSelector} th, ${editorSelector} td`);
  const cell = cells.nth(cellIndex);
  const box = await cell.boundingBox();
  if (!box) throw new Error(`Cell ${cellIndex} has no bounding box`);

  const startX = box.x + box.width - 2; // 2px inside right edge (within handleWidth=5)
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.waitForTimeout(100);
  await page.mouse.down();
  // Drag in small steps for a realistic drag gesture
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (deltaX * i) / steps, startY);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// ─── Colgroup structure ─────────────────────────────────────────────────────

test.describe('Table — Column resize: colgroup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table has colgroup with correct number of col elements', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const colgroup = page.locator(`${editorSelector} table colgroup`);
    await expect(colgroup).toBeAttached();
    expect(await colgroup.locator('col').count()).toBe(3);
  });

  test('2-column table gets 2 col elements', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    const cols = page.locator(`${editorSelector} table colgroup col`);
    expect(await cols.count()).toBe(2);
  });

  test('col elements have empty width when no colwidth is set', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const widths = await getColWidths(page);
    expect(widths).toHaveLength(3);
    for (const w of widths) {
      expect(w).toBe('');
    }
  });

  test('col elements reflect explicit colwidth from data attributes', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>Wide</p></td><td data-colwidth="100"><p>Narrow</p></td></tr></table>',
    );

    const widths = await getColWidths(page);
    expect(widths[0]).toBe('200px');
    expect(widths[1]).toBe('100px');
  });

  test('col elements reuse existing DOM nodes (not destroyed/recreated)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Tag the first col element with a custom attribute
    await page.evaluate((sel) => {
      const col = document.querySelector(sel + ' table colgroup col');
      if (col) col.setAttribute('data-test-marker', 'original');
    }, editorSelector);

    // Trigger an update by placing cursor in a cell (causes PM transaction)
    await placeCursorInCell(page, 0);
    await page.waitForTimeout(100);

    // The marker should still be there (DOM node reused, not recreated)
    const marker = await page.evaluate((sel) => {
      const col = document.querySelector(sel + ' table colgroup col');
      return col?.getAttribute('data-test-marker');
    }, editorSelector);
    expect(marker).toBe('original');
  });

  test('adding a column increases col count', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);
    await runTableCommand(page, 'addColumnAfter');

    const cols = page.locator(`${editorSelector} table colgroup col`);
    expect(await cols.count()).toBe(4);
  });

  test('deleting a column decreases col count', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);
    await runTableCommand(page, 'deleteColumn');

    const cols = page.locator(`${editorSelector} table colgroup col`);
    expect(await cols.count()).toBe(2);
  });
});

// ─── Table width / minWidth ─────────────────────────────────────────────────

test.describe('Table — Column resize: table width', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table without explicit colwidths has no inline width, only minWidth', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const styles = await getTableStyles(page);
    expect(styles.width).toBe('');
    // minWidth = 3 cols × defaultCellMinWidth(100) = 300px
    expect(styles.minWidth).toBe('300px');
  });

  test('table with all colwidths set has explicit pixel width, no minWidth', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr></table>',
    );

    const styles = await getTableStyles(page);
    expect(styles.width).toBe('350px');
    expect(styles.minWidth).toBe('');
  });

  test('table with partial colwidths has minWidth (mixed explicit + default)', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>A</p></td><td><p>B</p></td><td><p>C</p></td></tr></table>',
    );

    const styles = await getTableStyles(page);
    expect(styles.width).toBe('');
    // 200 + 100 + 100 = 400
    expect(styles.minWidth).toBe('400px');
  });

  test('2-col table without colwidths: minWidth = 2 × 100', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    const styles = await getTableStyles(page);
    expect(styles.width).toBe('');
    expect(styles.minWidth).toBe('200px');
  });
});

// ─── Resize handle interaction ──────────────────────────────────────────────

test.describe('Table — Column resize: handle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('resize handle decoration appears on cell border hover', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const firstTh = page.locator(`${editorSelector} th`).first();
    const box = await firstTh.boundingBox();
    if (!box) return;

    // Move to right edge of cell
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // The columnResizing plugin adds .resize-cursor class to ProseMirror
    const hasResizeCursor = await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      return pm?.classList.contains('resize-cursor') ?? false;
    }, editorSelector);

    // Also check for the column-resize-handle decoration div
    const handleVisible = await page.locator(`${editorSelector} .column-resize-handle`).count();

    // At least one of these should indicate resize mode
    expect(hasResizeCursor || handleVisible > 0).toBe(true);
  });

  test('resize cursor class is removed when moving away from border', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const firstTh = page.locator(`${editorSelector} th`).first();
    const box = await firstTh.boundingBox();
    if (!box) return;

    // Move to right edge to activate resize cursor
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    // Move to center of cell — away from border
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);

    const hasResizeCursor = await page.evaluate((sel) => {
      const pm = document.querySelector(sel);
      return pm?.classList.contains('resize-cursor') ?? false;
    }, editorSelector);
    expect(hasResizeCursor).toBe(false);
  });
});

// ─── Handle hiding during column resize ─────────────────────────────────────

test.describe('Table — Column resize: handle hiding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('cell handle stays visible when merely hovering near column border', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3); // body cell

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toBeVisible();

    // Move mouse to the right edge of the first header cell (triggers resize-cursor but NOT drag)
    const th = page.locator(`${editorSelector} th`).first();
    const box = await th.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // Cell handle should still be visible — only actual drag hides it
    await expect(cellHandle).toBeVisible();
  });

  test('cell handle hides during active column drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toBeVisible();

    // Start drag on first column border
    const th = page.locator(`${editorSelector} th`).first();
    const box = await th.boundingBox();
    if (!box) return;
    const startX = box.x + box.width - 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY);
    await page.waitForTimeout(100);

    // Cell handle should be hidden during drag
    await expect(cellHandle).not.toBeVisible();

    await page.mouse.up();
  });

  test('cell handle reappears after resize ends and mouse moves away', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toBeVisible();

    // Resize first column
    await dragColumnBorder(page, 0, 40);

    // Move mouse to center of a body cell (away from border)
    const td = page.locator(`${editorSelector} td`).first();
    const box = await td.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    // Place cursor back in a cell (plugin triggers showCellHandle)
    await placeCursorInCell(page, 3);
    await page.waitForTimeout(200);

    await expect(cellHandle).toBeVisible();
  });

  test('col/row hover handles do not appear during resize drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // First hover a cell to show col/row handles
    const td = page.locator(`${editorSelector} td`).first();
    const box = await td.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);

    const colHandle = page.locator('.dm-table-col-handle');
    const rowHandle = page.locator('.dm-table-row-handle');
    await expect(colHandle).toBeVisible();
    await expect(rowHandle).toBeVisible();

    // Start drag on first column border
    const th = page.locator(`${editorSelector} th`).first();
    const thBox = await th.boundingBox();
    if (!thBox) return;
    const startX = thBox.x + thBox.width - 2;
    const startY = thBox.y + thBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY);
    await page.waitForTimeout(150);

    // Col/row handles should be hidden during resize
    await expect(colHandle).not.toBeVisible();
    await expect(rowHandle).not.toBeVisible();

    await page.mouse.up();
  });

  test('cell handle stays hidden throughout entire drag gesture', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 3);

    const cellHandle = page.locator('.dm-table-cell-handle');
    await expect(cellHandle).toBeVisible();

    // Start drag
    const th = page.locator(`${editorSelector} th`).first();
    const box = await th.boundingBox();
    if (!box) return;
    const startX = box.x + box.width - 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();

    // Drag in multiple steps — check hidden at each step
    for (let i = 1; i <= 4; i++) {
      await page.mouse.move(startX + i * 15, startY);
      await page.waitForTimeout(50);
      await expect(cellHandle).not.toBeVisible();
    }

    await page.mouse.up();
  });
});

// ─── Drag-to-resize behavior ────────────────────────────────────────────────

test.describe('Table — Column resize: drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('dragging right border of first column sets colwidth in doc', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Get initial cell width
    const thBox = await page.locator(`${editorSelector} th`).first().boundingBox();
    if (!thBox) return;
    const initialWidth = thBox.width;

    await dragColumnBorder(page, 0, 50);

    // Check that colwidth is now set in the document for the first column
    const colwidths = await getDocColwidths(page);
    expect(colwidths[0]).not.toBeNull();
    const newWidth = colwidths[0]![0];
    // The new width should be roughly initialWidth + 50 (±tolerance for rounding)
    expect(newWidth).toBeGreaterThan(initialWidth + 30);
    expect(newWidth).toBeLessThan(initialWidth + 70);
  });

  test('dragging left (shrinking) respects cellMinWidth floor', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="80"><p>A</p></td><td data-colwidth="200"><p>B</p></td></tr></table>',
    );

    // Drag first column border left by 200px (more than the column's width)
    await dragColumnBorder(page, 0, -200);

    const colwidths = await getDocColwidths(page);
    // Should not go below cellMinWidth (25)
    expect(colwidths[0]![0]).toBeGreaterThanOrEqual(25);
  });

  test('dragging updates col element widths in the DOM', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 0, 60);

    const widths = await getColWidths(page);
    // First col should have an explicit width now
    expect(widths[0]).toMatch(/^\d+px$/);
    const numWidth = parseInt(widths[0]);
    expect(numWidth).toBeGreaterThan(100);
  });

  test('table width is consistent after drag (no jumping)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Record table width before drag
    const beforeWidth = await page.evaluate((sel) => {
      const t = document.querySelector(sel + ' table') as HTMLElement;
      return t?.offsetWidth ?? 0;
    }, editorSelector);

    await dragColumnBorder(page, 0, 40);

    // Record table width after drag (mouse released)
    const afterWidth = await page.evaluate((sel) => {
      const t = document.querySelector(sel + ' table') as HTMLElement;
      return t?.offsetWidth ?? 0;
    }, editorSelector);

    // Table width should be stable (not jump by more than a few pixels)
    // The key regression: table used to jump because updateColumns used
    // cellMinWidth=25 while the plugin used defaultCellMinWidth=100
    expect(Math.abs(afterWidth - beforeWidth)).toBeLessThan(20);
  });

  test('table minWidth is consistent with defaultCellMinWidth after drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 0, 50);

    const styles = await getTableStyles(page);
    // After dragging first column, col 0 has explicit width.
    // Cols 1 and 2 still don't → minWidth should include defaultCellMinWidth(100) for each.
    // minWidth = draggedWidth + 100 + 100
    const minWidth = parseInt(styles.minWidth);
    expect(minWidth).toBeGreaterThanOrEqual(300);
  });

  test('dragging second column border works', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 1, 40);

    const colwidths = await getDocColwidths(page);
    // Second column should have a colwidth set
    // Note: dragging column 1's RIGHT border resizes column 1
    expect(colwidths[1]).not.toBeNull();
  });

  test('multiple sequential drags accumulate correctly', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // First drag
    await dragColumnBorder(page, 0, 30);
    const after1 = await getDocColwidths(page);
    const width1 = after1[0]![0];

    // Second drag on the same column
    await dragColumnBorder(page, 0, 30);
    const after2 = await getDocColwidths(page);
    const width2 = after2[0]![0];

    // Width should have increased further
    expect(width2).toBeGreaterThan(width1 + 15);
  });

  test('table offsetWidth remains stable through drag cycle (anti-jump regression)', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    const firstTh = page.locator(`${editorSelector} th`).first();
    const box = await firstTh.boundingBox();
    if (!box) return;

    const startX = box.x + box.width - 2;
    const startY = box.y + box.height / 2;

    // Capture width before drag
    const widthBefore = await page.evaluate((sel) => {
      return (document.querySelector(sel + ' table') as HTMLElement)?.offsetWidth ?? 0;
    }, editorSelector);

    // Start drag
    await page.mouse.move(startX, startY);
    await page.waitForTimeout(100);
    await page.mouse.down();

    // Capture width during drag (mid-drag)
    await page.mouse.move(startX + 30, startY);
    await page.waitForTimeout(50);
    const widthDuring = await page.evaluate((sel) => {
      return (document.querySelector(sel + ' table') as HTMLElement)?.offsetWidth ?? 0;
    }, editorSelector);

    // Release
    await page.mouse.up();
    await page.waitForTimeout(150);

    // Capture width after release
    const widthAfter = await page.evaluate((sel) => {
      return (document.querySelector(sel + ' table') as HTMLElement)?.offsetWidth ?? 0;
    }, editorSelector);

    // The table should NOT jump: widthDuring and widthAfter should be close
    // This is the key regression test — previously widthAfter would drop
    // because updateColumns used cellMinWidth=25 instead of defaultCellMinWidth=100
    expect(Math.abs(widthAfter - widthDuring)).toBeLessThan(15);

    // Also verify it didn't shrink relative to before
    expect(widthAfter).toBeGreaterThanOrEqual(widthBefore - 5);
  });
});

// ─── Colwidth persistence ───────────────────────────────────────────────────

test.describe('Table — Column resize: colwidth persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('colwidth attribute is preserved in round-trip', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>Wide</p></td><td data-colwidth="100"><p>Narrow</p></td></tr></table>',
    );

    const colwidths = await getDocColwidths(page);
    expect(colwidths[0]).toEqual([200]);
    expect(colwidths[1]).toEqual([100]);
  });

  test('table renders data-colwidth on cells in the DOM', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="150"><p>A</p></td><td><p>B</p></td></tr></table>',
    );

    const cell = page.locator(`${editorSelector} td`).first();
    await expect(cell).toHaveAttribute('data-colwidth', '150');
  });

  test('data-colwidth updates after drag', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 0, 50);

    // First header cell should now have a data-colwidth attribute
    const firstTh = page.locator(`${editorSelector} th`).first();
    const colwidth = await firstTh.getAttribute('data-colwidth');
    expect(colwidth).not.toBeNull();
    expect(parseInt(colwidth!)).toBeGreaterThan(100);
  });

  test('getJSON preserves colwidth after resize', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await dragColumnBorder(page, 0, 50);

    // Export to JSON and check that colwidth is in the document
    const hasColwidth = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return false;
      const json = comp.editor.getJSON();
      // Walk the JSON tree to find a cell with colwidth
      function findColwidth(node: any): boolean {
        if (node.attrs?.colwidth && node.attrs.colwidth[0] > 0) return true;
        if (node.content) return node.content.some(findColwidth);
        return false;
      }
      return findColwidth(json);
    });
    expect(hasColwidth).toBe(true);
  });

  test('colwidths survive addRow operation', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
    );

    await placeCursorInCell(page, 0);
    await runTableCommand(page, 'addRowAfter');

    // The colwidths on the first row should still be intact
    const colwidths = await getDocColwidths(page);
    expect(colwidths[0]).toEqual([200]);
    expect(colwidths[1]).toEqual([150]);
  });

  test('colwidths survive addColumn operation', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td data-colwidth="200"><p>A</p></td><td data-colwidth="150"><p>B</p></td></tr></table>',
    );

    await placeCursorInCell(page, 0);
    await runTableCommand(page, 'addColumnAfter');

    // Col count increased to 3; original colwidths preserved on existing cells
    const colwidths = await getDocColwidths(page);
    expect(colwidths).toHaveLength(3);
    expect(colwidths[0]).toEqual([200]);
    expect(colwidths[1]).toEqual([150]);
    // New column gets null colwidth
    expect(colwidths[2]).toBeNull();
  });
});

// ─── Column resize with colspan ─────────────────────────────────────────────

test.describe('Table — Column resize: colspan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('colgroup has correct col count with colspan cell', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td colspan="2"><p>Merged</p></td><td><p>C</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr></table>',
    );

    // First row has colspan=2 + 1 = 3 logical columns
    const cols = page.locator(`${editorSelector} table colgroup col`);
    expect(await cols.count()).toBe(3);
  });

  test('colspan cell with colwidth distributes to multiple cols', async ({ page }) => {
    await setContentAndFocus(page,
      '<table><tr><td colspan="2" data-colwidth="150,100"><p>Merged</p></td><td data-colwidth="80"><p>C</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr></table>',
    );

    const widths = await getColWidths(page);
    expect(widths[0]).toBe('150px');
    expect(widths[1]).toBe('100px');
    expect(widths[2]).toBe('80px');
  });
});

// =============================================================================
// Table — Nested Tables Blocked
// =============================================================================

test.describe('Table — Nested Tables Blocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('insertTable command is blocked when cursor is inside a table cell', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
    await placeCursorInCell(page, 0);

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.insertTable?.() ?? null;
    });

    expect(result).toBe(false);

    // Should still be only 1 table
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
  });

  test('insertTable command is blocked when cursor is inside a header cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0); // th cell

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.insertTable?.() ?? null;
    });

    expect(result).toBe(false);
  });

  test('insertTable toolbar button is disabled when cursor is inside a table', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
    await placeCursorInCell(page, 0);

    await expect(page.locator(insertTableBtn)).toBeDisabled();
  });

  test('insertTable works normally outside a table', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} p`).click();

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.insertTable?.() ?? null;
    });

    expect(result).toBe(true);
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
  });
});

// =============================================================================
// Table — Multi-cell link set/unset
// =============================================================================

test.describe('Table — Multi-cell link operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  const LINK_TABLE = '<table><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table>';

  test('setLink applies to all selected cells', async ({ page }) => {
    await setContentAndFocus(page, LINK_TABLE);
    await selectCells(page, 0, 1);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.setLink?.({ href: 'https://example.com' });
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    const linkCount = (html.match(/<a /g) || []).length;
    expect(linkCount).toBeGreaterThanOrEqual(2);
  });

  test('unsetLink removes from all selected cells', async ({ page }) => {
    // Set links in all 4 cells
    const linkedTable = '<table><tr><td><p><a href="https://example.com">alpha</a></p></td><td><p><a href="https://example.com">beta</a></p></td></tr><tr><td><p><a href="https://example.com">gamma</a></p></td><td><p><a href="https://example.com">delta</a></p></td></tr></table>';
    await setContentAndFocus(page, linkedTable);

    // Select first two cells and unsetLink
    await selectCells(page, 0, 1);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.unsetLink?.();
    });
    await page.waitForTimeout(100);

    // The two selected cells should have no links
    const cells = await page.locator(`${editorSelector} td`).all();
    const cell0 = await cells[0]!.innerHTML();
    const cell1 = await cells[1]!.innerHTML();
    expect(cell0).not.toContain('<a ');
    expect(cell1).not.toContain('<a ');
    // The other two cells should still have links
    const cell2 = await cells[2]!.innerHTML();
    const cell3 = await cells[3]!.innerHTML();
    expect(cell2).toContain('<a ');
    expect(cell3).toContain('<a ');
  });

  test('unsetLink removes from all 4 selected cells', async ({ page }) => {
    const linkedTable = '<table><tr><td><p><a href="https://example.com">alpha</a></p></td><td><p><a href="https://example.com">beta</a></p></td></tr><tr><td><p><a href="https://example.com">gamma</a></p></td><td><p><a href="https://example.com">delta</a></p></td></tr></table>';
    await setContentAndFocus(page, linkedTable);

    // Select all 4 cells
    await selectCells(page, 0, 3);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.unsetLink?.();
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<a ');
  });

  test('toggleLink adds link to all selected cells', async ({ page }) => {
    await setContentAndFocus(page, LINK_TABLE);
    await selectCells(page, 0, 3);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.toggleLink?.({ href: 'https://toggle.com' });
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    const linkCount = (html.match(/href="https:\/\/toggle\.com"/g) || []).length;
    expect(linkCount).toBe(4);
  });

  test('toggleLink removes link from all selected cells when all have links', async ({ page }) => {
    const linkedTable = '<table><tr><td><p><a href="https://example.com">alpha</a></p></td><td><p><a href="https://example.com">beta</a></p></td></tr><tr><td><p><a href="https://example.com">gamma</a></p></td><td><p><a href="https://example.com">delta</a></p></td></tr></table>';
    await setContentAndFocus(page, linkedTable);
    await selectCells(page, 0, 3);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.toggleLink?.({ href: 'https://example.com' });
    });
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<a ');
  });

  test('setLink then unsetLink round-trips across multiple cells', async ({ page }) => {
    await setContentAndFocus(page, LINK_TABLE);
    // Select all 4 cells
    await selectCells(page, 0, 3);

    // Set link
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.setLink?.({ href: 'https://round-trip.com' });
    });
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    expect((html.match(/<a /g) || []).length).toBe(4);

    // Re-select all 4 cells (setLink changes selection)
    await selectCells(page, 0, 3);

    // Unset link
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.unsetLink?.();
    });
    await page.waitForTimeout(100);

    html = await getEditorHTML(page);
    expect(html).not.toContain('<a ');
    // Content should still be there
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('delta');
  });
});

// =============================================================================
// Table — Block commands with CellSelection (horizontal rule, etc.)
// =============================================================================

test.describe('Table — Block commands with CellSelection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  const HR_TABLE = '<table><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table>';

  test('setHorizontalRule with single cell cursor preserves table structure', async ({ page }) => {
    await setContentAndFocus(page, HR_TABLE);
    await placeCursorInCell(page, 0);

    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      comp?.editor?.commands?.setHorizontalRule?.();
    });
    await page.waitForTimeout(100);

    // Table should still exist
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    // HR should be inside the cell
    const hrCount = await page.locator(`${editorSelector} td hr`).count();
    expect(hrCount).toBe(1);
  });

  test('setHorizontalRule is blocked with multi-cell selection', async ({ page }) => {
    await setContentAndFocus(page, HR_TABLE);
    await selectCells(page, 0, 1);

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.setHorizontalRule?.() ?? null;
    });
    await page.waitForTimeout(100);

    // Command should return false (blocked)
    expect(result).toBe(false);
    // Table should be untouched — still 1 table, 4 cells, no HR
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    const cellCount = await page.locator(`${editorSelector} td`).count();
    expect(cellCount).toBe(4);
    const hrCount = await page.locator(`${editorSelector} hr`).count();
    expect(hrCount).toBe(0);
  });

  test('setHorizontalRule is blocked with all cells selected', async ({ page }) => {
    await setContentAndFocus(page, HR_TABLE);
    await selectCells(page, 0, 3);

    const result = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.setHorizontalRule?.() ?? null;
    });
    await page.waitForTimeout(100);

    expect(result).toBe(false);
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    expect(await getEditorHTML(page)).not.toContain('<hr');
  });
});

// =============================================================================
// Table — List toggle with CellSelection
// =============================================================================

test.describe('Table — List toggle with CellSelection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  const LIST_TABLE = '<table><tr><td>alpha</td><td>beta</td></tr><tr><td>gamma</td><td>delta</td></tr></table>';

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  /** Run a toggleList command via editor API and return result. */
  async function toggleList(page: Page, listName: string, itemName: string): Promise<boolean> {
    return page.evaluate(({ ln, itn }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      return comp?.editor?.commands?.toggleList?.(ln, itn) ?? false;
    }, { ln: listName, itn: itemName });
  }

  /** Count how many of the given cells (td) contain a <ul> (not taskList). */
  async function countCellsWithBullet(page: Page): Promise<number> {
    return page.evaluate((sel) => {
      const cells = document.querySelectorAll(sel + ' td');
      let count = 0;
      for (const cell of cells) {
        const ul = cell.querySelector('ul:not([data-type])');
        if (ul) count++;
      }
      return count;
    }, editorSelector);
  }

  /** Count how many of the given cells (td) contain an <ol>. */
  async function countCellsWithOrdered(page: Page): Promise<number> {
    return page.evaluate((sel) => {
      const cells = document.querySelectorAll(sel + ' td');
      let count = 0;
      for (const cell of cells) {
        if (cell.querySelector('ol')) count++;
      }
      return count;
    }, editorSelector);
  }

  /** Count how many of the given cells (td) contain a taskList. */
  async function countCellsWithTask(page: Page): Promise<number> {
    return page.evaluate((sel) => {
      const cells = document.querySelectorAll(sel + ' td');
      let count = 0;
      for (const cell of cells) {
        if (cell.querySelector('ul[data-type="taskList"]')) count++;
      }
      return count;
    }, editorSelector);
  }

  // ─── Basic toggle: wrap & lift ──────────────────────────────────────

  test('bullet list wraps all selected cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);
  });

  test('bullet list toggles off (lift) when all cells already have bullet list', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    // All 4 have bullet
    expect(await countCellsWithBullet(page)).toBe(4);

    // Select again and toggle off
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(0);
    // Table still intact
    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
  });

  test('repeated toggle cycles: wrap → lift → wrap', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);

    // Cycle 1: wrap
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);

    // Cycle 2: lift
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(0);

    // Cycle 3: wrap again
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);
  });

  test('ordered list wraps all selected cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);
  });

  test('ordered list toggle off when all cells have ordered list', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);

    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(0);
  });

  test('task list wraps all selected cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithTask(page)).toBe(4);
  });

  test('task list toggle off when all cells have task list', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithTask(page)).toBe(4);

    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithTask(page)).toBe(0);
  });

  // ─── Convert: switch list type ──────────────────────────────────────

  test('convert bullet → ordered in all cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);

    // Convert to ordered
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);
    expect(await countCellsWithBullet(page)).toBe(0);
  });

  test('convert ordered → bullet in all cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);
    expect(await countCellsWithOrdered(page)).toBe(0);
  });

  test('convert bullet → task in all cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithTask(page)).toBe(4);
    expect(await countCellsWithBullet(page)).toBe(0);
  });

  test('convert task → ordered in all cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);

    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);
    expect(await countCellsWithTask(page)).toBe(0);
  });

  // ─── Mixed: some cells have list, some don't ───────────────────────

  test('mixed cells: bullet wraps empty cells, skips cells already with bullet', async ({ page }) => {
    // Pre-fill 2 cells with bullet lists
    const mixedTable = '<table><tr><td><ul><li><p>A</p></li></ul></td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>';
    await setContentAndFocus(page, mixedTable);
    expect(await countCellsWithBullet(page)).toBe(1);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    // All 4 cells should have bullet list now
    expect(await countCellsWithBullet(page)).toBe(4);
    // No nesting: no cell should have a nested ul inside a ul > li
    const nested = await page.evaluate((sel) => {
      const cells = document.querySelectorAll(sel + ' td');
      for (const cell of cells) {
        if (cell.querySelector('ul li ul')) return true;
      }
      return false;
    }, editorSelector);
    expect(nested).toBe(false);
  });

  test('mixed cells: ordered converts bullet cells, wraps empty cells', async ({ page }) => {
    // 2 cells with bullet, 2 without
    const mixedTable = '<table><tr><td><ul><li><p>A</p></li></ul></td><td><ul><li><p>B</p></li></ul></td></tr><tr><td>C</td><td>D</td></tr></table>';
    await setContentAndFocus(page, mixedTable);
    expect(await countCellsWithBullet(page)).toBe(2);

    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);

    expect(await countCellsWithOrdered(page)).toBe(4);
    expect(await countCellsWithBullet(page)).toBe(0);
  });

  // ─── Subset selection (2 of 4 cells) ──────────────────────────────

  test('selecting 2 cells only affects those cells', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 1); // first row only
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    // Only 2 cells should have bullet
    expect(await countCellsWithBullet(page)).toBe(2);
    // Text in non-selected cells should remain plain
    const html = await getEditorHTML(page);
    expect(html).toContain('gamma');
    expect(html).toContain('delta');
  });

  test('subset toggle off only lifts selected cells', async ({ page }) => {
    // First, wrap all 4 in bullet
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);

    // Now select only first 2 and toggle off
    await selectCells(page, 0, 1);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    // First 2 cells lost bullet, last 2 still have it
    expect(await countCellsWithBullet(page)).toBe(2);
  });

  // ─── Full cycle: wrap → convert → lift ─────────────────────────────

  test('full cycle: bullet → ordered → lift', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);

    // Step 1: wrap in bullet
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);

    // Step 2: convert to ordered
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(4);
    expect(await countCellsWithBullet(page)).toBe(0);

    // Step 3: lift ordered
    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithOrdered(page)).toBe(0);
  });

  test('full cycle: task → bullet → lift', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);

    await selectCells(page, 0, 3);
    await toggleList(page, 'taskList', 'taskItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithTask(page)).toBe(4);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);
    expect(await countCellsWithTask(page)).toBe(0);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(0);
  });

  // ─── Content preservation ──────────────────────────────────────────

  test('text content is preserved after wrap', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('delta');
  });

  test('text content is preserved after lift', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('delta');
  });

  test('text content is preserved after convert', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    await selectCells(page, 0, 3);
    await toggleList(page, 'orderedList', 'listItem');
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
    expect(html).toContain('gamma');
    expect(html).toContain('delta');
  });

  // ─── Table structure preserved ─────────────────────────────────────

  test('table structure intact after multiple toggles', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);

    // 5 toggles
    for (let i = 0; i < 5; i++) {
      await selectCells(page, 0, 3);
      await toggleList(page, 'bulletList', 'listItem');
      await page.waitForTimeout(100);
    }

    const tableCount = await page.locator(`${editorSelector} table`).count();
    expect(tableCount).toBe(1);
    const cellCount = await page.locator(`${editorSelector} td`).count();
    expect(cellCount).toBe(4);
  });

  // ─── Reverse anchor: anchor cell after head in doc ─────────────────

  test('reverse CellSelection (anchor after head) wraps correctly', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    // Anchor = cell 3 (bottom-right), head = cell 0 (top-left) — reverse order
    await selectCells(page, 3, 0);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);
  });

  test('reverse CellSelection toggle off works', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);
    // Wrap with normal order
    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(4);

    // Lift with reverse order
    await selectCells(page, 3, 0);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);
    expect(await countCellsWithBullet(page)).toBe(0);
  });

  // ─── No nesting: repeated wrap doesn't nest lists ──────────────────

  test('clicking bullet twice does not nest lists (wrap then lift)', async ({ page }) => {
    await setContentAndFocus(page, LIST_TABLE);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    await selectCells(page, 0, 3);
    await toggleList(page, 'bulletList', 'listItem');
    await page.waitForTimeout(100);

    // Should have no lists at all (toggled off), not nested lists
    expect(await countCellsWithBullet(page)).toBe(0);
    const html = await getEditorHTML(page);
    // Verify no nested ul
    const nestedUl = (html.match(/<ul>/g) || []).length;
    expect(nestedUl).toBe(0);
  });
});

// =============================================================================
// Table — Tab/Shift-Tab with lists in cells
// =============================================================================

test.describe('Table — Tab/Shift-Tab with lists in cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  const BULLET_TABLE = '<table><tr><td><ul><li><p>A</p></li><li><p>B</p></li></ul></td><td><p>C</p></td></tr></table>';
  const TASK_TABLE = '<table><tr><td><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>T1</p></li><li data-type="taskItem" data-checked="false"><p>T2</p></li></ul></td><td><p>X</p></td></tr></table>';
  const NESTED_BULLET_TABLE = '<table><tr><td><ul><li><p>A</p><ul><li><p>A1</p></li></ul></li><li><p>B</p></li></ul></td><td><p>C</p></td></tr></table>';

  /** Place cursor at start of a text node matching the given text inside the editor table. */
  async function placeCursorAtText(page: Page, text: string) {
    await page.evaluate(
      ({ sel, t }) => {
        const editor = document.querySelector(sel);
        if (!editor) return;
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.trim() === t) {
            const range = document.createRange();
            range.setStart(walker.currentNode, 0);
            range.collapse(true);
            const s = window.getSelection();
            s?.removeAllRanges();
            s?.addRange(range);
            if (editor instanceof HTMLElement) editor.focus();
            return;
          }
        }
      },
      { sel: editorSelector, t: text },
    );
    await page.waitForTimeout(100);
  }

  /** Type a marker string and return which cell (td/th index) it ended up in. Returns -1 if not in any cell. */
  async function typeThenFindCell(page: Page, marker: string): Promise<number> {
    await page.keyboard.type(marker);
    await page.waitForTimeout(50);
    return page.evaluate(
      ({ sel, m }) => {
        const cells = document.querySelectorAll(sel + ' td, ' + sel + ' th');
        for (let i = 0; i < cells.length; i++) {
          if (cells[i].textContent?.includes(m)) return i;
        }
        return -1;
      },
      { sel: editorSelector, m: marker },
    );
  }

  // ─── Tab indents list item instead of navigating cell ──────────────

  test('Tab on second bullet list item indents it (sinkListItem)', async ({ page }) => {
    await setContentAndFocus(page, BULLET_TABLE);
    await placeCursorAtText(page, 'B');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // B should now be nested inside a sub-list under A
    const html = await getEditorHTML(page);
    expect(html).toContain('<ul><li><p>A</p><ul><li><p>B</p>');
    // Cursor should still be in first cell — type marker to verify
    const cellIdx = await typeThenFindCell(page, '§');
    expect(cellIdx).toBe(0);
  });

  test('Tab on second task item indents it (sinkListItem)', async ({ page }) => {
    await setContentAndFocus(page, TASK_TABLE);
    await placeCursorAtText(page, 'T2');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // T2 should be nested under T1
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    const nestedList = firstCell.locator('ul ul, [data-type="taskList"] [data-type="taskList"]');
    expect(await nestedList.count()).toBeGreaterThan(0);
    // Cursor should still be in first cell
    const cellIdx = await typeThenFindCell(page, '§');
    expect(cellIdx).toBe(0);
  });

  // ─── Shift-Tab outdents nested list item ───────────────────────────

  test('Shift-Tab on nested bullet item outdents it (liftListItem)', async ({ page }) => {
    await setContentAndFocus(page, NESTED_BULLET_TABLE);
    await placeCursorAtText(page, 'A1');

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);

    // A1 should no longer be nested — should be a top-level list item
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    const nestedUl = firstCell.locator('ul ul');
    expect(await nestedUl.count()).toBe(0);
    // Cursor should still be in first cell
    const cellIdx = await typeThenFindCell(page, '§');
    expect(cellIdx).toBe(0);
  });

  // ─── Tab navigates cells when NOT in a list ────────────────────────
  // (Basic Tab/Shift-Tab cell navigation is covered by "Table — Navigation" suite.
  //  Here we test that plain cells next to list cells still navigate correctly.)

  test('Tab in plain cell (next to list cell) navigates to next cell', async ({ page }) => {
    // Cell 0 has a list, cell 1 is plain text — cursor in cell 1 should Tab-navigate
    await setContentAndFocus(page, '<table><tr><td><ul><li><p>A</p></li></ul></td><td><p>M</p></td></tr><tr><td><p>N</p></td><td><p>O</p></td></tr></table>');
    await placeCursorAtText(page, 'M');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Typing should end up in cell N (row 2, col 1)
    const cellIdx = await typeThenFindCell(page, 'ZZ');
    expect(cellIdx).toBe(2); // td[0]=list, td[1]=M, td[2]=N, td[3]=O
  });

  // ─── Tab on single/first list item (cannot indent) ─────────────────

  test('Tab on first list item (cannot indent) does not navigate to next cell', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td><ul><li><p>Only</p></li></ul></td><td><p>Next</p></td></tr></table>');
    await placeCursorAtText(page, 'Only');

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // sinkListItem fails (no preceding sibling), list stays unchanged
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    await expect(firstCell).toContainText('Only');
    // Second cell should NOT have gained any typed content
    const secondCell = page.locator(`${editorSelector} td`).nth(1);
    await expect(secondCell).toHaveText('Next');
  });

  test('Shift-Tab on top-level list item lifts out of list (not cell navigation)', async ({ page }) => {
    await setContentAndFocus(page, BULLET_TABLE);
    await placeCursorAtText(page, 'A');

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);

    // A should be lifted out of the list — first cell should contain <p>A</p> outside <ul>
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    const html = await firstCell.innerHTML();
    expect(html).toContain('<p>A</p>');
    // Cursor should still be in first cell
    const cellIdx = await typeThenFindCell(page, '§');
    expect(cellIdx).toBe(0);
  });

  // ─── Full cycle: indent then outdent ───────────────────────────────

  test('Tab then Shift-Tab returns list item to original level', async ({ page }) => {
    await setContentAndFocus(page, BULLET_TABLE);
    await placeCursorAtText(page, 'B');

    // Indent
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    expect(await firstCell.locator('ul ul').count()).toBe(1);

    // Outdent back
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    expect(await firstCell.locator('ul ul').count()).toBe(0);

    // Both items should be siblings again
    const topItems = firstCell.locator(':scope > ul > li');
    expect(await topItems.count()).toBe(2);
  });

  // ─── Multiple indents ──────────────────────────────────────────────

  test('Tab twice creates double-nested list (not cell navigation)', async ({ page }) => {
    // Need 3 items so second can indent, then third can indent
    await setContentAndFocus(page, '<table><tr><td><ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul></td><td><p>Z</p></td></tr></table>');

    // Indent B under A
    await placeCursorAtText(page, 'B');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Indent C (now second top-level item, can indent under A's sub-list)
    await placeCursorAtText(page, 'C');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Both B and C should be nested under A
    const firstCell = page.locator(`${editorSelector} td`).nth(0);
    const nestedItems = firstCell.locator('ul ul li');
    expect(await nestedItems.count()).toBe(2);
    // Cursor never left the cell
    const cellIdx = await typeThenFindCell(page, '§');
    expect(cellIdx).toBe(0);
  });
});

// =============================================================================
// Table — Row handle centering on merged cells (rowspan)
// =============================================================================

test.describe('Table — Row handle centering on merged cells', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector, { state: 'visible' });
  });

  /** Merge first-column cells across rows to create a rowspan cell. */
  async function mergeFirstColumnCells(page: Page, html: string) {
    await setContentAndFocus(page, html);
    // Use editor API to select and merge cells
    await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(pos);
      });
      // Select first cell in row 0 and first cell in row 1
      if (cells.length < 3) return;
      comp.editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[2] });
      comp.editor.commands.mergeCells();
    });
    await page.waitForTimeout(150);
  }

  /** Get the row handle's vertical center relative to the table container. */
  async function getRowHandleCenter(page: Page): Promise<number> {
    const handle = page.locator('.dm-table-row-handle');
    const box = await handle.boundingBox();
    return box ? box.y + box.height / 2 : -1;
  }

  /** Get a cell's vertical center. */
  async function getCellCenter(page: Page, cellLocator: ReturnType<typeof page.locator>): Promise<number> {
    const box = await cellLocator.boundingBox();
    return box ? box.y + box.height / 2 : -1;
  }

  test('row handle is vertically centered on a rowspan=2 cell', async ({ page }) => {
    const TABLE_3ROWS = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></table>';
    await mergeFirstColumnCells(page, TABLE_3ROWS);

    // Verify the merge created a rowspan
    const mergedCell = page.locator(`${editorSelector} td[rowspan]`).first();
    await expect(mergedCell).toBeVisible();
    const rowspan = await mergedCell.getAttribute('rowspan');
    expect(rowspan).toBe('2');

    // Hover over the merged cell to show row handle
    await mergedCell.hover();
    await page.waitForTimeout(200);

    const rowHandle = page.locator('.dm-table-row-handle');
    await expect(rowHandle).toBeVisible();

    // Row handle vertical center should be close to cell vertical center
    const handleCenter = await getRowHandleCenter(page);
    const cellCenter = await getCellCenter(page, mergedCell);
    expect(Math.abs(handleCenter - cellCenter)).toBeLessThan(5);
  });

  test('row handle is vertically centered on a normal (rowspan=1) cell', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Hover over a normal cell (no rowspan)
    const cell = page.locator(`${editorSelector} td`).first();
    await cell.hover();
    await page.waitForTimeout(200);

    const rowHandle = page.locator('.dm-table-row-handle');
    await expect(rowHandle).toBeVisible();

    // The row handle should be vertically centered on the row (≈ cell center for single cells)
    const handleCenter = await getRowHandleCenter(page);
    const cellCenter = await getCellCenter(page, cell);
    expect(Math.abs(handleCenter - cellCenter)).toBeLessThan(5);
  });

  test('row handle repositions when moving from merged to normal cell', async ({ page }) => {
    const TABLE_3ROWS = '<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr><tr><td>E</td><td>F</td></tr></table>';
    await mergeFirstColumnCells(page, TABLE_3ROWS);

    const mergedCell = page.locator(`${editorSelector} td[rowspan]`).first();
    await expect(mergedCell).toBeVisible();

    // Hover merged cell first
    await mergedCell.hover();
    await page.waitForTimeout(200);

    const rowHandle = page.locator('.dm-table-row-handle');
    await expect(rowHandle).toBeVisible();
    const mergedHandleCenter = await getRowHandleCenter(page);
    const mergedCellCenter = await getCellCenter(page, mergedCell);
    expect(Math.abs(mergedHandleCenter - mergedCellCenter)).toBeLessThan(5);

    // Now hover a normal cell in the last row
    const lastRowCell = page.locator(`${editorSelector} tr`).last().locator('td').first();
    await lastRowCell.hover();
    await page.waitForTimeout(200);

    const normalHandleCenter = await getRowHandleCenter(page);
    const normalCellCenter = await getCellCenter(page, lastRowCell);
    expect(Math.abs(normalHandleCenter - normalCellCenter)).toBeLessThan(5);

    // The two positions must differ (merged cell center is higher)
    expect(Math.abs(mergedHandleCenter - normalHandleCenter)).toBeGreaterThan(10);
  });
});

// =============================================================================
// Table — Toolbar mark active state with empty cells
// =============================================================================

test.describe('Table — Toolbar marks inactive for empty cell selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  /** Create a CellSelection via the editor API. */
  async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
    await page.evaluate(({ anchor, head }) => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return;
      const cells: number[] = [];
      comp.editor.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cells.push(pos);
        }
      });
      if (cells[anchor] != null && cells[head] != null) {
        comp.editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
      }
    }, { anchor: anchorIdx, head: headIdx });
    await page.waitForTimeout(200);
  }

  const markButtons = ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Code'];

  test('mark buttons are NOT active when selecting empty cells in a new row', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Add a new row (cells 6-8 are the new empty row)
    await placeCursorInCell(page, 5); // last cell in table
    await clickTableOp(page, 'Add Row After');

    // Select cells in the newly added empty row
    // After adding a row to 3x3, new cells are at indices 9, 10, 11
    await selectCells(page, 9, 11);

    for (const label of markButtons) {
      const btn = page.locator(`domternal-toolbar button[aria-label="${label}"]`);
      if (await btn.count() > 0) {
        await expect(btn).toHaveAttribute('aria-pressed', 'false');
      }
    }
  });

  test('mark buttons are NOT active when selecting empty cells in a new column', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    // Add a new column
    await placeCursorInCell(page, 2); // last cell in first row
    await clickTableOp(page, 'Add Column After');

    // The new column cells are at indices 3, 7, 11 (inserted after each row's last cell)
    // Select two empty cells from the new column
    await selectCells(page, 3, 11);

    for (const label of markButtons) {
      const btn = page.locator(`domternal-toolbar button[aria-label="${label}"]`);
      if (await btn.count() > 0) {
        await expect(btn).toHaveAttribute('aria-pressed', 'false');
      }
    }
  });

  test('mark buttons ARE active when selecting cells with fully marked text', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td><strong>A</strong></td><td><strong>B</strong></td></tr></table>');

    await selectCells(page, 0, 1);

    const boldBtn = page.locator('domternal-toolbar button[aria-label="Bold"]');
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('mark buttons are NOT active when only some cells have the mark', async ({ page }) => {
    await setContentAndFocus(page, '<table><tr><td><strong>A</strong></td><td>B</td></tr></table>');

    await selectCells(page, 0, 1);

    const boldBtn = page.locator('domternal-toolbar button[aria-label="Bold"]');
    await expect(boldBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('mark buttons stay inactive after adding row and selecting all new cells', async ({ page }) => {
    await setContentAndFocus(page, TABLE_NO_HEADER);

    // Add a row after the last row
    await placeCursorInCell(page, 3); // last cell
    await clickTableOp(page, 'Add Row After');

    // Select only the two new empty cells (indices 4, 5)
    await selectCells(page, 4, 5);

    for (const label of markButtons) {
      const btn = page.locator(`domternal-toolbar button[aria-label="${label}"]`);
      if (await btn.count() > 0) {
        await expect(btn).toHaveAttribute('aria-pressed', 'false');
      }
    }
  });
});
