import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type {} from '@domternal/extension-table';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';
type Side = 'before' | 'after';

interface CellSnapshot {
  row: number;
  column: number;
  colspan: number;
  rowspan: number;
  widths: number[] | null;
  text: string;
  renderedWidth: number;
}

interface TableSnapshot {
  cells: CellSnapshot[];
  columns: number[];
  containerWidth: number;
  tableWidth: number;
  wrapperClientWidth: number;
  wrapperScrollWidth: number;
}

function tableHTML(widths: (number | null)[] = [null, null, null]): string {
  const rows = [0, 1, 2].map(row => {
    const tag = row === 0 ? 'th' : 'td';
    return '<tr>' + widths.map((width, column) => {
      const attribute = width === null ? '' : ` data-colwidth="${String(width)}"`;
      return `<${tag}${attribute}><p>${String.fromCharCode(65 + column)}${String(row)}</p></${tag}>`;
    }).join('') + '</tr>';
  });
  return `<table>${rows.join('')}</table>`;
}

async function openDemo(page: Page, target: DemoTarget, query = ''): Promise<void> {
  await page.goto(`${target.baseURL}/${query}`);
  await expect(page.locator(EDITOR)).toBeVisible();
  await page.waitForFunction(() => Boolean(
    (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'],
  ));
}

/** A fixed wrapper models a table inside a layout column and makes budgets exact. */
async function seed(page: Page, html = tableHTML(), capacity = 600): Promise<void> {
  await page.evaluate(({ content, selector }) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
    editor.setContent(content, false);
    editor.commands.focus();
    const root = document.querySelector(selector);
    if (!(root instanceof HTMLElement)) throw new Error('Editor is missing');
  }, { content: html, selector: EDITOR });
  await expect(page.locator(`${EDITOR} table`)).toHaveCount(1);
  await page.locator(`${EDITOR} .tableWrapper`).evaluate((wrapper, width) => {
    (wrapper as HTMLElement).style.width = `${String(width + 1)}px`;
  }, capacity);
  await expect.poll(async () => (await snapshot(page)).containerWidth).toBe(capacity);
}

/** Read both the document and actual browser layout, including every spanned cell. */
async function snapshot(page: Page): Promise<TableSnapshot> {
  return page.evaluate(selector => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
    const tableNode = editor.state.doc.firstChild;
    const table = document.querySelector<HTMLTableElement>(`${selector} table`);
    const wrapper = table?.closest<HTMLElement>('.tableWrapper');
    if (tableNode?.type.name !== 'table' || !table || !wrapper) {
      throw new Error('Table document or DOM is missing');
    }

    const occupied: boolean[][] = [];
    const cells: CellSnapshot[] = [];
    tableNode.forEach((rowNode, _offset, row) => {
      let column = 0;
      rowNode.forEach((cell, _cellOffset, index) => {
        while (occupied[row]?.[column]) column++;
        const colspan = cell.attrs['colspan'] as number;
        const rowspan = cell.attrs['rowspan'] as number;
        const domCell = table.rows[row]?.cells[index];
        if (!domCell) throw new Error('Rendered cell is missing');
        cells.push({
          row, column, colspan, rowspan,
          widths: cell.attrs['colwidth'] as number[] | null,
          text: cell.textContent,
          renderedWidth: domCell.getBoundingClientRect().width,
        });
        for (let r = row; r < row + rowspan; r++) {
          occupied[r] ??= [];
          for (let c = column; c < column + colspan; c++) occupied[r]![c] = true;
        }
        column += colspan;
      });
    });
    const columns = Array.from(table.querySelectorAll('col'), (_col, column) => {
      // WebKit does not give COL elements layout boxes. Measure real cells.
      const cell = cells.find(candidate => candidate.column === column && candidate.colspan === 1);
      if (!cell) throw new Error(`No unspanned rendered cell for column ${String(column)}`);
      return cell.renderedWidth;
    });
    return {
      cells,
      columns,
      containerWidth: Math.floor(wrapper.getBoundingClientRect().width) - 1,
      tableWidth: table.getBoundingClientRect().width,
      wrapperClientWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
    };
  }, EDITOR);
}

function storedWidths(table: TableSnapshot): number[] {
  return table.cells.filter(cell => cell.row === 0).flatMap(cell => {
    if (!cell.widths) throw new Error('Expected every column to have an explicit width');
    return cell.widths;
  });
}

