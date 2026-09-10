/**
 * Pasting table cells that span rows and columns through real wrappers and browsers, with and
 * without PasteCleanup and SmartPaste. A cell spanning rows up to the table's right edge used to
 * throw prosemirror-tables' "No cell with offset" and paste nothing. Synthetic paste events,
 * and a trusted keyboard paste of HTML a page's copy handler wrote.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import { test } from './native-clipboard.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

interface ProbeWindow {
  __pasteCleanup: { ready: boolean; editor: Editor; clearObservations: () => void };
  __tableErrors: string[];
}

const grid = (width: number, height: number): string => {
  let letter = 0;
  const rows = Array.from({ length: height }, () => `<tr>${Array.from({ length: width }, () => `<td><p>${String.fromCharCode(97 + letter++)}</p></td>`).join('')}</tr>`);
  return `<table><tbody>${rows.join('')}</tbody></table>`;
};
const X22 = '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>';
const PASTES: [string, string, number, number][] = [
  ['a 2x2 cell', X22, 2, 2],
  ['a cell spanning 2 rows', '<table><tbody><tr><td rowspan="2"><p>X</p></td></tr></tbody></table>', 1, 2],
  ['a cell spanning 2 columns', '<table><tbody><tr><td colspan="2"><p>X</p></td></tr></tbody></table>', 2, 1],
  ['2 rows: a 2x2 cell and a cell, then a cell', '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td><td><p>Y</p></td></tr><tr><td><p>Z</p></td></tr></tbody></table>', 3, 2],
  ['a 2x2 header cell', '<table><tbody><tr><th colspan="2" rowspan="2"><p>X</p></th></tr></tbody></table>', 2, 2],
  ['an internal copy of a 2x2 cell', '<table data-pm-slice="1 1 -2 &quot;table&quot; []"><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>', 2, 2],
];
const TARGETS: [string, string, number, number][] = [
  ['1x1', grid(1, 1), 0, 0], ['2x2 at 0,0', grid(2, 2), 0, 0], ['2x2 at 0,1', grid(2, 2), 0, 1],
  ['2x2 at 1,1', grid(2, 2), 1, 1], ['3x3 at 1,1', grid(3, 3), 1, 1], ['3x3 at 0,1', grid(3, 3), 0, 1],
];

async function open(page: Page, framework: string, query: Record<string, string> = {}): Promise<void> {
  await page.goto(`${BASE_URL}/?${new URLSearchParams({ framework, 'unique-id': 'off', ...query }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.evaluate(() => {
    const target = window as unknown as ProbeWindow;
    target.__tableErrors = [];
    window.addEventListener('error', event => { target.__tableErrors.push(event.message); });
  });
}

/** Seeds a table and puts the caret into the cell at the row and column. */
async function seed(page: Page, html: string, row: number, col: number): Promise<void> {
  await page.evaluate(({ html, row, col }) => {
    const target = window as unknown as ProbeWindow;
    const { editor } = target.__pasteCleanup;
    if (!editor.setContent(html, false)) throw new Error('Could not seed the editor');
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableRow') { cells.push(-1); } if (node.type.name === 'tableCell') cells.push(pos); });
    // Rows are marked with -1: find the cell at the row and column of a regular grid.
    let r = -1;
    let c = 0;
    let found = -1;
    for (const pos of cells) {
      if (pos === -1) { r++; c = 0; continue; }
      if (r === row && c === col) found = pos;
      c++;
    }
    const TextSelection = editor.state.selection.constructor as unknown as { create: (doc: unknown, pos: number) => never };
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found + 2)));
    editor.view.focus();
    target.__pasteCleanup.clearObservations();
    target.__tableErrors.length = 0;
  }, { html, row, col });
}

function pasteEvent(page: Page, html: string): Promise<boolean> {
  return page.evaluate(html => {
    const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'X');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  }, html);
}

interface Observed { errors: string[]; x: { left: number; top: number; colspan: unknown; rowspan: unknown } | null; valid: boolean; selection: unknown; domMatches: boolean; text: string }

