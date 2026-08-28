/** Synthetic clipboard assets through public builds and all framework wrappers. */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteNormalizationContext, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const PNG_URL = `data:image/png;base64,${PNG}`;
const MIXED_HTML = '<p class="MsoNormal"><strong>New</strong></p><img src="cid:private-chart" alt="Chart"><p>End</p>';

interface Snapshot { doc: unknown; selection: unknown }
interface Observations {
  results: (NormalizePasteHTMLResult & PasteNormalizationContext)[];
  operations: PasteOperationResult[];
  preparationProgress: { operationId: string; phase: 'preparing' }[];
  assetReads: number;
  assetUploads: number;
  assetHookCalls: { html: number; slice: number; handle: number };
}
interface ProbeWindow {
  __pasteCleanup: Observations & {
    ready: boolean;
    editor: Editor;
    setAssetBindings(bindings: { reference: string; itemIndex: number }[]): void;
    holdAssetReads(): void;
    releaseAssetReads(): Promise<void>;
    cancelPreparation(): void;
    changeImagePolicy(allow: boolean): void;
    clearObservations(): void;
    history(): { undo: number; redo: number };
    select(from: number, to?: number): void;
    snapshot(): Snapshot;
    useGerman(): Promise<void>;
  };
}

async function open(page: Page, framework: string, options: Record<string, string> = {}): Promise<Snapshot> {
  const query = new URLSearchParams({ framework, assets: 'embedded', ...options });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent('<p>Before old after</p>', false)) throw new Error('Could not seed editor');
    probe.editor.commands.focus();
    probe.select(8, 11);
    probe.clearObservations();
    return probe.snapshot();
  });
}

async function paste(page: Page, options: {
  html?: string;
  text?: string;
  files?: number;
  match?: boolean;
  hold?: boolean;
  invalid?: boolean;
  route?: 'native' | 'programmatic';
} = {}): Promise<void> {
  await page.evaluate(({ options, png, mixed }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const html = options.html ?? mixed;
    const data = new DataTransfer();
    if (html !== '') data.setData('text/html', html);
    if ((options.text ?? 'New') !== '') data.setData('text/plain', options.text ?? 'New');
    const binary = atob(png);
    const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
    if (options.invalid === true) bytes.fill(0);
    const indices: number[] = [];
    for (let index = 0; index < (options.files ?? 1); index++) {
      indices.push(data.items.length);
      data.items.add(new File([bytes], `private-source-${String(index)}.png`, { type: 'image/png' }));
    }
    const firstIndex = indices[0];
    probe.setAssetBindings(options.match === false || firstIndex === undefined ? [] : [
      { reference: 'cid:private-chart', itemIndex: firstIndex },
      { reference: 'cid:private-repeat', itemIndex: firstIndex },
    ]);
    if (options.hold === true) probe.holdAssetReads();
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    if (options.route === 'programmatic') probe.editor.view.pasteHTML(html, event);
    else probe.editor.view.dom.dispatchEvent(event);
  }, { options, png: PNG, mixed: MIXED_HTML });
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}
function observations(page: Page): Promise<Observations> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return { results: probe.results, operations: probe.operations, preparationProgress: probe.preparationProgress,
      assetReads: probe.assetReads, assetUploads: probe.assetUploads, assetHookCalls: probe.assetHookCalls };
  });
}
async function terminal(page: Page, count = 1): Promise<PasteOperationResult> {
  await expect.poll(async () => (await observations(page)).operations.length).toBe(count);
  const result = (await observations(page)).operations[count - 1];
  if (result === undefined) throw new Error('Missing terminal paste receipt');
  return result;
}
async function pending(page: Page): Promise<void> {
  await expect.poll(async () => (await observations(page)).assetReads).toBe(1);
  await expect(page.getByRole('button', { name: 'Cancel image preparation', exact: true })).toBeVisible();
}
async function release(page: Page): Promise<void> {
  await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseAssetReads(); });
}
async function undoRedo(page: Page, before: Snapshot, after: Snapshot): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  await expect.poll(() => snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo())).toBe(true);
  await expect.poll(() => snapshot(page)).toEqual(after);
}

