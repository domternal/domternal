/**
 * Public-build behavior for image-free preflight reuse and the earlier host-transform fallback.
 * Exact normalization call counts are unit tested without adding instrumentation to the product.
 * These synthetic Word-shaped inputs exercise content, reports and history in real wrappers.
 */
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
    preparationProgress: unknown[];
    assetMatchRequests: unknown[];
    assetHookCalls: { html: number; slice: number; handle: number };
    assetUploads: number;
    clearObservations(): void;
  };
}

const PARAGRAPHS = 240;
const HTML = '<meta name="Generator" content="Microsoft Word 16"><h5>Document heading</h5>'
  + Array.from({ length: PARAGRAPHS }, (_, index) => `<p class="MsoNormal">Section ${String(index)} <strong>important</strong> &amp; &lt;tag&gt;</p>`).join('')
  + '<ol start="7"><li><p>Seven</p></li><li><p>Eight</p></li></ol>';

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
  for (const host of [false, true]) {
    test(`${framework}: large image-free paste ${host ? 'after an earlier host transform' : 'with preflight reuse'}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => { errors.push(error.message); });
      const query = new URLSearchParams({ framework, assets: 'embedded', schema: 'heading-levels' });
      if (host) query.set('asset-transform', 'prefix');
      else query.set('asset-hooks', 'off');
      await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
      await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent('<p>Original content</p>', false)) throw new Error('Cannot seed editor');
        probe.editor.commands.selectAll();
        probe.clearObservations();
      });
      const before = await snapshot(page);
      await paste(page, HTML);
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
      const actual = await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        const blocks: { type: string; text: string; level: unknown; start: unknown }[] = [];
        probe.editor.state.doc.forEach(node => {
          blocks.push({ type: node.type.name, text: node.textContent, level: node.attrs['level'] ?? null, start: node.attrs['start'] ?? null });
        });
        return { blocks, results: probe.results, operations: probe.operations, progress: probe.preparationProgress,
          matches: probe.assetMatchRequests, hooks: probe.assetHookCalls, uploads: probe.assetUploads };
      });
      expect(actual.blocks).toEqual([
        ...(host ? [{ type: 'paragraph', text: 'Host prefix', level: null, start: null }] : []),
        { type: 'heading', text: 'Document heading', level: 3, start: null },
        ...Array.from({ length: PARAGRAPHS }, (_, index) => ({ type: 'paragraph', text: `Section ${String(index)} important & <tag>`, level: null, start: null })),
        { type: 'orderedList', text: 'SevenEight', level: null, start: 7 },
      ]);
      expect(actual.results).toHaveLength(1);
      expect(actual.results[0]).toMatchObject({ status: 'cleaned', source: 'word', diagnosticsTruncated: false });
      expect(actual.operations[0]).toMatchObject({ status: 'applied', source: 'word', diagnosticsTruncated: false });
      expect(actual.operations[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'destination-heading-level-adapted' }));
      expect(actual.hooks).toEqual({ html: host ? 1 : 0, slice: host ? 1 : 0, handle: host ? 1 : 0 });
      expect(actual.progress).toEqual([]);
      expect(actual.matches).toEqual([]);
      expect(actual.uploads).toBe(0);
      await expect(page.locator('.ProseMirror strong')).toHaveCount(PARAGRAPHS);
      const after = await snapshot(page);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo()) throw new Error('Paste must be undoable');
      });
      expect(await snapshot(page)).toEqual(before);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo()) throw new Error('Paste must be redoable');
      });
      expect(await snapshot(page)).toEqual(after);

      // A subsequent attempt must neither reuse the previous tree nor keep its diagnostics.
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        probe.editor.commands.selectAll();
        probe.clearObservations();
      });
      await paste(page, '<p>Following paste</p>');
      await expect(page.locator('.ProseMirror')).toHaveText(host ? 'Host prefixFollowing paste' : 'Following paste');
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
      const following = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations[0]);
      expect(following).toMatchObject({ status: 'applied', diagnostics: [], diagnosticsTruncated: false });
      expect(errors).toEqual([]);
    });
  }
}
