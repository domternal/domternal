/** Word class typography through framework wrappers, real CSS rendering and clipboard history. */
import { expect } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor } }
const HTML = '<html xmlns:w="urn:schemas-microsoft-com:office:word"><style>'
  + 'p.MsoNormal{font-family:Arial,sans-serif;font-size:12pt;color:#123456}'
  + '.Accent{font-family:Georgia,serif;font-size:150%;color:#c02040!important}'
  + '.Accent{color:blue}.Explicit{font-size:10pt}'
  + '</style><p class="MsoNormal">Base <span class="Accent" style="color:green">Accent</span>'
  + ' <span class="Explicit" style="font-size:18pt;color:#234567!important">Explicit</span></p></html>';

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const formatting of ['preserve', 'adapt']) {
    test(`${framework}: ${formatting} Word class typography, cascade and history`, async ({ page }) => {
      const params = new URLSearchParams({ framework, formatting, schema: 'capability-full' });
      await page.goto(`http://127.0.0.1:5895/?${params.toString()}`);
      await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
      const before = await page.evaluate((): JSONContent => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        if (!editor.setContent('<p>Before paste</p>', false)) throw new Error('Cannot seed editor');
        editor.commands.selectAll();
        return editor.getJSON();
      });
      await page.evaluate(html => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'Base Accent Explicit');
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        editor.view.dom.dispatchEvent(event);
      }, HTML);
      await expect(page.locator('.ProseMirror')).toHaveText('Base Accent Explicit');
      const actual = await page.evaluate(() => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        const runs: { text: string; family: unknown; size: unknown; color: unknown }[] = [];
        editor.state.doc.descendants(node => {
          if (!node.isText) return;
          const attrs = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs;
          runs.push({ text: node.text ?? '', family: attrs?.['fontFamily'] ?? null, size: attrs?.['fontSize'] ?? null, color: attrs?.['color'] ?? null });
        });
        const rendered = Array.from(editor.view.dom.querySelectorAll('span[style]')).map(element => ({
          text: element.textContent, size: getComputedStyle(element).fontSize, color: getComputedStyle(element).color,
        }));
        return { runs, rendered, doc: editor.getJSON() };
      });
      if (formatting === 'preserve') {
        expect(actual.runs).toEqual([
          { text: 'Base ', family: 'Arial, sans-serif', size: '12pt', color: '#123456' },
          { text: 'Accent', family: 'Georgia, serif', size: '18pt', color: '#c02040' },
          { text: ' ', family: 'Arial, sans-serif', size: '12pt', color: '#123456' },
          { text: 'Explicit', family: 'Arial, sans-serif', size: '18pt', color: '#234567' },
        ]);
        expect(actual.rendered).toContainEqual({ text: 'Accent', size: '24px', color: 'rgb(192, 32, 64)' });
      } else {
        expect(actual.runs).toEqual([{ text: 'Base Accent Explicit', family: null, size: null, color: null }]);
      }
      const undone = await page.evaluate((): JSONContent => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        if (!editor.commands.undo()) throw new Error('Paste is not undoable');
        return editor.getJSON();
      });
      expect(undone).toEqual(before);
      const redone = await page.evaluate((): JSONContent => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        if (!editor.commands.redo()) throw new Error('Paste is not redoable');
        return editor.getJSON();
      });
      expect(redone).toEqual(actual.doc);
    });
  }
}