for (const framework of FRAMEWORKS) {
  test.describe(`${framework}: clipboard image preparation`, () => {
    for (const route of ['native', 'programmatic'] as const) {
      test(`${route}: resolves explicit file placement once with exact Undo and Redo`, async ({ page }) => {
        const before = await open(page, framework);
        const external: string[] = [];
        page.on('request', request => { if (request.url().includes('paste-probe.invalid')) external.push(request.url()); });
        await paste(page, { route, hold: true });
        await pending(page);
        expect(await snapshot(page)).toEqual(before);
        expect((await observations(page)).operations).toEqual([]);
        expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });
        await release(page);
        const result = await terminal(page);
        expect(result.status).toBe('applied');
        await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', PNG_URL);
        await expect(page.locator('.ProseMirror strong')).toHaveText('New');
        const observed = await observations(page);
        expect(observed.assetReads).toBe(1);
        expect(observed.assetUploads).toBe(0);
        expect(observed.assetHookCalls).toEqual({ html: 1, slice: 1, handle: 1 });
        expect(observed.results).toHaveLength(1);
        expect(observed.results[0]?.operationId).toBe(result.operationId);
        expect(observed.preparationProgress).toEqual([{ operationId: result.operationId, phase: 'preparing' }]);
        expect(JSON.stringify(result)).not.toContain('private-chart');
        expect(JSON.stringify(result)).not.toContain('private-source');
        expect(external).toEqual([]);
        await expect(page.getByRole('button', { name: 'Cancel image preparation', exact: true })).toHaveCount(0);
        await undoRedo(page, before, await snapshot(page));
        expect((await observations(page)).operations).toHaveLength(1);
      });
    }

    test('keeps repeated explicit placements while reading one file', async ({ page }) => {
      await open(page, framework);
      await paste(page, { html: '<p>Images</p><img src="cid:private-chart"><img src="cid:private-repeat">' });
      expect((await terminal(page)).status).toBe('applied');
      await expect(page.locator('.ProseMirror img')).toHaveCount(2);
      expect((await observations(page)).assetReads).toBe(1);
      expect((await observations(page)).assetUploads).toBe(0);
    });

    test('pastes image-only clipboard files without invoking upload handlers', async ({ page }) => {
      const before = await open(page, framework);
      await paste(page, { html: '', text: '', files: 2 });
      expect((await terminal(page)).status).toBe('applied');
      await expect(page.locator('.ProseMirror img')).toHaveCount(2);
      expect((await observations(page)).assetUploads).toBe(0);
      await undoRedo(page, before, await snapshot(page));
    });

    test('does not append clipboard files already represented by a data image', async ({ page }) => {
      await open(page, framework);
      await paste(page, { html: `<p>Existing</p><img src="${PNG_URL}">` });
      expect((await terminal(page)).status).toBe('applied');
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      expect((await observations(page)).assetReads).toBe(0);
      expect((await observations(page)).assetUploads).toBe(0);
    });

    test('cancels pending work without placeholders, history entries or late insertion', async ({ page }) => {
      const before = await open(page, framework);
      await paste(page, { hold: true });
      await pending(page);
      await page.getByRole('button', { name: 'Cancel image preparation', exact: true }).click();
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'cancelled' });
      await release(page);
      expect(await snapshot(page)).toEqual(before);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toHaveCount(0);
      expect((await observations(page)).operations).toHaveLength(1);
    });

    for (const mutation of ['document-undo', 'selection-restore', 'read-only', 'image-policy'] as const) {
      test(`rejects a stale target after ${mutation}`, async ({ page }) => {
        const before = await open(page, framework);
        await paste(page, { hold: true });
        await pending(page);
        await page.evaluate(mutation => {
          const probe = (window as unknown as ProbeWindow).__pasteCleanup;
          if (mutation === 'document-undo') {
            probe.editor.view.dispatch(probe.editor.state.tr.insertText('Changed'));
            probe.editor.commands.undo();
          } else if (mutation === 'selection-restore') { probe.select(1); probe.select(8, 11); }
          else if (mutation === 'read-only') probe.editor.setEditable(false);
          else probe.changeImagePolicy(false);
        }, mutation);
        await release(page);
        expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'target-changed' });
        expect((await snapshot(page)).doc).toEqual(before.doc);
        await expect(page.locator('.ProseMirror img')).toHaveCount(0);
        expect((await observations(page)).assetUploads).toBe(0);
      });
    }

    test('lets a newer plain paste win over a pending image paste', async ({ page }) => {
      await open(page, framework);
      await paste(page, { hold: true });
      await pending(page);
      await paste(page, { html: '<p>Latest</p>', text: 'Latest', files: 0 });
      await terminal(page, 2);
      await release(page);
      const observed = await observations(page);
      expect(observed.operations.map(result => result.status).sort()).toEqual(['applied', 'rejected']);
      expect(observed.operations.find(result => result.status === 'rejected')?.reason).toBe('superseded');
      await expect(page.locator('.ProseMirror')).toHaveText('Before Latest after');
      await expect(page.locator('.ProseMirror img')).toHaveCount(0);
      expect(observed.assetUploads).toBe(0);
    });

    test('rejects unknown image associations without reading or losing selected content', async ({ page }) => {
      const before = await open(page, framework);
      await paste(page, { match: false });
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'assets-unavailable' });
      expect(await snapshot(page)).toEqual(before);
      expect((await observations(page)).assetReads).toBe(0);
    });

    test('reports an explicitly permitted image omission while inserting the text', async ({ page }) => {
      await open(page, framework, { unresolved: 'omit' });
      await paste(page, { match: false });
      const result = await terminal(page);
      expect(result.status).toBe('applied');
      expect(result.diagnostics.some(diagnostic => diagnostic.code === 'image-removed')).toBe(true);
      await expect(page.locator('.ProseMirror strong')).toHaveText('New');
      await expect(page.locator('.ProseMirror img')).toHaveCount(0);
      expect((await observations(page)).assetReads).toBe(0);
    });

    test('honors earlier HTML transformations once during prepared replay', async ({ page }) => {
      await open(page, framework, { 'asset-transform': 'prefix' });
      await paste(page);
      expect((await terminal(page)).status).toBe('applied');
      await expect(page.locator('.ProseMirror')).toContainText('Host prefix');
      expect((await observations(page)).assetHookCalls).toEqual({ html: 1, slice: 1, handle: 1 });
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
    });
  });
}

