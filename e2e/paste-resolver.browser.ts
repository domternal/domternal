/** Synthetic resolver callbacks and ClipboardEvents, with no upload or native Office provenance. */
import { expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import type { Editor, JSONContent } from '@domternal/core';
import type { ClipboardAssetRecoveryReport, NormalizePasteHTMLResult, PasteNormalizationContext, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const ORIGIN = 'http://127.0.0.1:5895';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const PNG_DATA = `data:image/png;base64,${PNG}`;
const PNG_BYTES = Buffer.from(PNG, 'base64').length;
const PNG_SHA256 = createHash('sha256').update(Buffer.from(PNG, 'base64')).digest('hex');
const HTML = '<p class="MsoNormal"><strong>New</strong></p><img src="cid:private-chart" alt="Chart"><p>End</p>';
const INLINE_HTML = HTML.replace('cid:private-chart', PNG_DATA);

// A valid ancillary chunk gives the second one-pixel PNG different bytes.
function distinctPNG(): string {
  const original = Buffer.from(PNG, 'base64');
  const content = Buffer.from('tEXtComment\0Second synthetic image');
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(content.length - 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([original.subarray(0, -12), length, content, checksum, original.subarray(-12)]).toString('base64');
}

interface Snapshot { doc: unknown; selection: unknown }

function expectedAppliedSnapshot(src: string): Snapshot {
  // SmartPaste splits the selected paragraph around a slice containing a block
  // image and inserts its complete sibling blocks. Generated IDs remain variable.
  return {
    doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'left', id: expect.any(String) }, content: [{ type: 'text', text: 'Before ' }] },
        { type: 'paragraph', attrs: { textAlign: 'left', id: expect.any(String) },
          content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'New' }] },
        { type: 'image', attrs: { src, alt: 'Chart', title: null, width: null, height: null,
          loading: null, crossorigin: null, float: 'none', align: 'none', id: expect.any(String) } },
        { type: 'paragraph', attrs: { textAlign: 'left', id: expect.any(String) },
          content: [{ type: 'text', text: 'End' }] },
        { type: 'paragraph', attrs: { textAlign: 'left', id: expect.any(String) }, content: [{ type: 'text', text: ' after' }] },
      ],
    },
    selection: { type: 'text', anchor: 19, head: 19 },
  };
}

interface Observations {
  results: (NormalizePasteHTMLResult & PasteNormalizationContext)[];
  operations: PasteOperationResult[];
  assetReads: number;
  assetUploads: number;
  assetHookCalls: { html: number; slice: number; handle: number };
  assetMatchRequests: { references: { placementId: string; rawReference: string }[] }[];
  resolverCalls: { operationId: string; assetId: string; idempotencyKey: string; mimeType: string; bytes: number }[];
  resolverBlobEvidence: { assetId: string; blobType: string; byteLength: number; base64: string; sha256: string }[];
  resolverRegistrations: { assetId: string; accepted: boolean }[];
  resolverReleases: { operationId: string; assetId: string; idempotencyKey: string; handle: string }[];
  resolverSettlements: number;
  cleanupSettlements: number;
  recoveryReports: ClipboardAssetRecoveryReport[];
  resolverObserverThrows: { update: number; terminal: number };
}
type Hold = 'before-creation' | 'after-creation' | 'cleanup';
interface ProbeWindow {
  __pasteCleanup: Observations & {
    ready: boolean;
    editor: Editor;
    setAssetBindings(bindings: { reference: string; itemIndex: number }[]): void;
    holdResolver(stage: Hold): void;
    releaseResolver(): Promise<void>;
    releaseResolverCleanup(): Promise<void>;
    cancelPreparation(): void;
    changeImagePolicy(allow: boolean): void;
    clearObservations(): void;
    history(): { undo: number; redo: number };
    select(from: number, to?: number): void;
    snapshot(): Snapshot;
  };
}

