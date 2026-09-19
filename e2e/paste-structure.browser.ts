/**
 * Paste shapes the open slice audit found losing text or structure, through every wrapper and
 * browser, with PasteCleanup on and, where the defect was its own, off for comparison. Synthetic
 * paste events, parsed by each browser's own HTML parser; the unit tests for each shape are named
 * in its section and take their slices from @domternal/tests-clipboard-slices.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
  };
}

interface Pasted {
  doc: string;
  valid: boolean;
  status: string[];
}

async function open(page: Page, framework: string, query: Record<string, string> = {}): Promise<void> {
  await page.goto(`${BASE_URL}/?${new URLSearchParams({ framework, ...query }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/**
 * Seeds the document, puts the caret after the first occurrence of `caret` (at the document's
 * first text position without one), pastes the clipboard and returns the document.
 */
async function paste(page: Page, seed: string, clipboard: { html?: string; text?: string }, caret?: string): Promise<Pasted> {
  await page.evaluate(({ seed, clipboard, caret }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const { editor } = probe;
    if (!editor.setContent(seed, false)) throw new Error('Could not seed the editor');
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos >= 0) return false;
      if (caret === undefined ? node.isTextblock : node.isText && node.text?.includes(caret) === true) {
        pos = caret === undefined ? at + 1 : at + (node.text?.indexOf(caret) ?? 0) + caret.length;
      }
      return true;
    });
    probe.select(pos);
    probe.clearObservations();
    const data = new DataTransfer();
    if (clipboard.html !== undefined) data.setData('text/html', clipboard.html);
    if (clipboard.text !== undefined) data.setData('text/plain', clipboard.text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('The editor did not handle the paste');
  }, { seed, clipboard, caret });
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    let valid = true;
    try { probe.editor.state.doc.check(); } catch { valid = false; }
    return { doc: probe.editor.state.doc.toString(), valid, status: probe.operations.map(operation => operation.status) };
  });
}

const cell = (text: string): string => `tableCell(paragraph("${text}"))`;
const table = (rows: string[][]): string => `table(${rows.map(row => `tableRow(${row.map(cell).join(', ')})`).join(', ')})`;

// Unit tests: packages/extension-paste-cleanup/src/html/bareTableParts.test.ts and src/PasteCleanup.bareTableParts.test.ts.
const ROWS = '<tr><td>ra</td><td>rb</td></tr><tr><td>rc</td><td>rd</td></tr>';
const BARE_TABLE_PARTS: Record<string, { html: string; doc: string }> = {
  'bare rows': { html: ROWS, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
  'bare cells': { html: '<td>ta</td><td>tb</td>', doc: `doc(${table([['ta', 'tb']])})` },
  'rows after a column group': { html: `<colgroup><col><col></colgroup>${ROWS}`, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
  'rows after a meta element': { html: `<meta charset="utf-8">${ROWS}`, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
};
const GRID = '<table><tbody><tr><td><p>x1</p></td><td><p>x2</p></td></tr><tr><td><p>x3</p></td><td><p>x4</p></td></tr></tbody></table>';

for (const framework of FRAMEWORKS) {
  test(`${framework} pastes bare table rows and cells as a table with PasteCleanup, as it does without`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await open(page, framework, cleanup === 'on' ? {} : { 'paste-cleanup': 'off' });
      for (const [name, { html, doc }] of Object.entries(BARE_TABLE_PARTS)) {
        expect(await paste(page, '<p></p>', { html, text: 'fallback' }), `${name}, PasteCleanup ${cleanup}`)
          .toEqual({ doc, valid: true, status: cleanup === 'on' ? ['applied'] : [] });
      }
      expect(await paste(page, GRID, { html: ROWS, text: 'fallback' }, 'x1'), `rows into a table, PasteCleanup ${cleanup}`)
        .toMatchObject({ doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})`, valid: true });
    }
    // ProseMirror's parse alone drops a paragraph after bare rows; cleanup keeps it.
    await open(page, framework);
    expect(await paste(page, '<p></p>', { html: `${ROWS}<p>after</p>`, text: 'fallback' }))
      .toEqual({ doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])}, paragraph("after"))`, valid: true, status: ['applied'] });
  });
}
