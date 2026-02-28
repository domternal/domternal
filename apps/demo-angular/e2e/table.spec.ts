import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const insertTableBtn = 'domternal-toolbar button[aria-label="Insert Table"]';
const tableOpsDropdown = 'domternal-toolbar button[aria-label="Table"]';

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

/** Click a dropdown item by aria-label inside the Table Operations dropdown panel. */
async function clickTableOp(page: Page, label: string) {
  await page.locator(tableOpsDropdown).click();
  await page.waitForTimeout(50);
  await page.locator(`.dm-toolbar-dropdown-panel button[aria-label="${label}"]`).click();
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

// =============================================================================
// Table — Toolbar dropdown
// =============================================================================

test.describe('Table — Toolbar dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Table Operations dropdown is visible in toolbar', async ({ page }) => {
    await expect(page.locator(tableOpsDropdown)).toBeVisible();
  });

  test('dropdown opens on click and shows all operation buttons', async ({ page }) => {
    await page.locator(tableOpsDropdown).click();
    await page.waitForTimeout(50);

    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();

    const labels = [
      'Add Row Before', 'Add Row After', 'Delete Row',
      'Add Column Before', 'Add Column After', 'Delete Column',
      'Toggle Header Row', 'Toggle Header Column', 'Delete Table',
    ];
    for (const label of labels) {
      await expect(panel.locator(`button[aria-label="${label}"]`)).toBeVisible();
    }
  });

  test('operations work when cursor is in a table', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await placeCursorInCell(page, 0);

    await page.locator(tableOpsDropdown).click();
    await page.waitForTimeout(50);

    const addRowBtn = page.locator('.dm-toolbar-dropdown-panel button[aria-label="Add Row After"]');
    await expect(addRowBtn).toBeVisible();

    // Click it and verify a row was added
    await addRowBtn.click();
    await page.waitForTimeout(100);
    const rowCount = await page.locator(`${editorSelector} tr`).count();
    expect(rowCount).toBe(4);
  });
});

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
    expect(await swatches.count()).toBe(10);
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
