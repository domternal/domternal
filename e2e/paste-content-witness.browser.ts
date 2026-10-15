/** Real wrapper integration for diagnostics from accepted appended formatting changes. */
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface Snapshot { doc: JSONContent; selection: unknown }
interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    results: NormalizePasteHTMLResult[];
    operations: PasteOperationResult[];
    clearObservations(): void;
  };
}
const source = '<p><strong>Retained source</strong></p>';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const loss = { code: 'destination-formatting-removed', severity: 'warning' };

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((): Snapshot => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
  });
}

async function paste(page: Page, html: string): Promise<void> {
  const prevented = await page.evaluate(html => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const data = new DataTransfer();
    data.setData('text/html', html);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  }, html);
  expect(prevented).toBe(true);
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const route of ['text', 'embedded-image', 'veto', 'restore', 'replace'] as const) {
    test(`${framework}: accepted formatting evidence with ${route}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => { errors.push(error.message); });
      const mode = route === 'text' || route === 'embedded-image' ? 'remove' : route;
      const query = new URLSearchParams({ framework, assets: 'embedded', 'asset-hooks': 'off', 'formatting-normalizer': mode });
      await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
      await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent('<p>Original content</p>', false)) throw new Error('Cannot seed editor');
        probe.editor.commands.selectAll();
        probe.clearObservations();
      });
      const before = await snapshot(page);
      await paste(page, source + (route === 'embedded-image' ? `<p><img src="${image}" alt="Chart"></p>` : ''));
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
      const actual = await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        return { results: probe.results, operations: probe.operations, text: probe.editor.state.doc.textContent };
      });
      const removed = route === 'text' || route === 'embedded-image';
      expect(actual.text).toBe(route === 'embedded-image' ? 'Retained sourceChart' : 'Retained source');
      expect(actual.results).toHaveLength(1);
      expect(actual.results[0]).toMatchObject({ status: 'cleaned', diagnostics: [], diagnosticsTruncated: false });
      expect(actual.operations[0]).toMatchObject({ status: 'applied', diagnostics: removed ? [loss] : [], diagnosticsTruncated: false });
      expect(JSON.stringify(actual.operations)).not.toContain('Retained source');
      await expect(page.locator('.ProseMirror strong')).toHaveCount(route === 'veto' || route === 'restore' ? 1 : 0);
      const notice = page.locator('.dm-paste-feedback');
      if (removed) {
        await expect(notice).toBeVisible();
        await expect(notice.locator('.dm-paste-feedback__status')).toHaveText('Review the pasted content.');
        await expect(notice).toContainText("Some retained paste formatting was removed during this editor's final processing.");
      } else await expect(notice).toBeHidden();
      if (route === 'embedded-image') {
        await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', image);
        await expect(page.locator('.ProseMirror img')).toHaveAttribute('alt', 'Chart');
      }
      const after = await snapshot(page);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo()) throw new Error('Paste must be undoable');
      });
      expect(await snapshot(page)).toEqual(before);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo()) throw new Error('Paste must be redoable');
      });
      expect(await snapshot(page)).toEqual(after);
      const settled = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations);
      expect(settled).toEqual(actual.operations);
      expect(errors).toEqual([]);
    });
  }
}
