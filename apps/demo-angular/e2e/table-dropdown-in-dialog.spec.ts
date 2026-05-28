/**
 * Verifies that table dropdowns render inside the `.dm-editor` container
 * rather than `document.body`. When the editor sits inside a `<dialog>`
 * top layer, a body-portaled dropdown ends up beneath the dialog backdrop
 * and is hidden or unclickable. Reparenting into `.dm-editor` keeps the
 * dropdown in the dialog's stacking context.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const SIMPLE_TABLE =
  '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table>';

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as unknown as { ng?: { getComponent?: (e: Element | null) => { editor?: { setContent: (h: string, e: boolean) => void; commands: { focus: () => void } } } } }).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      comp.editor.setContent(h, false);
      comp.editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function selectCells(page: Page, anchorIdx: number, headIdx: number) {
  await page.evaluate(({ anchor, head }) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as unknown as { ng?: { getComponent?: (e: Element | null) => { editor?: { state: { doc: { descendants: (cb: (node: { type: { name: string } }, pos: number) => void) => void } }; commands: { setCellSelection: (args: { anchorCell: number; headCell: number }) => void } } } } }).ng;
    const editor = ng?.getComponent?.(el)?.editor;
    if (!editor) return;
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        cells.push(pos);
      }
    });
    if (cells[anchor] != null && cells[head] != null) {
      editor.commands.setCellSelection({ anchorCell: cells[anchor], headCell: cells[head] });
    }
  }, { anchor: anchorIdx, head: headIdx });
  await page.waitForTimeout(200);
}

async function moveEditorIntoDialog(page: Page) {
  await page.evaluate(() => {
    // In Angular `domternal-editor` IS the .dm-editor element (host class).
    const editorEl = document.querySelector('domternal-editor');
    if (!(editorEl instanceof HTMLElement)) return;
    const dialog = document.createElement('dialog');
    dialog.id = '__test-dialog__';
    dialog.style.padding = '1rem';
    dialog.style.width = '600px';
    dialog.style.maxWidth = '90vw';
    dialog.style.maxHeight = '90vh';
    document.body.appendChild(dialog);
    dialog.appendChild(editorEl);
    dialog.showModal();
  });
  await page.waitForTimeout(100);
}

async function assertDropdownInsideEditorAndDialog(page: Page, selector: string) {
  const dropdown = page.locator(selector);
  await expect(dropdown).toBeVisible();
  const checks = await dropdown.evaluate((el) => {
    const editor = el.closest('.dm-editor');
    const dialog = el.closest('dialog');
    if (!editor || !dialog) return null;
    const eRect = editor.getBoundingClientRect();
    const ddRect = el.getBoundingClientRect();
    return {
      insideEditor: editor !== null,
      insideDialog: dialog !== null,
      notInBody: el.parentElement?.tagName !== 'BODY',
      overlapsEditor:
        ddRect.bottom > eRect.top &&
        ddRect.top < eRect.bottom &&
        ddRect.right > eRect.left &&
        ddRect.left < eRect.right,
    };
  });
  expect(checks).not.toBeNull();
  if (!checks) return;
  expect(checks.insideEditor).toBe(true);
  expect(checks.insideDialog).toBe(true);
  expect(checks.notInBody).toBe(true);
  expect(checks.overlapsEditor).toBe(true);
}

test.describe('Table dropdown - editor inside <dialog>', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('row dropdown renders inside .dm-editor and dialog', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await moveEditorIntoDialog(page);

    await page.locator('domternal-editor td').first().hover();
    await page.waitForTimeout(150);
    await page.locator('.dm-table-row-handle').click();
    await page.waitForTimeout(150);

    await assertDropdownInsideEditorAndDialog(page, '.dm-table-controls-dropdown');
  });

  test('column dropdown renders inside .dm-editor and dialog', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await moveEditorIntoDialog(page);

    await page.locator('domternal-editor td').first().hover();
    await page.waitForTimeout(150);
    await page.locator('.dm-table-col-handle').click();
    await page.waitForTimeout(150);

    await assertDropdownInsideEditorAndDialog(page, '.dm-table-controls-dropdown');
  });

  test('cell color dropdown renders inside .dm-editor and dialog', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await moveEditorIntoDialog(page);
    // Select AFTER the move so the cell toolbar's absolute position is
    // computed against the editor's new layout inside the dialog.
    await selectCells(page, 0, 1);

    const colorBtn = page.locator('.dm-table-cell-toolbar .dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(150);

    await assertDropdownInsideEditorAndDialog(page, '.dm-table-cell-dropdown');
  });

  test('cell alignment dropdown renders inside .dm-editor and dialog', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await moveEditorIntoDialog(page);
    await selectCells(page, 0, 1);

    const alignBtn = page.locator('.dm-table-cell-toolbar .dm-table-cell-toolbar-btn').nth(1);
    await alignBtn.click();
    await page.waitForTimeout(150);

    await assertDropdownInsideEditorAndDialog(page, '.dm-table-cell-align-dropdown');
  });
});

test.describe('Table dropdown - editor on normal page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('row dropdown is not portaled to body', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);

    await page.locator('domternal-editor td').first().hover();
    await page.waitForTimeout(150);
    await page.locator('.dm-table-row-handle').click();
    await page.waitForTimeout(150);

    const dropdown = page.locator('.dm-table-controls-dropdown');
    await expect(dropdown).toBeVisible();
    expect(await dropdown.evaluate((el) => el.closest('.dm-editor') !== null)).toBe(true);
    expect(await dropdown.evaluate((el) => el.parentElement?.tagName !== 'BODY')).toBe(true);
  });

  test('cell color dropdown is not portaled to body', async ({ page }) => {
    await setContentAndFocus(page, SIMPLE_TABLE);
    await selectCells(page, 0, 1);

    const colorBtn = page.locator('.dm-table-cell-toolbar .dm-table-cell-toolbar-btn').first();
    await colorBtn.click();
    await page.waitForTimeout(150);

    const dropdown = page.locator('.dm-table-cell-dropdown');
    await expect(dropdown).toBeVisible();
    expect(await dropdown.evaluate((el) => el.closest('.dm-editor') !== null)).toBe(true);
    expect(await dropdown.evaluate((el) => el.parentElement?.tagName !== 'BODY')).toBe(true);
  });
});