async function expectWidths(page: Page, expected: number[]): Promise<TableSnapshot> {
  await expect.poll(async () => storedWidths(await snapshot(page))).toEqual(expected);
  const table = await snapshot(page);
  expect(table.columns).toHaveLength(expected.length);
  for (const [index, width] of expected.entries()) {
    expect(Math.abs(table.columns[index]! - width), `Rendered column ${String(index)}`).toBeLessThanOrEqual(2);
  }
  for (const cell of table.cells) {
    const expectedCell = expected.slice(cell.column, cell.column + cell.colspan);
    expect(cell.widths, `Stored widths at row ${String(cell.row)}, column ${String(cell.column)}`).toEqual(expectedCell);
    const width = expectedCell.reduce((sum, value) => sum + value, 0);
    expect(Math.abs(cell.renderedWidth - width), `Rendered cell ${cell.text}`).toBeLessThanOrEqual(2);
  }
  return table;
}

async function selectCell(page: Page, column: number, row = 1): Promise<void> {
  await page.locator(`${EDITOR} tr`).nth(row).locator('th, td').nth(column).click();
}

async function insert(page: Page, side: Side): Promise<void> {
  const result = await page.evaluate(direction => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
    return direction === 'before' ? editor.commands.addColumnBefore() : editor.commands.addColumnAfter();
  }, side);
  expect(result).toBe(true);
}

async function insertFromMenu(page: Page, column: number, side: Side): Promise<void> {
  await page.locator(`${EDITOR} tr`).first().locator('th, td').nth(column).hover();
  const handle = page.locator('.dm-table-col-handle');
  await expect(handle).toBeVisible();
  await handle.click();
  await page.getByRole('menuitem', {
    name: side === 'before' ? 'Insert Column Left' : 'Insert Column Right', exact: true,
  }).click();
  await expect(page.getByRole('menu', { name: 'Column options' })).not.toBeVisible();
}

/** Use the real resize plugin, including its initial DOM measurement and freeze. */
async function dragBorder(page: Page, column: number, delta: number): Promise<void> {
  const cell = page.locator(`${EDITOR} tr`).nth(1).locator('th, td').nth(column);
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  if (!box) throw new Error('Resize cell is not visible');
  const start = box.x + box.width - 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(start, y);
  await expect(page.locator(`${EDITOR}.resize-cursor`)).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(start + delta, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).cells.find(item => item.row === 1 && item.column === column)?.widths).not.toBeNull();
}

/** These cases deliberately provide enough space in the selected donor alone. */
function singleDonorExpectation(before: TableSnapshot, column: number, side: Side): number[] {
  const old = storedWidths(before);
  const spare = Math.max(0, before.containerWidth - old.reduce((sum, width) => sum + width, 0));
  const deficit = Math.max(0, 100 - spare);
  expect(old[column]! - deficit).toBeGreaterThanOrEqual(25);
  old[column] = old[column]! - deficit;
  old.splice(side === 'before' ? column : column + 1, 0, 100);
  return old;
}