async function open(page: Page, framework: string, options: Record<string, string> = {}): Promise<Snapshot> {
  await page.route(`${ORIGIN}/__resolver-images__/**`, route => route.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') }));
  await page.route('https://paste-probe.invalid/**', route => route.abort());
  const query = new URLSearchParams({ framework, assets: 'resolver', 'image-policy': 'no-base64', ...options });
  await page.goto(`${ORIGIN}/?${query.toString()}`);
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
  html?: string; text?: string; files?: number; distinct?: boolean;
  route?: 'native' | 'programmatic'; hold?: Hold;
} = {}): Promise<void> {
  await page.evaluate(({ options, png, secondPNG, htmlDefault }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const html = options.html ?? htmlDefault;
    const data = new DataTransfer();
    if (html !== '') data.setData('text/html', html);
    if ((options.text ?? 'New') !== '') data.setData('text/plain', options.text ?? 'New');
    const indices: number[] = [];
    for (let index = 0; index < (options.files ?? 1); index++) {
      const bytes = Uint8Array.from(atob(options.distinct === true && index > 0 ? secondPNG : png), char => char.charCodeAt(0));
      indices.push(data.items.length);
      data.items.add(new File([bytes], `private-resolver-source-${String(index)}.png`, { type: 'image/png' }));
    }
    const first = indices[0];
    const second = indices[1];
    probe.setAssetBindings(first === undefined ? [] : [
      { reference: 'cid:private-chart', itemIndex: first },
      { reference: 'cid:private-repeat', itemIndex: first },
      ...(second === undefined ? [] : [{ reference: 'cid:private-second', itemIndex: second }]),
    ]);
    if (options.hold !== undefined) probe.holdResolver(options.hold);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    if (event.isTrusted) throw new Error('This fixture must use a synthetic event');
    if (options.route === 'programmatic') probe.editor.view.pasteHTML(html, event);
    else probe.editor.view.dom.dispatchEvent(event);
  }, { options, png: PNG, secondPNG: distinctPNG(), htmlDefault: HTML });
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}
function observations(page: Page): Promise<Observations> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return { results: probe.results, operations: probe.operations, assetReads: probe.assetReads,
      assetUploads: probe.assetUploads, assetHookCalls: probe.assetHookCalls, resolverCalls: probe.resolverCalls,
      assetMatchRequests: probe.assetMatchRequests, resolverBlobEvidence: probe.resolverBlobEvidence,
      resolverRegistrations: probe.resolverRegistrations, resolverReleases: probe.resolverReleases,
      resolverSettlements: probe.resolverSettlements, cleanupSettlements: probe.cleanupSettlements,
      recoveryReports: probe.recoveryReports, resolverObserverThrows: probe.resolverObserverThrows };
  });
}
async function terminal(page: Page, count = 1): Promise<PasteOperationResult> {
  await expect.poll(async () => (await observations(page)).operations.length).toBe(count);
  const result = (await observations(page)).operations[count - 1];
  if (result === undefined) throw new Error('Missing terminal paste result');
  return result;
}
async function recovery(page: Page, phase: ClipboardAssetRecoveryReport['phase']): Promise<ClipboardAssetRecoveryReport> {
  await expect.poll(async () => {
    const report = (await observations(page)).recoveryReports.at(-1);
    return { phase: report?.phase, settled: report?.settled };
  }).toEqual({ phase, settled: true });
  const report = (await observations(page)).recoveryReports.at(-1);
  if (report === undefined) throw new Error('Missing recovery report');
  return report;
}
async function pending(page: Page, registered: boolean): Promise<void> {
  await expect.poll(async () => (await observations(page)).resolverCalls.length).toBe(1);
  if (registered) await expect.poll(async () => (await observations(page)).resolverRegistrations.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Cancel image preparation', exact: true })).toBeVisible();
}
async function release(page: Page): Promise<void> {
  await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseResolver(); });
}
async function history(page: Page): Promise<{ undo: number; redo: number }> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history());
}
async function undoRedo(page: Page, before: Snapshot, after: Snapshot): Promise<void> {
  expect(await history(page)).toEqual({ undo: 1, redo: 0 });
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  await expect.poll(() => snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo())).toBe(true);
  await expect.poll(() => snapshot(page)).toEqual(after);
}
async function privateMetadataStaysOffUI(page: Page): Promise<void> {
  const observed = await observations(page);
  expect(JSON.stringify(observed.operations)).not.toMatch(/private-resolver|idempotencyKey|retryToken/);
  expect(await page.locator('body').innerHTML()).not.toMatch(/private-resolver|idempotencyKey|retryToken/);
  expect(JSON.stringify(observed.recoveryReports)).not.toMatch(/__resolver-images__|private-resolver-handle|private-resolver-source/);
  const reports = observed.recoveryReports;
  for (let index = 1; index < reports.length; index++) {
    expect(reports[index]?.revision).toBeGreaterThan(reports[index - 1]?.revision ?? -1);
  }
  expect(observed.assetUploads).toBe(0);
}

