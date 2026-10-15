/** Application-owned formatting choices through every real framework wrapper. */
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteNormalizationContext, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface Snapshot { doc: JSONContent; selection: unknown }
interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    formattingChoices: number;
    results: (NormalizePasteHTMLResult & PasteNormalizationContext)[];
    operations: PasteOperationResult[];
    assetReads: number;
    setAssetBindings(bindings: { reference: string; itemIndex: number }[]): void;
    holdAssetReads(): void;
    releaseAssetReads(): Promise<void>;
    clearObservations(): void;
  };
}
const source = '<p><strong><span style="font-family:Georgia;font-size:18px;color:#ff0000">Source formatting</span></strong></p>';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((): Snapshot => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
  });
}

async function paste(page: Page, route: 'text' | 'prepared-text' | 'programmatic' | 'async-image'): Promise<void> {
  await page.evaluate(({ route, source, png }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (route === 'programmatic') { probe.editor.view.pasteHTML(source); return; }
    const html = source + (route === 'async-image' ? '<p><img src="cid:chart" alt="Chart"></p>' : '');
    const data = new DataTransfer();
    data.setData('text/html', html);
    if (route === 'async-image') {
      const index = data.items.length;
      data.items.add(new File([Uint8Array.from(atob(png), value => value.charCodeAt(0))], 'chart.png', { type: 'image/png' }));
      probe.setAssetBindings([{ reference: 'cid:chart', itemIndex: index }]);
      probe.holdAssetReads();
    }
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    probe.editor.view.dom.dispatchEvent(event);
  }, { route, source, png });
}

async function inspect(page: Page): Promise<{ text: string; color: unknown; font: unknown; size: unknown; bold: boolean }[]> {
  return page.evaluate(() => {
    const runs: { text: string; color: unknown; font: unknown; size: unknown; bold: boolean }[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (!node.isText) return;
      const style = node.marks.find(mark => mark.type.name === 'textStyle')?.attrs;
      runs.push({ text: node.text ?? '', color: style?.['color'] ?? null, font: style?.['fontFamily'] ?? null,
        size: style?.['fontSize'] ?? null, bold: node.marks.some(mark => mark.type.name === 'bold') });
    });
    return runs;
  });
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const route of ['text', 'prepared-text', 'programmatic', 'async-image'] as const) {
    test(`${framework}: host formatting choice survives ${route}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => { errors.push(error.message); });
      const query = new URLSearchParams({ framework, 'formatting-choice': 'on', assets: route === 'text' ? 'off' : 'embedded',
        'asset-hooks': 'off', theme: '1', 'theme-mode': route === 'async-image' ? 'dark' : 'light' });
      await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
      await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
      const choice = page.getByLabel('Paste formatting');
      await expect(choice).toHaveValue('preserve');
      await choice.selectOption('adapt');
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent('<p>Before</p>', false)) throw new Error('Cannot seed editor');
        probe.editor.commands.selectAll();
        probe.clearObservations();
      });
      const before = await snapshot(page);
      await paste(page, route);
      if (route === 'async-image') {
        await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.assetReads)).toBe(1);
        expect((await snapshot(page)).doc).toEqual(before.doc);
        await choice.selectOption('preserve');
        await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseAssetReads(); });
      }
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
      expect(await inspect(page)).toEqual([{ text: 'Source formatting', color: null, font: null, size: null, bold: true }]);
      const observed = await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        return { choices: probe.formattingChoices, results: probe.results, operations: probe.operations };
      });
      expect(observed.choices).toBe(1);
      expect(observed.results).toHaveLength(1);
      expect(observed.results[0]).toMatchObject({ status: 'cleaned', formatting: 'adapt' });
      expect(observed.operations[0]).toMatchObject({ status: 'applied', formatting: 'adapt' });
      if (route === 'async-image') await expect(page.locator('.ProseMirror img')).toHaveAttribute('alt', 'Chart');
      const after = await snapshot(page);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo()) throw new Error('Paste must be undoable');
      });
      expect(await snapshot(page)).toEqual(before);
      await page.evaluate(() => {
        if (!(window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo()) throw new Error('Paste must be redoable');
      });
      expect(await snapshot(page)).toEqual(after);
      await choice.selectOption('preserve');
      await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.selectAll(); });
      await paste(page, 'programmatic');
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(2);
      expect(await inspect(page)).toEqual([{ text: 'Source formatting', color: '#ff0000', font: 'Georgia', size: '18px', bold: true }]);
      const settled = await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        return { choices: probe.formattingChoices, result: probe.results[1], operation: probe.operations[1] };
      });
      expect(settled.choices).toBe(2);
      expect(settled.result).toMatchObject({ formatting: 'preserve' });
      expect(settled.operation).toMatchObject({ status: 'applied', formatting: 'preserve' });
      expect(errors).toEqual([]);
    });
  }
}