for (const target of demoTargets) {
  test.describe(`${target.name}: inserted columns preserve resized widths`, () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    for (const side of ['before', 'after'] as const) {
      test(`pointer resize then API insert ${side} preserves unrelated columns in every row`, async ({ page }) => {
        await openDemo(page, target);
        await seed(page);
        const initial = await snapshot(page);
        await dragBorder(page, 0, 70);
        const before = await snapshot(page);
        expect(before.columns[0]!).toBeGreaterThan(initial.columns[0]! + 40);
        const expected = singleDonorExpectation(before, 0, side);
        await selectCell(page, 0);
        await insert(page, side);
        const after = await expectWidths(page, expected);
        expect(after.wrapperScrollWidth).toBeLessThanOrEqual(after.wrapperClientWidth + 1);
        expect(after.cells.filter(cell => cell.row === 0).map(cell => cell.text))
          .toEqual(side === 'before' ? ['', 'A0', 'B0', 'C0'] : ['A0', '', 'B0', 'C0']);
      });

      test(`column dropdown insert ${side} uses the same width policy after a pointer resize`, async ({ page }) => {
        await openDemo(page, target);
        await seed(page);
        await dragBorder(page, 0, 60);
        const before = await snapshot(page);
        const expected = singleDonorExpectation(before, 0, side);
        await insertFromMenu(page, 0, side);
        await expectWidths(page, expected);
      });
    }

    for (const shrink of [140, 40]) {
      test(`insertion uses ${String(shrink)}px of slack from shrinking the last column before touching a neighbor`, async ({ page }) => {
        await openDemo(page, target);
        await seed(page, tableHTML([220, 180, 200]));
        await dragBorder(page, 2, -shrink);
        const before = await snapshot(page);
        expect(storedWidths(before).slice(0, 2)).toEqual([220, 180]);
        expect(before.containerWidth - storedWidths(before).reduce((sum, width) => sum + width, 0))
          .toBeGreaterThanOrEqual(shrink - 3);
        const expected = singleDonorExpectation(before, 0, 'after');
        await selectCell(page, 0);
        await insert(page, 'after');
        await expectWidths(page, expected);
        if (shrink > 100) expect(expected.filter((_, index) => index !== 1)).toEqual(storedWidths(before));
      });
    }

    test('repeated insertions exhaust the nearest donor before using the next column', async ({ page }) => {
      await openDemo(page, target);
      await seed(page, tableHTML([320, 140, 140]));
      for (const expected of [[220, 100, 140, 140], [120, 100, 100, 140, 140], [25, 100, 95, 100, 140, 140]]) {
        await selectCell(page, 0);
        await insert(page, 'after');
        await expectWidths(page, expected);
      }
    });

    test('a smaller inserted column consumes remaining space without crossing existing minimum widths', async ({ page }) => {
      await openDemo(page, target);
      await seed(page, tableHTML([40, 25, 25]), 150);
      await selectCell(page, 0);
      await insert(page, 'after');
      const table = await expectWidths(page, [25, 75, 25, 25]);
      expect(table.wrapperScrollWidth).toBeLessThanOrEqual(table.wrapperClientWidth + 1);
    });

    test('when all column minimums cannot fit the wrapper scrolls and the final column remains reachable', async ({ page }) => {
      await page.setViewportSize({ width: 420, height: 900 });
      await openDemo(page, target);
      await seed(page, tableHTML([40, 25, 25]), 90);
      await selectCell(page, 0);
      await insert(page, 'after');
      const table = await expectWidths(page, [25, 25, 25, 25]);
      expect(table.wrapperScrollWidth).toBeGreaterThan(table.wrapperClientWidth);
      const reach = await page.locator(`${EDITOR} .tableWrapper`).evaluate(wrapper => {
        wrapper.scrollLeft = wrapper.scrollWidth;
        const lastCell = wrapper.querySelector('tr:first-child > :last-child');
        if (!lastCell) throw new Error('Final cell is missing');
        return {
          scrollLeft: wrapper.scrollLeft,
          lastRight: lastCell.getBoundingClientRect().right,
          wrapperRight: wrapper.getBoundingClientRect().right,
        };
      });
      expect(reach.scrollLeft).toBeGreaterThan(0);
      expect(reach.lastRight).toBeLessThanOrEqual(reach.wrapperRight + 2);
    });

    test('a table already overflowing a narrow viewport keeps all existing widths on insertion', async ({ page }) => {
      await page.setViewportSize({ width: 420, height: 900 });
      await openDemo(page, target);
      await seed(page, tableHTML([180, 120, 100]), 240);
      await selectCell(page, 0);
      await insert(page, 'after');
      const table = await expectWidths(page, [180, 100, 120, 100]);
      expect(table.wrapperScrollWidth).toBeGreaterThan(table.wrapperClientWidth);
    });

    for (const side of ['before', 'after'] as const) {
      test(`insert ${side} across a colspan preserves rowspan cells and all logical widths`, async ({ page }) => {
        await openDemo(page, target);
        await seed(page,
          '<table>' +
          '<tr><th colspan="2" data-colwidth="250,150"><p>Group</p></th><th data-colwidth="200"><p>C</p></th></tr>' +
          '<tr><td rowspan="2" data-colwidth="250"><p>A</p></td><td data-colwidth="150"><p>B</p></td><td data-colwidth="200"><p>C</p></td></tr>' +
          '<tr><td data-colwidth="150"><p>B2</p></td><td data-colwidth="200"><p>C2</p></td></tr>' +
          '</table>',
        );
        await selectCell(page, 1);
        await insert(page, side);
        const expected = side === 'before' ? [250, 100, 50, 200] : [250, 50, 100, 200];
        const table = await expectWidths(page, expected);
        const spanning = table.cells.find(cell => cell.text === 'A');
        expect(spanning?.rowspan).toBe(2);
        expect(spanning?.widths).toEqual([250]);
        const group = table.cells.find(cell => cell.text === 'Group');
        expect(group?.colspan).toBe(side === 'before' ? 3 : 2);
        expect(table.cells.filter(cell => cell.text.startsWith('C')).map(cell => cell.widths)).toEqual([[200], [200], [200]]);
      });
    }

    test('one undo restores resized widths and redo plus JSON and HTML round trips retain the insertion', async ({ page }) => {
      await openDemo(page, target);
      await seed(page);
      await dragBorder(page, 0, 70);
      const before = await snapshot(page);
      const expected = singleDonorExpectation(before, 0, 'after');
      // History groups edits for 500ms, so make insertion a separate user action.
      await page.waitForTimeout(550);
      await selectCell(page, 0);
      await insert(page, 'after');
      await expectWidths(page, expected);
      expect(await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        return editor.commands.undo();
      })).toBe(true);
      await expectWidths(page, storedWidths(before));
      expect(await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        return editor.commands.redo();
      })).toBe(true);
      await expectWidths(page, expected);

      for (const format of ['json', 'html'] as const) {
        const result = await page.evaluate(kind => {
          const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
          const original = editor.getJSON();
          const serialized = kind === 'json' ? JSON.parse(JSON.stringify(original)) as ReturnType<Editor['getJSON']> : editor.getHTML();
          editor.setContent(serialized, false);
          return { original, restored: editor.getJSON() };
        }, format);
        expect(result.restored).toEqual(result.original);
        await expectWidths(page, expected);
      }
    });

    test('unconstrained API and dropdown insertion grow a resized table without changing old widths', async ({ page }) => {
      await openDemo(page, target, '?constrainTable=false');
      await seed(page);
      await dragBorder(page, 0, 70);
      const before = storedWidths(await snapshot(page));
      await selectCell(page, 0);
      await insert(page, 'before');
      await expectWidths(page, [100, ...before]);
      await insertFromMenu(page, 1, 'after');
      const after = await expectWidths(page, [100, before[0]!, 100, ...before.slice(1)]);
      expect(after.wrapperScrollWidth).toBeGreaterThan(after.wrapperClientWidth);
    });

    test('independent resize mode preserves other columns when insertion consumes spare width', async ({ page }) => {
      await openDemo(page, target, '?resizeBehavior=independent');
      await seed(page);
      await dragBorder(page, 0, -40);
      const before = await snapshot(page);
      const expected = singleDonorExpectation(before, 0, 'after');
      await selectCell(page, 0);
      await insert(page, 'after');
      await expectWidths(page, expected);
    });

    test('redistribute resize mode preserves measured unfrozen neighbors when inserting next to a resized column', async ({ page }) => {
      await openDemo(page, target, '?resizeBehavior=redistribute');
      await seed(page);
      await dragBorder(page, 0, 50);
      const before = await snapshot(page);
      const first = before.cells.find(cell => cell.row === 0 && cell.column === 0)?.widths?.[0];
      expect(first).toBeGreaterThan(200);
      expect(before.cells.find(cell => cell.row === 0 && cell.column === 1)?.widths).toBeNull();
      await selectCell(page, 0);
      await insert(page, 'after');
      const after = await snapshot(page);
      const widths = storedWidths(after);
      expect(widths[1]).toBe(100);
      expect(Math.abs(widths[0]! - (first! - 100))).toBeLessThanOrEqual(3);
      expect(Math.abs(widths[2]! - before.columns[1]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(widths[3]! - before.columns[2]!)).toBeLessThanOrEqual(2);
      await expectWidths(page, widths);
    });

    test('a wholly unfrozen table keeps native automatic column widths', async ({ page }) => {
      await openDemo(page, target);
      await seed(page);
      await selectCell(page, 0);
      await insert(page, 'after');
      const table = await snapshot(page);
      expect(table.columns).toHaveLength(4);
      expect(table.cells.every(cell => cell.widths === null)).toBe(true);
      expect(table.wrapperScrollWidth).toBeLessThanOrEqual(table.wrapperClientWidth + 1);
    });

    test('multiple chained insertions form one undo step and a failed chain leaves the table untouched', async ({ page }) => {
      await openDemo(page, target);
      await seed(page, tableHTML([320, 140, 140]));
      await selectCell(page, 0);
      await page.waitForTimeout(550);
      const result = await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        const before = editor.getJSON();
        const failed = editor.chain().addColumnAfter().mergeCells().run();
        const afterFailure = editor.getJSON();
        const succeeded = editor.chain().addColumnAfter().addColumnAfter().run();
        return { before, failed, afterFailure, succeeded };
      });
      expect(result.failed).toBe(false);
      expect(result.afterFailure).toEqual(result.before);
      expect(result.succeeded).toBe(true);
      await expectWidths(page, [120, 100, 100, 140, 140]);
      expect(await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        return editor.commands.undo();
      })).toBe(true);
      await expectWidths(page, [320, 140, 140]);
    });

    test('a chained row insertion keeps column insertion widths consistent in the pending document', async ({ page }) => {
      await openDemo(page, target);
      await seed(page, tableHTML([320, 140, 140]));
      await selectCell(page, 0);
      await page.waitForTimeout(550);
      const result = await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        const before = editor.getJSON();
        const succeeded = editor.chain().addRowBefore().addColumnAfter().run();
        return { before, succeeded };
      });
      expect(result.succeeded).toBe(true);
      await expectWidths(page, [220, 100, 140, 140]);
      await expect(page.locator(`${EDITOR} tr`)).toHaveCount(4);
      const restored = await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor;
        const undone = editor.commands.undo();
        return { undone, document: editor.getJSON() };
      });
      expect(restored.undone).toBe(true);
      expect(restored.document).toEqual(result.before);
      await expectWidths(page, [320, 140, 140]);
      await expect(page.locator(`${EDITOR} tr`)).toHaveCount(3);
    });
  });
}
