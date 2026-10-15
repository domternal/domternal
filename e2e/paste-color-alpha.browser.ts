import { expect } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { test } from './fixtures.js';

interface ProbeWindow {
  __pasteCleanup: { ready: boolean; editor: Editor };
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const theme of ['light', 'dark']) {
    for (const formatting of ['preserve', 'adapt']) {
      test(`${framework}: ${formatting} translucent pasted colors in ${theme}`, async ({ page }) => {
        const params = new URLSearchParams({ framework, formatting, theme: '1', 'theme-mode': theme, schema: 'capability-full' });
        await page.goto(`http://127.0.0.1:5895/?${params.toString()}`);
        await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
        const before = await page.evaluate((): JSONContent => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          if (!editor.setContent('<p>Original content</p>', false)) throw new Error('Cannot seed editor');
          editor.commands.selectAll();
          return editor.getJSON();
        });
        await page.evaluate(() => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          const data = new DataTransfer();
          data.setData('text/html', '<p><span style="color:rgba(12,34,56,0.25);background-color:rgba(210,180,150,0.5)">Translucent</span></p>');
          data.setData('text/plain', 'Translucent');
          editor.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        });
        await expect(page.locator('.ProseMirror')).toHaveText('Translucent');
        const painted = await page.evaluate(() => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          const leaf = editor.state.doc.firstChild?.firstChild;
          const attrs = leaf?.marks.find(mark => mark.type.name === 'textStyle')?.attrs;
          const span = editor.view.dom.querySelector('span[style]');
          const color: unknown = attrs?.['color'];
          const background: unknown = attrs?.['backgroundColor'];
          return { color: color ?? null, background: background ?? null,
            renderedColor: span === null ? null : getComputedStyle(span).color,
            renderedBackground: span === null ? null : getComputedStyle(span).backgroundColor };
        });
        expect(painted.color).toBe(formatting === 'preserve' ? 'rgba(12, 34, 56, 0.25)' : null);
        expect(painted.background).toBe(formatting === 'preserve' ? 'rgba(210, 180, 150, 0.5)' : null);
        if (formatting === 'preserve') {
          expect(painted.renderedColor).toBe('rgba(12, 34, 56, 0.25)');
          expect(painted.renderedBackground).toBe('rgba(210, 180, 150, 0.5)');
        }
        const undone = await page.evaluate((): JSONContent => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          if (!editor.commands.undo()) throw new Error('Paste must be undoable');
          return editor.getJSON();
        });
        expect(undone).toEqual(before);
        const roundtrip = await page.evaluate(() => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          if (!editor.commands.redo()) throw new Error('Paste must be redoable');
          editor.commands.selectAll();
          const copied = editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
          const before = editor.getJSON();
          if (!editor.setContent(copied, false)) throw new Error('Cannot reload serialized selection');
          return { before, after: editor.getJSON() };
        });
        expect(roundtrip.after).toEqual(roundtrip.before);
      });
    }
  }
}
