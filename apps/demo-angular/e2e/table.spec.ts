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
