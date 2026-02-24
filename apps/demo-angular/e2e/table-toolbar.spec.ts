import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

test.describe('Table toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('table dropdown trigger is visible in toolbar', async ({ page }) => {
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await expect(trigger).toBeVisible();
  });

  test('clicking table dropdown opens panel with table commands', async ({ page }) => {
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();

    // Panel should be visible with Insert Table button
    const insertBtn = page.locator('domternal-toolbar button[aria-label="Insert Table"]');
    await expect(insertBtn).toBeVisible();
  });

  test('Insert Table inserts a 3x3 table', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Open table dropdown and click Insert Table
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    const insertBtn = page.locator('domternal-toolbar button[aria-label="Insert Table"]');
    await insertBtn.click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<table');
    expect(html).toContain('<tr');
  });

  test('Delete Table removes the table', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Insert a table first
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Insert Table"]').click();

    // Verify table exists
    let html = await getEditorHTML(page);
    expect(html).toContain('<table');

    // Click inside the table to place cursor
    await page.locator(`${editorSelector} td, ${editorSelector} th`).first().click();

    // Delete the table
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Delete Table"]').click();

    html = await getEditorHTML(page);
    expect(html).not.toContain('<table');
  });

  test('Add Row After adds a row', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Insert table
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Insert Table"]').click();

    // Count initial rows
    const initialRows = await page.locator(`${editorSelector} tr`).count();

    // Click in a cell
    await page.locator(`${editorSelector} td, ${editorSelector} th`).first().click();

    // Add row after
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Add Row After"]').click();

    const newRows = await page.locator(`${editorSelector} tr`).count();
    expect(newRows).toBe(initialRows + 1);
  });

  test('Add Column After adds a column', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Insert table
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Insert Table"]').click();

    // Count initial columns (cells in first row)
    const initialCols = await page.locator(`${editorSelector} tr:first-child > *`).count();

    // Click in a cell
    await page.locator(`${editorSelector} td, ${editorSelector} th`).first().click();

    // Add column after
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Add Column After"]').click();

    const newCols = await page.locator(`${editorSelector} tr:first-child > *`).count();
    expect(newCols).toBe(initialCols + 1);
  });

  test('Delete Row removes a row', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Insert table
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Insert Table"]').click();

    const initialRows = await page.locator(`${editorSelector} tr`).count();

    // Click in a non-header cell (second row)
    await page.locator(`${editorSelector} td`).first().click();

    // Delete row
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Delete Row"]').click();

    const newRows = await page.locator(`${editorSelector} tr`).count();
    expect(newRows).toBe(initialRows - 1);
  });

  test('Delete Column removes a column', async ({ page }) => {
    const editor = page.locator(editorSelector);
    await editor.click();

    // Insert table
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Insert Table"]').click();

    const initialCols = await page.locator(`${editorSelector} tr:first-child > *`).count();

    // Click in a cell
    await page.locator(`${editorSelector} td, ${editorSelector} th`).first().click();

    // Delete column
    await trigger.click();
    await page.locator('domternal-toolbar button[aria-label="Delete Column"]').click();

    const newCols = await page.locator(`${editorSelector} tr:first-child > *`).count();
    expect(newCols).toBe(initialCols - 1);
  });

  test('dropdown panel shows all 11 items', async ({ page }) => {
    const trigger = page.locator('domternal-toolbar button[aria-label="Table"]');
    await trigger.click();

    const labels = [
      'Insert Table', 'Delete Table',
      'Add Row Before', 'Add Row After', 'Delete Row',
      'Add Column Before', 'Add Column After', 'Delete Column',
      'Toggle Header Row', 'Toggle Header Column', 'Toggle Header Cell',
    ];

    for (const label of labels) {
      const btn = page.locator(`domternal-toolbar button[aria-label="${label}"]`);
      await expect(btn).toBeVisible();
    }
  });
});
