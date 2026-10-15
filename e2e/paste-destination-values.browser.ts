/** Concrete host constraints through real framework wrappers. Clipboard events are synthetic. */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE = process.env['PASTE_VALUES_BASE_URL'] ?? 'http://127.0.0.1:5895';
const WARNING = { code: 'destination-formatting-unconfirmed', severity: 'warning' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
interface FixtureWindow {
  __pasteCleanup: {
    ready: boolean; editor: Editor; results: NormalizePasteHTMLResult[]; operations: PasteOperationResult[];
    clearObservations: () => void;
    pasteProgrammatically: (html: string) => { handled: boolean; error: string | null };
  };
}
async function open(page: Page, framework: string, options: Record<string, string> = {}): Promise<unknown> {
  const query = new URLSearchParams({ framework, schema: 'capability-full', 'destination-values': 'restricted', 'unique-id': 'off', ...options });
  await page.goto(`${BASE}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<FixtureWindow>).__pasteCleanup?.ready);
  return page.evaluate(() => {
    const probe = (window as unknown as FixtureWindow).__pasteCleanup;
    probe.editor.setContent('<p>Before</p>', false); probe.editor.commands.selectAll(); probe.clearObservations();
    return probe.editor.getJSON();
  });
}
async function paste(page: Page, html: string, programmatic = false): Promise<{ normalized: NormalizePasteHTMLResult; applied: PasteOperationResult }> {
  if (programmatic) {
    expect(await page.evaluate(html => (window as unknown as FixtureWindow).__pasteCleanup.pasteProgrammatically(html), html))
      .toEqual({ handled: true, error: null });
  } else {
    expect(await page.evaluate(html => {
      const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', 'Synthetic clipboard');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      (window as unknown as FixtureWindow).__pasteCleanup.editor.view.dom.dispatchEvent(event);
      return { prevented: event.defaultPrevented, trusted: event.isTrusted };
    }, html)).toEqual({ prevented: true, trusted: false });
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.operations.length)).toBe(1);
  return page.evaluate(() => {
    const probe = (window as unknown as FixtureWindow).__pasteCleanup;
    if (probe.results.length !== 1 || probe.operations.length !== 1) throw new Error('Expected one result per paste phase');
    const normalized = probe.results[0]; const applied = probe.operations[0];
    if (normalized === undefined || applied === undefined) throw new Error('Missing paste result');
    return { normalized, applied };
  });
}
async function history(page: Page, before: unknown): Promise<void> {
  const after = await page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.editor.getJSON());
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.editor.getJSON())).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.editor.commands.redo())).toBe(true);
  expect(await page.evaluate(() => (window as unknown as FixtureWindow).__pasteCleanup.editor.getJSON())).toEqual(after);
}
for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test.describe(`${framework}: actual destination values`, () => {
    for (const route of ['native', 'programmatic', 'images'] as const) {
      test(`reports a concrete value rejected after reference probes pass through ${route}`, async ({ page }) => {
        const before = await open(page, framework, route === 'images' ? { assets: 'embedded' } : {});
        const html = '<p><span style="font-size:32px">Private text</span></p><p style="line-height:1.7">Spacing</p>'
          + (route === 'images' ? `<p><img src="${PNG}" alt="Chart"></p>` : '');
        const result = await paste(page, html, route === 'programmatic');
        expect(result.normalized.status).toBe('cleaned'); expect(result.applied.status).toBe('applied');
        expect(result.normalized.html).toContain('font-size:32px');
        expect(result.normalized.diagnostics).toEqual([WARNING]); expect(result.applied.diagnostics).toEqual([WARNING]);
        expect(JSON.stringify(result.applied.diagnostics)).not.toMatch(/Private|32px|1.7|data:image/u);
        await expect(page.locator('.ProseMirror')).toContainText('Private text');
        await expect(page.locator('.ProseMirror [style*="font-size"]')).toHaveCount(0);
        await expect(page.locator('.ProseMirror [style*="line-height"]')).toHaveCount(0);
        await expect(page.locator('.ProseMirror img')).toHaveCount(route === 'images' ? 1 : 0);
        const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
        await notice.locator('summary').click(); await expect(notice).toContainText('This editor may not preserve some pasted formatting.');
        await history(page, before);
      });
    }
    test('checks the actual heading context even when paragraphs support the alignment', async ({ page }) => {
      const before = await open(page, framework);
      const result = await paste(page, '<h2 style="text-align:center">Heading</h2>');
      expect(result.applied.diagnostics).toEqual([WARNING]);
      await expect(page.locator('.ProseMirror h2')).toHaveText('Heading');
      expect(await page.locator('.ProseMirror h2').evaluate(element => (element as HTMLElement).style.textAlign)).toBe('');
      await history(page, before);
    });
    test('keeps supported concrete values without an uncertainty warning', async ({ page }) => {
      const before = await open(page, framework);
      const result = await paste(page, '<p style="text-align:center;line-height:1.5"><span style="font-size:22px">Retained</span></p>');
      expect(result.applied.diagnostics).toEqual([]);
      await expect(page.locator('.ProseMirror span[style*="font-size"]')).toHaveCSS('font-size', '22px');
      expect(await page.locator('.ProseMirror p').evaluate(element => ({ align: (element as HTMLElement).style.textAlign,
        height: (element as HTMLElement).style.lineHeight }))).toEqual({ align: 'center', height: '1.5' });
      await history(page, before);
    });
    test('does not report intentional Adapt removal as an uncertain destination', async ({ page }) => {
      const before = await open(page, framework, { formatting: 'adapt' });
      const result = await paste(page, '<p style="line-height:1.7"><span style="font-size:32px">Adapted</span></p>');
      expect(result.applied.diagnostics.map(value => value.code)).toEqual(['formatting-adapted', 'formatting-adapted']);
      await expect(page.locator('.ProseMirror')).toHaveText('Adapted');
      await history(page, before);
    });
  });
}
