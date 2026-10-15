import { expect } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor; select: (from: number, to?: number) => void } }
const grid = '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table><p>after</p>';

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
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