test.describe('clipboard image preparation boundaries', () => {
  test('updates pending translations and keeps cancellation distinct from dismissal', async ({ page }) => {
    await open(page, 'vanilla');
    await paste(page, { hold: true });
    await pending(page);
    await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.useGerman(); });
    const cancel = page.getByRole('button', { name: 'Bildvorbereitung abbrechen', exact: true });
    await expect(cancel).toBeVisible();
    await cancel.focus();
    await page.keyboard.press('Escape');
    await expect(cancel).toHaveCount(0);
    expect((await observations(page)).operations).toEqual([]);
    await release(page);
    expect((await terminal(page)).status).toBe('applied');
    await expect(page.locator('.ProseMirror img')).toHaveCount(1);
  });

  for (const policy of ['missing', 'no-base64']) {
    test(`rejects ${policy} image destination before file reads`, async ({ page }) => {
      const before = await open(page, 'vanilla', { 'image-policy': policy });
      await paste(page);
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'unsupported-destination' });
      expect(await snapshot(page)).toEqual(before);
      expect((await observations(page)).assetReads).toBe(0);
      expect((await observations(page)).assetUploads).toBe(0);
    });
  }

  test('enforces the configured byte allowance before reading a file', async ({ page }) => {
    const before = await open(page, 'vanilla', { 'asset-limits': 'small' });
    await paste(page);
    expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'asset-limit' });
    expect(await snapshot(page)).toEqual(before);
    expect((await observations(page)).assetReads).toBe(0);
  });

  test('rejects a misleading image MIME type after inspecting its bytes', async ({ page }) => {
    const before = await open(page, 'vanilla');
    await paste(page, { invalid: true });
    expect((await terminal(page)).status).toBe('rejected');
    expect(await snapshot(page)).toEqual(before);
    expect((await observations(page)).assetReads).toBe(1);
    expect((await observations(page)).assetUploads).toBe(0);
  });

  for (const lifecycle of ['veto', 'throw-update']) {
    test(`keeps an honest receipt when a host uses ${lifecycle}`, async ({ page }) => {
      const before = await open(page, 'vanilla', { lifecycle });
      await paste(page);
      const result = await terminal(page);
      if (lifecycle === 'veto') {
        expect(result.status).toBe('untracked');
        expect(await snapshot(page)).toEqual(before);
      } else {
        expect(result.status).toBe('applied');
        await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      }
      expect((await observations(page)).assetUploads).toBe(0);
      expect((await observations(page)).operations).toHaveLength(1);
    });
  }
});
