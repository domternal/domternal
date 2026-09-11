/**
 * Pasting table cells that span rows and columns through real wrappers and browsers, with and
 * without PasteCleanup and SmartPaste. A cell spanning rows up to the table's right edge used to
 * throw prosemirror-tables' "No cell with offset" and paste nothing. Synthetic paste events,
 * and a trusted keyboard paste of HTML a page's copy handler wrote.
 */
import { expect, type Locator, type Page } from '@playwright/test';
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
// A copied merged cell brings the rows it covers, empty ones too, as an internal copy and spreadsheets write them.
const X22 = '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr><tr></tr></tbody></table>';
const PASTES: [string, string, number, number][] = [
  ['a 2x2 cell', X22, 2, 2],
  ['a cell spanning 2 rows', '<table><tbody><tr><td rowspan="2"><p>X</p></td></tr><tr></tr></tbody></table>', 1, 2],
  ['a cell spanning 2 columns', '<table><tbody><tr><td colspan="2"><p>X</p></td></tr></tbody></table>', 2, 1],
  ['2 rows: a 2x2 cell and a cell, then a cell', '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td><td><p>Y</p></td></tr><tr><td><p>Z</p></td></tr></tbody></table>', 3, 2],
  ['a 2x2 header cell', '<table><tbody><tr><th colspan="2" rowspan="2"><p>X</p></th></tr><tr></tr></tbody></table>', 2, 2],
  ['an internal copy of a 2x2 cell', '<table data-pm-slice="1 1 -2 []"><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr><tr></tr></tbody></table>', 2, 2],
  // A browser draws a rowspan past the copied rows as ending with them, and the paste keeps that.
  ['a one-row copy of a 2x2 cell', '<table><tbody><tr><td colspan="2" rowspan="2"><p>X</p></td></tr></tbody></table>', 2, 1],
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
            // The pasted X cell spans the rows of the pasted area, and no more.
            expect(observed.x).toMatchObject({ left: col, top: row, rowspan: height });
            expect(observed.selection).toBe('cell');
            expect(observed.domMatches).toBe(true);
            void width;

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

/**
 * A table holding a span loading would replace, as a 1.2.0 client or a crafted update can write
 * into a shared document, stays text-editable until normalizeContentAttributes: a cell paste puts
 * the cells' content at the caret, and mouse selection, handles and column resizing leave it alone.
 */
test.describe('a table that holds an unsupported span', () => {
  for (const [name, colspan] of [['0', 0], ['-1', -1], ['a million', 1_000_000]] as const) {
    test(`pastes, selects and resizes nothing through its table map, with a colspan of ${name}`, async ({ page }) => {
      await open(page, 'vanilla');
      await page.evaluate(colspan => {
        const target = window as unknown as ProbeWindow;
        const { editor } = target.__pasteCleanup;
        const { schema } = editor;
        const node = (name: string): NonNullable<(typeof schema.nodes)[string]> => {
          const type = schema.nodes[name];
          if (!type) throw new Error(`No ${name} node`);
          return type;
        };
        const cell = (text: string, attrs: Record<string, unknown> | null = null): ReturnType<ReturnType<typeof node>['create']> =>
          node('tableCell').create(attrs, node('paragraph').create(null, schema.text(text)));
        const table = node('table').create(null, [
          node('tableRow').create(null, [cell('a'), cell('b', { colspan }), cell('c')]),
          node('tableRow').create(null, [cell('d'), cell('e'), cell('f')]),
        ]);
        editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, [table, node('paragraph').create(null, schema.text('after'))]));
        target.__tableErrors.length = 0;
      }, colspan);
      const cellOf = (text: string): Locator => page.locator('.ProseMirror td', { hasText: new RegExp(`^${text}$`) });

      // A mouse drag from one cell to another makes no cell selection.
      const from = await cellOf('a').boundingBox();
      const to = await cellOf('e').boundingBox();
      if (!from || !to) throw new Error('No cell boxes');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 5 });
      await page.mouse.up();
      // Hovering a cell border offers no resize handle, and hovering a cell shows no row or column handle.
      await page.mouse.move(to.x + to.width - 1, to.y + to.height / 2, { steps: 3 });
      const state = await page.evaluate(() => {
        const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
        return {
          selection: (editor.state.selection.toJSON() as { type: string }).type,
          resizeHandles: editor.view.dom.querySelectorAll('.column-resize-handle').length,
          handles: [...document.querySelectorAll<HTMLElement>('.dm-table-col-handle, .dm-table-row-handle')].filter(handle => handle.style.display === 'flex').length,
        };
      });
      expect(state).toEqual({ selection: 'text', resizeHandles: 0, handles: 0 });

      // Pasted cells arrive as their content at the caret, deleting no cell.
      await cellOf('d').click();
      expect(await pasteEvent(page, '<table><tbody><tr><td><p>S</p></td><td><p>T</p></td></tr></tbody></table>')).toBe(true);
      const after = await page.evaluate(() => {
        const target = window as unknown as ProbeWindow;
        const texts: string[] = [];
        target.__pasteCleanup.editor.state.doc.descendants(node => { if (node.isTextblock) texts.push(node.textContent); });
        return { texts, errors: target.__tableErrors };
      });
      expect(after.errors).toEqual([]);
      expect(after.texts.filter(text => ['a', 'b', 'c', 'e', 'f', 'after'].includes(text))).toEqual(['a', 'b', 'c', 'e', 'f', 'after']);
      expect(after.texts.join('|')).toMatch(/S\|T/);
    });
  }
});

/**
 * PasteCleanup reads a pasted colspan or rowspan as a browser and the Table extension do, so a
 * table the editor accepts on its own is never blocked by installing it.
 */
test.describe('pasted table spans that a browser reads as 1 or as a leading number', () => {
  for (const framework of FRAMEWORKS) {
    test(`pastes rowspan="0", colspan="" and colspan="2x" as the Table extension reads them (${framework})`, async ({ page }) => {
      await open(page, framework);
      await page.evaluate(() => {
        const target = window as unknown as ProbeWindow;
        const { editor } = target.__pasteCleanup;
        if (!editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
        editor.commands.focus('end');
        target.__pasteCleanup.clearObservations();
      });

      expect(await pasteEvent(page, '<table><tr><td rowspan="0"><p>a</p></td><td colspan=""><p>b</p></td></tr>'
        + '<tr><td colspan="2x"><p>c</p></td></tr></table>')).toBe(true);

      await expect(page.locator('.ProseMirror table')).toHaveCount(1);
      const spans = await page.evaluate(() => {
        const found: [string, unknown, unknown][] = [];
        (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
          if (node.type.name === 'tableCell') found.push([node.textContent, node.attrs['colspan'], node.attrs['rowspan']]);
        });
        return found;
      });
      expect(spans).toEqual([['a', 1, 1], ['b', 1, 1], ['c', 2, 1]]);
      await expect(page.locator('.dm-paste-feedback')).toBeHidden();
    });
  }
});