/** Where the X cell sits, whether the table map is regular, what is selected and whether the DOM shows the state. */
function observe(page: Page): Promise<Observed> {
  return page.evaluate(async () => {
    await new Promise<void>(resolve => { requestAnimationFrame(() => { setTimeout(resolve, 30); }); });
    const target = window as unknown as ProbeWindow;
    const { editor } = target.__pasteCleanup;
    const table = editor.state.doc.firstChild;
    if (table?.type.name !== 'table') throw new Error('No table');
    // A regular table: its cells fill a grid without overlaps or holes, as a browser lays them out.
    const grid: boolean[][] = [];
    let x: Observed['x'] = null;
    const layout = { overlap: false };
    table.forEach((row, _offset, index) => {
      grid[index] ??= [];
      let col = 0;
      row.forEach(cell => {
        while (grid[index]?.[col] === true) col++;
        const colspan = cell.attrs['colspan'] as number;
        const rowspan = cell.attrs['rowspan'] as number;
        if (cell.textContent === 'X') x = { left: col, top: index, colspan, rowspan };
        for (let r = index; r < index + rowspan; r++) {
          const line = grid[r] ??= [];
          for (let c = col; c < col + colspan; c++) {
            if (line[c] === true) layout.overlap = true;
            line[c] = true;
          }
        }
        col += colspan;
      });
    });
    const width = grid[0]?.length ?? 0;
    const valid = !layout.overlap && grid.length === table.childCount && grid.every(line => line.length === width && line.every(Boolean));
    const selection = editor.state.selection.toJSON() as { type: string };
    const domMatches = editor.view.dom.querySelectorAll('td, th').length === (() => { let n = 0; table.descendants(node => { if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') n++; }); return n; })();
    return { errors: [...target.__tableErrors], x, valid, selection: selection.type, domMatches, text: editor.state.doc.textContent };
  });
}

for (const framework of FRAMEWORKS) {
  for (const config of [{}, { 'paste-cleanup': 'off' }, { 'smart-paste': 'off' }] as Record<string, string>[]) {
    const label = Object.keys(config).length === 0 ? 'with PasteCleanup and SmartPaste' : Object.keys(config)[0] === 'paste-cleanup' ? 'without PasteCleanup' : 'without SmartPaste';
    test.describe(`pasting table cells (${framework}, ${label})`, () => {
      for (const [target, html, row, col] of TARGETS) {
        for (const [name, pasted, width, height] of PASTES) {
          // Every shape through vanilla, and the failing shape through the other wrappers.
          if (framework !== 'vanilla' && name !== 'a 2x2 cell') continue;
          test(`pastes ${name} into a ${target}`, async ({ page }) => {
            await open(page, framework, config);
            await seed(page, html, row, col);
            const before = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getJSON());

            expect(await pasteEvent(page, pasted)).toBe(true);

            const observed = await observe(page);
            expect(observed.errors).toEqual([]);
            expect(observed.valid).toBe(true);
            expect(observed.x).toMatchObject({ left: col, top: row });
            expect(observed.selection).toBe('cell');
            expect(observed.domMatches).toBe(true);
            void width; void height;

            await page.keyboard.press('ControlOrMeta+z');
            expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getJSON())).toEqual(before);
          });
        }
      }
    });
  }
}

test('a trusted keyboard paste of a 2x2 cell into a 2x2 table pastes it without an error', async ({ page }) => {
  await open(page, 'vanilla');
  await page.evaluate(html => {
    const source = document.body.appendChild(document.createElement('textarea'));
    source.id = 'table-source';
    source.value = 'source';
    source.addEventListener('copy', event => {
      event.clipboardData?.setData('text/html', html);
      event.clipboardData?.setData('text/plain', 'X');
      event.preventDefault();
    });
  }, X22);
  await page.locator('#table-source').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await seed(page, grid(2, 2), 0, 1);
  await page.keyboard.press('ControlOrMeta+v');

  await expect.poll(async () => (await observe(page)).x).toMatchObject({ left: 1, top: 0, colspan: 2, rowspan: 2 });
  const observed = await observe(page);
  expect(observed.errors).toEqual([]);
  expect(observed.valid).toBe(true);
  expect(observed.domMatches).toBe(true);
  expect(observed.text).toBe('aXc');
});