function expectInlineEvidence(observed: Observations, fileReads: number, externalReferences: string[] = []): void {
  expect(observed.assetReads).toBe(fileReads);
  expect(observed.assetUploads).toBe(0);
  expect(observed.resolverCalls).toHaveLength(1);
  expect(observed.resolverBlobEvidence).toEqual([{ assetId: observed.resolverCalls[0]?.assetId, blobType: 'image/png',
    byteLength: PNG_BYTES, base64: PNG, sha256: PNG_SHA256 }]);
  expect(observed.assetMatchRequests.flatMap(request => request.references.map(reference => reference.rawReference))).toEqual(externalReferences);
  expect(JSON.stringify(observed.assetMatchRequests)).not.toContain(PNG);
  expect(JSON.stringify(observed.operations)).not.toContain(PNG);
  expect(JSON.stringify(observed.recoveryReports)).not.toContain(PNG);
  expect(observed.results).toHaveLength(1);
  expect(observed.results[0]?.html).not.toMatch(/data:image|cid:|blob:/iu);
}

async function expectRepeatedImages(page: Page, alternatives: string[]): Promise<void> {
  await expect(page.locator('.ProseMirror img')).toHaveCount(alternatives.length);
  expect(await page.evaluate(() => {
    const images: Record<string, unknown>[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.type.name === 'image') images.push({ ...node.attrs });
    });
    return images;
  })).toEqual(alternatives.map((alt, index) => ({ src: `${ORIGIN}/__resolver-images__/1.png`, alt,
    title: null, width: String((index + 1) * 10), height: null, loading: null, crossorigin: null,
    float: 'none', align: 'none', id: expect.any(String) })));
  await expect(page.locator('.ProseMirror')).toHaveText('Before Images after');
}

