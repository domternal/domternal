import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface ProbeWindow {
  __pasteCleanup: { ready: boolean; editor: Editor; operations: PasteOperationResult[]; clearObservations(): void };
}
interface Snapshot { doc: JSONContent; selection: unknown }
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
  });
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) for (const formatting of ['preserve', 'adapt']) {
  test(`${framework}: pasted zero-based list preserves counters and history in ${formatting} mode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(error.message); });
    const query = new URLSearchParams({ framework, formatting, assets: 'embedded', 'asset-hooks': 'off' });
    await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
    await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      probe.editor.setContent('<p>Original content</p>', false);
      probe.editor.commands.selectAll(); probe.clearObservations();
    });
    const before = await snapshot(page);
    const prevented = await page.evaluate(() => {
      const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
      const data = new DataTransfer();
      data.setData('text/html', '<ol start="0"><li><p class="MsoNormal">Zero</p></li><li><p class="MsoNormal">One</p></li></ol>');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      editor.view.dom.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
    await expect(page.locator('.ProseMirror > ol')).toHaveAttribute('start', '0');
    await expect(page.locator('.ProseMirror > ol > li')).toHaveText(['Zero', 'One']);
    const after = await snapshot(page);
    expect(after.doc.content).toHaveLength(1);
    expect(after.doc.content?.[0]).toMatchObject({ type: 'orderedList', attrs: { start: 0 } });
    const report = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations[0]);
    expect(report).toMatchObject({ status: 'applied', diagnostics: [], diagnosticsTruncated: false });
    await page.evaluate(() => {
      if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo()) throw new Error('Paste must be undoable');
    });
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(() => {
      if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo()) throw new Error('Paste must be redoable');
    });
    expect(await snapshot(page)).toEqual(after);
    const reloaded = await page.evaluate(() => {
      const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
      const html = editor.getHTML(); editor.setContent(html, false);
      return { html, start: editor.state.doc.firstChild?.attrs['start'], text: editor.state.doc.textContent };
    });
    expect(reloaded.html).toContain('start="0"');
    expect(reloaded.start).toBe(0); expect(reloaded.text).toBe('ZeroOne');
    expect(errors).toEqual([]);
  });
}
