import { expect } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor; select: (from: number, to?: number) => void; closeHistory: () => void } }
const grid = '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table><p>after</p>';

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test(`${framework} preserves visible clipboard order around incomplete table fragments`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:5895/?framework=${framework}&unique-id=off`);
    await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
    const cases = [
      ['<html><body><!--StartFragment--><tr><td>a</td><td>b</td></tr><!--EndFragment--></body></html>', 'doc(table(tableRow(tableCell(paragraph("a")), tableCell(paragraph("b")))))'],
      ['loose<colgroup><col></colgroup><p>pa</p>', 'doc(paragraph("loose"), paragraph("pa"))'],
      ['text <col> more <p>para</p>', 'doc(paragraph("text more "), paragraph("para"))'],
      ['<tr><td>first</td></tr>between<tr><td>last</td></tr>', 'doc(table(tableRow(tableCell(paragraph("first")))), paragraph("between"), table(tableRow(tableCell(paragraph("last")))))'],
    ];
    for (const [html, expected] of cases) {
      const result = await page.evaluate(source => {
        const { editor, select, closeHistory } = (window as unknown as ProbeWindow).__pasteCleanup;
        editor.setContent('<p></p>', false);
        select(1);
        closeHistory();
        const before = editor.state.doc.toString();
        const data = new DataTransfer();
        data.setData('text/html', source ?? '');
        data.setData('text/plain', 'plain fallback');
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        editor.view.dom.dispatchEvent(event);
        editor.state.doc.check();
        const doc = editor.state.doc.toString();
        const handled = event.defaultPrevented;
        const undo = editor.commands.undo();
        const restored = editor.state.doc.toString();
        const redo = editor.commands.redo();
        return { doc, handled, undo, restored, before, redo, replayed: editor.state.doc.toString() };
      }, html);
      expect(result.doc).toBe(expected);
      expect(result).toMatchObject({ handled: true, undo: true, redo: true });
      expect(result.restored).toBe(result.before);
      expect(result.replayed).toBe(result.doc);
    }
  });

  test(`${framework} keeps table text after a remote invalid span while cells are selected`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:5895/?framework=${framework}&paste-cleanup=off&unique-id=off`);
    await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
    const result = await page.evaluate(seed => {
      const { editor, select } = (window as unknown as ProbeWindow).__pasteCleanup;
      editor.setContent(seed, false);
      const positions: Record<string, number> = {};
      editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions[node.textContent] = pos; });
      editor.commands.setCellSelection({ anchorCell: positions['a']!, headCell: positions['d']! });
      const before = editor.state.doc.toString();
      const at = positions['b']!;
      editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...editor.state.doc.nodeAt(at)!.attrs, colspan: -1 }).setMeta('addToHistory', false));
      const selectedText = editor.state.selection.$from.parent.textContent;
      select(editor.state.doc.content.size - 1);
      const canRepair = editor.can().fixTables();
      const repaired = editor.commands.fixTables();
      const after = editor.state.doc.toString();
      const normalized = editor.commands.normalizeContentAttributes({ codes: ['unsupported-table-span'] });
      const selectedAgain = editor.commands.setCellSelection({ anchorCell: positions['a']!, headCell: positions['d']! });
      editor.state.doc.check();
      return { before, after, selectedText, canRepair, repaired, normalized, selectedAgain,
        selectedCells: editor.view.dom.querySelectorAll('.selectedCell').length };
    }, grid);
    expect(result.before).toBe(result.after);
    expect(result).toMatchObject({ selectedText: 'd', canRepair: false, repaired: false, normalized: true, selectedAgain: true, selectedCells: 4 });
  });

  test(`${framework} recovers invalid column widths without losing table content`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:5895/?framework=${framework}&paste-cleanup=off&unique-id=off`);
    await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
    const result = await page.evaluate(() => {
      const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
      const content: JSONContent = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{
        type: 'tableHeader', attrs: { colwidth: [NaN, -5] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kept cell' }] }],
      }] }] }] };
      editor.setContent(content, false);
      const cell = editor.state.doc.child(0).child(0).child(0);
      return { width: cell.attrs['colwidth'] as unknown, text: editor.getText(), html: editor.getHTML(),
        widthInPixels: editor.view.dom.querySelector('table')?.getBoundingClientRect().width ?? 0 };
    });
    expect(result.width).toBeNull();
    expect(result.text).toBe('Kept cell');
    expect(result.html).not.toContain('data-colwidth');
    expect(result.widthInPixels).toBeGreaterThan(0);
  });
}