for (const framework of FRAMEWORKS) {
  test.describe(`${framework}: persistent clipboard resolver`, () => {
    for (const outcome of ['created', 'existing'] as const) {
      for (const route of ['native', 'programmatic'] as const) {
        test(`${route}: applies ${outcome} images once with exact Undo and Redo`, async ({ page }) => {
          const before = await open(page, framework, { 'resolver-outcome': outcome });
          await paste(page, { route, hold: 'before-creation' });
          await pending(page, false);
          expect(await snapshot(page)).toEqual(before);
          expect(await history(page)).toEqual({ undo: 0, redo: 0 });
          expect((await observations(page)).operations).toEqual([]);
          await release(page);
          const result = await terminal(page);
          expect(result.status).toBe('applied');
          const report = await recovery(page, 'accepted');
          expect(report).toMatchObject({ ownership: 'retained', registeredResources: outcome === 'created' ? 1 : 0, releasedResources: 0 });
          await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', `${ORIGIN}/__resolver-images__/${outcome === 'created' ? '1' : 'existing'}.png`);
          await expect(page.locator('.ProseMirror strong')).toHaveText('New');
          const after = await snapshot(page);
          expect(after).toEqual(expectedAppliedSnapshot(`${ORIGIN}/__resolver-images__/${outcome === 'created' ? '1' : 'existing'}.png`));
          const observed = await observations(page);
          expect(observed.assetReads).toBe(1);
          expect(observed.resolverCalls).toHaveLength(1);
          expect(observed.resolverSettlements).toBe(1);
          expect(observed.assetHookCalls).toEqual({ html: 1, slice: 1, handle: 1 });
          expect(observed.results).toHaveLength(1);
          expect(observed.results[0]?.operationId).toBe(result.operationId);
          expect(observed.resolverCalls[0]?.idempotencyKey).toMatch(/^paste:[a-f0-9]{32}:1$/u);
          await undoRedo(page, before, after);
          expect((await observations(page)).operations).toHaveLength(1);
          await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.editor.destroy(); });
          expect((await observations(page)).resolverReleases).toEqual([]);
          await privateMetadataStaysOffUI(page);
        });
      }
    }

    for (const files of [1, 2]) {
      test(`deduplicates ${String(files)} identical File source(s) while preserving repeated placements`, async ({ page }) => {
        const before = await open(page, framework);
        const html = '<p>Images</p><img src="cid:private-chart" alt="First" width="10"><img src="cid:private-repeat" alt="Repeated" width="20">'
          + (files === 2 ? '<img src="cid:private-second" alt="Second" width="30">' : '');
        await paste(page, { html, files });
        expect((await terminal(page)).status).toBe('applied');
        await recovery(page, 'accepted');
        await expect(page.locator('.ProseMirror img')).toHaveCount(files + 1);
        expect(await page.locator('.ProseMirror img').evaluateAll(images => images.map(image => image.getAttribute('alt'))))
          .toEqual(files === 1 ? ['First', 'Repeated'] : ['First', 'Repeated', 'Second']);
        expect(await page.evaluate(() => {
          const widths: unknown[] = [];
          (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
            if (node.type.name === 'image') widths.push(node.attrs['width']);
          });
          return widths;
        })).toEqual(files === 1 ? ['10', '20'] : ['10', '20', '30']);
        const observed = await observations(page);
        expect(observed.assetReads).toBe(files);
        expect(observed.resolverCalls).toHaveLength(1);
        expect(observed.resolverRegistrations).toHaveLength(1);
        await undoRedo(page, before, await snapshot(page));
        expect((await observations(page)).resolverReleases).toEqual([]);
        await privateMetadataStaysOffUI(page);
      });
    }

    test('resolves image-only files without the legacy upload handler', async ({ page }) => {
      const before = await open(page, framework);
      await paste(page, { html: '', text: '', files: 2 });
      expect((await terminal(page)).status).toBe('applied');
      await recovery(page, 'accepted');
      await expect(page.locator('.ProseMirror img')).toHaveCount(2);
      expect((await observations(page)).resolverCalls).toHaveLength(1);
      await undoRedo(page, before, await snapshot(page));
      await privateMetadataStaysOffUI(page);
    });

    for (const outcome of ['forbidden', 'partial-failure'] as const) {
      test(`compensates ${outcome} before any content or history is applied`, async ({ page }) => {
        const before = await open(page, framework, { 'resolver-outcome': outcome });
        const forbiddenRequests: string[] = [];
        page.on('request', request => { if (request.url().includes('paste-probe.invalid')) forbiddenRequests.push(request.url()); });
        await paste(page, outcome === 'partial-failure' ? {
          html: '<p>First<img src="cid:private-chart"></p><p>Second<img src="cid:private-second"></p>', files: 2, distinct: true,
        } : {});
        expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'assets-unavailable' });
        const report = await recovery(page, 'unapplied');
        const expected = outcome === 'partial-failure' ? 2 : 1;
        expect(report).toMatchObject({ ownership: 'released', registeredResources: expected, releasedResources: expected });
        expect((await observations(page)).resolverReleases).toHaveLength(expected);
        expect((await observations(page)).resolverSettlements).toBe(expected);
        expect(await snapshot(page)).toEqual(before);
        expect(await history(page)).toEqual({ undo: 0, redo: 0 });
        expect(forbiddenRequests).toEqual([]);
        await privateMetadataStaysOffUI(page);
      });
    }

    for (const stage of ['before-creation', 'after-creation'] as const) {
      test(`cancels ${stage} promptly and compensates only after actual adapter settlement`, async ({ page }) => {
        const before = await open(page, framework);
        await paste(page, { hold: stage });
        await pending(page, stage === 'after-creation');
        await page.getByRole('button', { name: 'Cancel image preparation', exact: true }).click();
        expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'cancelled' });
        const waiting = await observations(page);
        expect(waiting.resolverSettlements).toBe(0);
        expect(waiting.resolverReleases).toEqual([]);
        expect(waiting.recoveryReports.at(-1)).toMatchObject({ phase: 'unapplied', settled: false, pendingResolvers: 1 });
        await release(page);
        expect(await recovery(page, 'unapplied')).toMatchObject({ ownership: 'released', releasedResources: 1 });
        const observed = await observations(page);
        expect(observed.resolverSettlements).toBe(1);
        expect(observed.resolverReleases).toHaveLength(1);
        expect(observed.operations).toHaveLength(1);
        expect(observed.results).toHaveLength(1);
        expect(await snapshot(page)).toEqual(before);
        expect(await history(page)).toEqual({ undo: 0, redo: 0 });
        await privateMetadataStaysOffUI(page);
      });
    }

    test('delivers cleanup recovery after destruction without delaying the terminal paste result', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-cleanup': 'pending' });
      await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.holdResolver('cleanup'); });
      await paste(page, { hold: 'after-creation' });
      await pending(page, true);
      await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.editor.destroy(); });
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'target-changed' });
      expect((await observations(page)).resolverSettlements).toBe(0);
      await release(page);
      await expect.poll(async () => (await observations(page)).resolverReleases.length).toBe(1);
      expect((await observations(page)).cleanupSettlements).toBe(0);
      expect((await observations(page)).recoveryReports.at(-1)?.settled).toBe(false);
      await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseResolverCleanup(); });
      const report = await recovery(page, 'unapplied');
      expect(report.ownership).toBe('cleanup-pending');
      expect(report.recovery).toContainEqual(expect.objectContaining({ reason: 'cleanup-pending', token: 'private-resolver-retry-token' }));
      expect((await observations(page)).operations).toHaveLength(1);
      expect(await snapshot(page)).toEqual(before);
      await privateMetadataStaysOffUI(page);
    });

    for (const mutation of ['document-undo', 'image-policy'] as const) {
      test(`rejects a stale ${mutation} target and compensates the late creation`, async ({ page }) => {
        const before = await open(page, framework);
        await paste(page, { hold: 'after-creation' });
        await pending(page, true);
        await page.evaluate(mutation => {
          const probe = (window as unknown as ProbeWindow).__pasteCleanup;
          if (mutation === 'document-undo') {
            probe.editor.view.dispatch(probe.editor.state.tr.insertText('Changed'));
            probe.editor.commands.undo();
          } else probe.changeImagePolicy(true);
        }, mutation);
        await release(page);
        expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'target-changed' });
        expect(await recovery(page, 'unapplied')).toMatchObject({ ownership: 'released', releasedResources: 1 });
        expect((await snapshot(page)).doc).toEqual(before.doc);
        await expect(page.locator('.ProseMirror img')).toHaveCount(0);
        await privateMetadataStaysOffUI(page);
      });
    }

    test('keeps the newer paste when an older resolver finishes late', async ({ page }) => {
      await open(page, framework);
      await paste(page, { hold: 'after-creation' });
      await pending(page, true);
      await paste(page, { html: '<p>Latest</p>', text: 'Latest', files: 0 });
      await terminal(page, 2);
      await release(page);
      expect(await recovery(page, 'unapplied')).toMatchObject({ ownership: 'released', releasedResources: 1 });
      const observed = await observations(page);
      expect(observed.operations.map(result => result.status).sort()).toEqual(['applied', 'rejected']);
      expect(observed.operations.find(result => result.status === 'rejected')?.reason).toBe('superseded');
      await expect(page.locator('.ProseMirror')).toHaveText('Before Latest after');
      await expect(page.locator('.ProseMirror img')).toHaveCount(0);
      expect(observed.resolverCalls).toHaveLength(1);
      await privateMetadataStaysOffUI(page);
    });

    test('retains uncertain resources when a host inserts an untagged image and throws', async ({ page }) => {
      await open(page, framework, { 'resolver-host': 'insert-throw' });
      await paste(page);
      expect((await terminal(page)).status).toBe('rejected');
      expect(await recovery(page, 'uncertain')).toMatchObject({ ownership: 'recovery-pending', releasedResources: 0 });
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      expect((await observations(page)).resolverReleases).toEqual([]);
      await privateMetadataStaysOffUI(page);
    });

    for (const observer of ['throw-update', 'destroy-throw'] as const) {
      test(`retains accepted resources after ${observer}`, async ({ page }) => {
        await open(page, framework, observer === 'throw-update' ? { lifecycle: observer } : { 'resolver-host': observer });
        await paste(page);
        expect((await terminal(page)).status).toBe('applied');
        expect(await recovery(page, 'accepted')).toMatchObject({ ownership: 'retained', registeredResources: 1, releasedResources: 0 });
        const observed = await observations(page);
        expect(observed.resolverObserverThrows).toEqual(observer === 'throw-update' ? { update: 1, terminal: 0 } : { update: 0, terminal: 1 });
        expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.isDestroyed)).toBe(observer === 'destroy-throw');
        expect(await snapshot(page)).toEqual(expectedAppliedSnapshot(`${ORIGIN}/__resolver-images__/1.png`));
        expect(observed.resolverReleases).toEqual([]);
        expect(observed.results).toHaveLength(1);
        await privateMetadataStaysOffUI(page);
      });
    }

    test('retains uncertain resources after a filter veto without changing history', async ({ page }) => {
      const before = await open(page, framework, { lifecycle: 'veto' });
      await paste(page);
      expect((await terminal(page)).status).toBe('untracked');
      expect(await recovery(page, 'uncertain')).toMatchObject({ ownership: 'recovery-pending', releasedResources: 0 });
      expect(await snapshot(page)).toEqual(before);
      expect(await history(page)).toEqual({ undo: 0, redo: 0 });
      expect((await observations(page)).resolverReleases).toEqual([]);
      await privateMetadataStaysOffUI(page);
    });

    for (const diagnostics of ['default', 'one'] as const) {
      test(`preserves text when source data images are forbidden, diagnostic budget ${diagnostics}`, async ({ page }) => {
        const before = await open(page, framework, { diagnostics, 'source-data': 'forbid' });
        await paste(page, { html: `<p><span onclick="untrusted()">Source</span><img src="data:image/png;base64,${PNG}" alt="Alternative">End</p>` });
        const result = await terminal(page);
        expect(result.status).toBe('applied');
        if (diagnostics === 'one') {
          expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsafe-content-removed' })]);
          expect(result.diagnosticsTruncated).toBe(true);
        } else expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
        const observed = await observations(page);
        expect(observed.assetReads).toBe(0);
        expect(observed.resolverCalls).toEqual([]);
        expect(observed.recoveryReports).toEqual([]);
        expect(observed.results).toHaveLength(1);
        expect(observed.results[0]?.html).not.toContain('data:image');
        await expect(page.locator('.ProseMirror img')).toHaveCount(0);
        await expect(page.locator('.ProseMirror')).toContainText('Alternative');
        await undoRedo(page, before, await snapshot(page));
        await privateMetadataStaysOffUI(page);
      });
    }

    for (const route of ['native', 'programmatic'] as const) {
      test(`${route}: resolves inline raster bytes without a File or public matching reference`, async ({ page }) => {
        const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
        await paste(page, { html: INLINE_HTML, files: 0, route });
        const result = await terminal(page);
        expect(result.status).toBe('applied');
        expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'image-removed' }));
        expect(await recovery(page, 'accepted')).toMatchObject({ ownership: 'retained', registeredResources: 1 });
        const after = await snapshot(page);
        expect(after).toEqual(expectedAppliedSnapshot(`${ORIGIN}/__resolver-images__/1.png`));
        expectInlineEvidence(await observations(page), 0);
        await undoRedo(page, before, after);
        expect((await observations(page)).operations).toHaveLength(1);
        await privateMetadataStaysOffUI(page);
      });
    }

    test('leaves an unmatched duplicate File unread when inline bytes identify the image', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
      await paste(page, { html: INLINE_HTML, files: 1 });
      expect((await terminal(page)).status).toBe('applied');
      await recovery(page, 'accepted');
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      const after = await snapshot(page);
      expect(after).toEqual(expectedAppliedSnapshot(`${ORIGIN}/__resolver-images__/1.png`));
      expectInlineEvidence(await observations(page), 0);
      await undoRedo(page, before, after);
      await privateMetadataStaysOffUI(page);
    });

    test('deduplicates repeated inline encodings while preserving placement alternatives and geometry', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
      await paste(page, { html: `<p>Images</p><img src="${PNG_DATA}" alt="First" width="10">`
        + `<img src="DATA:IMAGE/PNG;BASE64,${PNG}" alt="Repeated" width="20">`, files: 0 });
      expect((await terminal(page)).status).toBe('applied');
      await recovery(page, 'accepted');
      await expectRepeatedImages(page, ['First', 'Repeated']);
      expectInlineEvidence(await observations(page), 0);
      expect((await observations(page)).resolverRegistrations).toHaveLength(1);
      await undoRedo(page, before, await snapshot(page));
      await privateMetadataStaysOffUI(page);
    });

    test('deduplicates inline bytes with an explicitly matched CID File without exposing the inline source', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
      await paste(page, { html: `<p>Images</p><img src="${PNG_DATA}" alt="Inline" width="10">`
        + '<img src="cid:private-chart" alt="Matched" width="20">', files: 1 });
      expect((await terminal(page)).status).toBe('applied');
      await recovery(page, 'accepted');
      await expectRepeatedImages(page, ['Inline', 'Matched']);
      expectInlineEvidence(await observations(page), 1, ['cid:private-chart']);
      expect((await observations(page)).resolverRegistrations).toHaveLength(1);
      await undoRedo(page, before, await snapshot(page));
      await privateMetadataStaysOffUI(page);
    });

    for (const allowance of ['exact', 'exceeded'] as const) {
      test(`enforces the ${allowance} shared inline and File byte allowance before binary reads`, async ({ page }) => {
        const before = await open(page, framework, { 'resolver-inspect': 'bytes',
          'asset-total-bytes': String(PNG_BYTES * 2 - (allowance === 'exceeded' ? 1 : 0)) });
        await paste(page, { html: `<p>Images</p><img src="${PNG_DATA}" alt="Inline" width="10">`
          + '<img src="cid:private-chart" alt="Matched" width="20">', files: 1 });
        const result = await terminal(page);
        if (allowance === 'exact') {
          expect(result.status).toBe('applied');
          await recovery(page, 'accepted');
          await expectRepeatedImages(page, ['Inline', 'Matched']);
          expectInlineEvidence(await observations(page), 1, ['cid:private-chart']);
          await undoRedo(page, before, await snapshot(page));
        } else {
          expect(result).toMatchObject({ status: 'rejected', reason: 'asset-limit' });
          const observed = await observations(page);
          expect(observed.assetReads).toBe(0);
          expect(observed.resolverCalls).toEqual([]);
          expect(observed.resolverBlobEvidence).toEqual([]);
          expect(observed.resolverRegistrations).toEqual([]);
          expect(observed.results).toHaveLength(1);
          expect(await snapshot(page)).toEqual(before);
          expect(await history(page)).toEqual({ undo: 0, redo: 0 });
        }
        await privateMetadataStaysOffUI(page);
      });
    }

    for (const format of ['JSON', 'HTML'] as const) {
      test(`saves and reloads resolved inline images through ${format} using only their persistent HTTP source`, async ({ page }) => {
        const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
        await paste(page, { html: INLINE_HTML, files: 0 });
        expect((await terminal(page)).status).toBe('applied');
        await recovery(page, 'accepted');
        const after = await snapshot(page);
        expect(after).toEqual(expectedAppliedSnapshot(`${ORIGIN}/__resolver-images__/1.png`));
        expectInlineEvidence(await observations(page), 0);
        await undoRedo(page, before, after);
        const saved = await page.evaluate(format => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          return format === 'HTML' ? editor.getHTML() : JSON.stringify(editor.getJSON());
        }, format);
        expect(saved).toContain(`${ORIGIN}/__resolver-images__/1.png`);
        expect(saved).not.toMatch(/data:image|cid:|blob:|private-resolver/iu);
        await page.reload();
        await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
        expect(await page.evaluate(({ saved, format }) => {
          const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
          const content = format === 'HTML' ? saved : JSON.parse(saved) as JSONContent;
          // Exact HTML round trips opt into preserving paragraph-edge whitespace.
          return editor.commands.setContent(content, { emitUpdate: false,
            ...(typeof content === 'string' ? { parseOptions: { preserveWhitespace: 'full' } } : {}) });
        }, { saved, format })).toBe(true);
        expect((await snapshot(page)).doc).toEqual(after.doc);
        await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', `${ORIGIN}/__resolver-images__/1.png`);
        await expect.poll(() => page.locator('.ProseMirror img').evaluate(image => {
          if (!(image instanceof HTMLImageElement)) throw new Error('Expected an image element');
          return { complete: image.complete, width: image.naturalWidth, height: image.naturalHeight };
        })).toEqual({ complete: true, width: 1, height: 1 });
        const reloaded = await observations(page);
        expect(reloaded.assetReads).toBe(0);
        expect(reloaded.resolverCalls).toEqual([]);
        expect(reloaded.resolverBlobEvidence).toEqual([]);
        expect(reloaded.operations).toEqual([]);
        await privateMetadataStaysOffUI(page);
      });
    }

    test('cancels an inline source after registration and releases only after the resolver settles', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-inspect': 'bytes' });
      await paste(page, { html: INLINE_HTML, files: 0, hold: 'after-creation' });
      await pending(page, true);
      expect(await snapshot(page)).toEqual(before);
      expect(await history(page)).toEqual({ undo: 0, redo: 0 });
      await page.getByRole('button', { name: 'Cancel image preparation', exact: true }).click();
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'cancelled' });
      const waiting = await observations(page);
      expect(waiting.resolverSettlements).toBe(0);
      expect(waiting.resolverReleases).toEqual([]);
      expect(waiting.recoveryReports.at(-1)).toMatchObject({ phase: 'unapplied', settled: false, pendingResolvers: 1 });
      await release(page);
      expect(await recovery(page, 'unapplied')).toMatchObject({ ownership: 'released', releasedResources: 1 });
      const observed = await observations(page);
      expectInlineEvidence(observed, 0);
      expect(observed.resolverSettlements).toBe(1);
      expect(observed.resolverReleases).toHaveLength(1);
      expect(observed.operations).toHaveLength(1);
      expect(await snapshot(page)).toEqual(before);
      expect(await history(page)).toEqual({ undo: 0, redo: 0 });
      await privateMetadataStaysOffUI(page);
    });

    test('compensates cancellation from a recovery observer before exposing HTML', async ({ page }) => {
      const before = await open(page, framework, { 'resolver-observer': 'cancel-created' });
      await paste(page);
      expect(await terminal(page)).toMatchObject({ status: 'rejected', reason: 'cancelled' });
      expect(await recovery(page, 'unapplied')).toMatchObject({ ownership: 'released', releasedResources: 1 });
      expect(await snapshot(page)).toEqual(before);
      expect(await history(page)).toEqual({ undo: 0, redo: 0 });
      await privateMetadataStaysOffUI(page);
    });
  });
}
