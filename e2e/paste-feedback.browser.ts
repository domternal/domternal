/** Public-build paste receipts and feedback through the four framework wrappers. */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type {
  NormalizePasteHTMLOptions,
  NormalizePasteHTMLResult,
  PasteAffectedReferences,
  PasteNormalizationContext,
  PasteOperationResult,
} from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const WARNING_HTML = '<p class="MsoNormal">New<script>privateClipboardPayload</script>'
  + '<img src="https://paste-probe.invalid/missing.png"></p>';

interface Snapshot {
  doc: unknown;
  selection: unknown;
}

interface Observations {
  results: (NormalizePasteHTMLResult & PasteNormalizationContext)[];
  operations: PasteOperationResult[];
  operationSnapshots: (Snapshot & { focused: boolean })[];
  callbackOrder: { phase: 'normalize' | 'transaction' | 'operation'; operationId?: string }[];
  transactions: { paste: boolean; uiEvent: unknown }[];
  hostUpdates: number;
}

interface ProbeWindow {
  __pasteCleanup: Observations & {
    ready: boolean;
    framework: string;
    destroyedSnapshots: Snapshot[];
    editor: Editor;
    normalize: (html: string, options?: NormalizePasteHTMLOptions) => NormalizePasteHTMLResult;
    references: (id: string) => PasteAffectedReferences | undefined;
    history: () => { undo: number; redo: number };
    select: (from: number, to?: number) => void;
    useGerman: () => Promise<void>;
    pasteProgrammatically: (html: string) => { handled: boolean; error: string | null };
    clearObservations: () => void;
    snapshot: () => Snapshot;
  };
}

async function openFixture(page: Page, framework: string, options: {
  lifecycle?: 'veto' | 'throw-update' | 'destroy-before-observe' | 'nested-interception' | 'nested-empty-interception';
  feedback?: 'application';
  smallLimits?: boolean;
} = {}): Promise<void> {
  const query = new URLSearchParams({ framework });
  if (options.lifecycle !== undefined) query.set('lifecycle', options.lifecycle);
  if (options.feedback !== undefined) query.set('feedback', options.feedback);
  if (options.smallLimits === true) query.set('limits', 'small');
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.framework)).toBe(framework);
}

async function seed(page: Page, html = '<p>Before old after</p>', selection: 'all' | 'word' = 'word'): Promise<void> {
  await page.evaluate(({ html, selection }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Could not seed the editor');
    probe.editor.commands.focus(selection === 'all' ? 'all' : 'end');
    if (selection === 'word') probe.select(8, 11);
    probe.clearObservations();
  }, { html, selection });
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}

function observe(page: Page): Promise<Observations> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return {
      results: probe.results,
      operations: probe.operations,
      operationSnapshots: probe.operationSnapshots,
      callbackOrder: probe.callbackOrder,
      transactions: probe.transactions,
      hostUpdates: probe.hostUpdates,
    };
  });
}

async function paste(page: Page, html: string, text = 'New'): Promise<void> {
  const result = await page.evaluate(({ html, text }) => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    return { trusted: event.isTrusted, prevented: event.defaultPrevented };
  }, { html, text });
  expect(result).toEqual({ trusted: false, prevented: true });
  await expect.poll(async () => (await observe(page)).operations.length).toBe(1);
}

async function operation(page: Page): Promise<PasteOperationResult> {
  const observed = await observe(page);
  expect(observed.operations).toHaveLength(1);
  const result = observed.operations[0];
  if (result === undefined) throw new Error('The paste operation callback must run');
  return result;
}

async function references(page: Page, id: string): Promise<PasteAffectedReferences> {
  const result = await page.evaluate(id => (window as unknown as ProbeWindow).__pasteCleanup.references(id), id);
  expect(result).toBeDefined();
  if (result === undefined) throw new Error('The installed paste reference must exist');
  return result;
}

for (const framework of FRAMEWORKS) {
  test.describe(`${framework}: paste feedback`, () => {
    test('correlates one accepted operation with normalization and presents a nonmodal warning', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page);
      const before = await snapshot(page);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });

      await paste(page, WARNING_HTML);

      await expect(page.locator('.ProseMirror')).toHaveText('Before New after');
      const applied = await operation(page);
      expect(applied).toMatchObject({ status: 'applied', source: 'word', formatting: 'preserve' });
      expect(applied.operationId).not.toBe('');
      expect(applied.references).toMatchObject({ referenceId: applied.operationId, precision: 'operation', expired: false });
      const observed = await observe(page);
      expect(observed.results).toHaveLength(1);
      expect(observed.results[0]).toMatchObject({ operationId: applied.operationId, status: 'cleaned' });
      expect(observed.callbackOrder).toEqual([
        { phase: 'normalize', operationId: applied.operationId },
        { phase: 'transaction' },
        { phase: 'operation', operationId: applied.operationId },
      ]);
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      expect(observed.hostUpdates).toBe(1);
      expect(observed.operationSnapshots).toEqual([{ ...await snapshot(page), focused: true }]);
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('status')).toHaveText('Review the pasted content.');
      await expect(notice.getByRole('status')).toHaveAttribute('aria-live', 'polite');
      await expect(notice).not.toContainText('privateClipboardPayload');
      expect(await page.evaluate(() => document.activeElement === (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom)).toBe(true);
      const after = await snapshot(page);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 1, redo: 0 });

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => snapshot(page)).toEqual(before);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 1 });
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => snapshot(page)).toEqual(after);
      expect((await observe(page)).operations).toEqual([applied]);
    });

    test('blocks oversized content without inserting or reporting an applied operation', async ({ page }) => {
      await openFixture(page, framework, { smallLimits: true });
      await seed(page);
      const before = await snapshot(page);

      await paste(page, `<p>${'x'.repeat(1100)}</p>`);

      expect(await snapshot(page)).toEqual(before);
      expect(await operation(page)).toMatchObject({ status: 'rejected', references: { ranges: [], expired: true } });
      expect((await observe(page)).transactions).toEqual([]);
      expect((await observe(page)).hostUpdates).toBe(0);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await expect(notice.getByRole('status')).toHaveText('Paste was blocked.');
      await expect(notice).toContainText('Try a smaller selection or paste as plain text.');
    });

    test('preserves the selected content when cleaning removes every source node', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<p>Keep selected content</p>', 'all');
      const before = await snapshot(page);

      await paste(page, '<script>privateClipboardPayload</script>', '');

      expect(await snapshot(page)).toEqual(before);
      expect(await operation(page)).toMatchObject({ status: 'noop', references: { ranges: [], expired: true } });
      expect((await observe(page)).transactions).toEqual([]);
      expect((await observe(page)).hostUpdates).toBe(0);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true }).getByRole('status')).toHaveText('Paste made no changes.');
    });

    test('does not emit host updates or accepted receipts for a transaction veto', async ({ page }) => {
      await openFixture(page, framework, { lifecycle: 'veto' });
      await seed(page);
      const before = await snapshot(page);

      await paste(page, WARNING_HTML);

      expect(await snapshot(page)).toEqual(before);
      const result = await operation(page);
      expect(result).toMatchObject({ status: 'untracked', references: { ranges: [], expired: true } });
      expect(await page.evaluate(id => (window as unknown as ProbeWindow).__pasteCleanup.references(id), result.operationId)).toBeUndefined();
      const observed = await observe(page);
      expect(observed.transactions).toEqual([]);
      expect(observed.hostUpdates).toBe(0);
      expect(observed.callbackOrder).toEqual([
        { phase: 'normalize', operationId: result.operationId },
        { phase: 'operation', operationId: result.operationId },
      ]);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 0, redo: 0 });
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true }).getByRole('status')).toHaveText('Check the paste result.');
    });

    test('reports committed content when a host observer throws after installation', async ({ page }) => {
      await openFixture(page, framework, { lifecycle: 'throw-update' });
      await seed(page);

      const attempted = await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.pasteProgrammatically(html), WARNING_HTML);

      expect(attempted).toEqual({ handled: false, error: 'Fixture observer failed after commit' });
      await expect.poll(async () => (await observe(page)).operations.length).toBe(1);
      await expect(page.locator('.ProseMirror')).toHaveText('Before New after');
      expect(await operation(page)).toMatchObject({ status: 'applied', references: { expired: false } });
      const observed = await observe(page);
      expect(observed.hostUpdates).toBe(1);
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      expect(observed.operationSnapshots[0]?.doc).toEqual((await snapshot(page)).doc);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 1, redo: 0 });
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true }).getByRole('status')).toHaveText('Review the pasted content.');
    });

    test('retains applied status if an earlier plugin destroys the editor before feedback observes it', async ({ page }) => {
      await openFixture(page, framework, { lifecycle: 'destroy-before-observe' });
      await seed(page);
      const errors: string[] = [];
      page.on('pageerror', error => { errors.push(error.message); });

      await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.pasteProgrammatically(html), WARNING_HTML);

      await expect.poll(async () => (await observe(page)).operations.length).toBe(1);
      const result = await operation(page);
      expect(result).toMatchObject({ status: 'applied', references: { expired: true, ranges: [] } });
      const committed = await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        return { destroyed: probe.editor.isDestroyed, snapshots: probe.destroyedSnapshots, text: probe.editor.state.doc.textContent };
      });
      expect(committed.destroyed).toBe(true);
      expect(committed.text).toBe('Before New after');
      expect(committed.snapshots).toHaveLength(1);
      expect(committed.snapshots[0]?.doc).toEqual((await observe(page)).operationSnapshots[0]?.doc);
      expect(await page.evaluate(id => (window as unknown as ProbeWindow).__pasteCleanup.references(id), result.operationId)).toBeUndefined();
      await expect(page.locator('.dm-paste-feedback')).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('does not attribute a nested intercepted paste to a consumed outer operation', async ({ page }) => {
      await openFixture(page, framework, { lifecycle: 'nested-interception' });
      await seed(page);

      const attempted = await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.pasteProgrammatically(html), WARNING_HTML);

      expect(attempted).toEqual({ handled: true, error: null });
      await expect.poll(async () => (await observe(page)).operations.length).toBe(2);
      await expect(page.locator('.ProseMirror')).toHaveText('Before Nested handled after');
      const observed = await observe(page);
      expect(observed.results).toHaveLength(2);
      const ids = observed.results.map(result => result.operationId);
      expect(new Set(ids).size).toBe(2);
      expect(observed.operations.map(result => result.operationId)).toEqual(ids);
      expect(observed.operations.map(result => result.status)).toEqual(['untracked', 'untracked']);
      expect(observed.operations.every(result => result.references.expired && result.references.ranges.length === 0)).toBe(true);
      for (const id of ids) {
        expect(await page.evaluate(id => (window as unknown as ProbeWindow).__pasteCleanup.references(id), id)).toBeUndefined();
      }
      expect(observed.hostUpdates).toBe(1);
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
    });

    test('clears the outer operation before a nested empty paste skips normalization', async ({ page }) => {
      await openFixture(page, framework, { lifecycle: 'nested-empty-interception' });
      await seed(page);

      const attempted = await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.pasteProgrammatically(html), WARNING_HTML);

      expect(attempted).toEqual({ handled: true, error: null });
      await expect.poll(async () => (await observe(page)).operations.length).toBe(1);
      await expect(page.locator('.ProseMirror')).toHaveText('Before Nested handled after');
      const observed = await observe(page);
      expect(observed.results).toHaveLength(1);
      const result = await operation(page);
      expect(result).toMatchObject({
        operationId: observed.results[0]?.operationId,
        status: 'untracked', references: { expired: true, ranges: [] },
      });
      expect(await page.evaluate(id => (window as unknown as ProbeWindow).__pasteCleanup.references(id), result.operationId)).toBeUndefined();
      expect(observed.hostUpdates).toBe(1);
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
    });

    test('maps public references around outside edits and expires them after interior edits', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page);
      await paste(page, '<p>New</p>');
      const result = await operation(page);
      const initial = await references(page, result.operationId);
      expect(initial).toMatchObject({ precision: 'operation', ranges: [{ from: 8, to: 11 }], expired: false });
      expect(await page.evaluate(id => {
        const value = (window as unknown as ProbeWindow).__pasteCleanup.references(id);
        return value !== undefined && Object.isFrozen(value) && Object.isFrozen(value.ranges) && value.ranges.every(Object.isFrozen);
      }, result.operationId)).toBe(true);

      await page.evaluate(() => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        editor.view.dispatch(editor.state.tr.insertText('Prefix ', 1));
      });

      const mapped = await references(page, result.operationId);
      expect(mapped).toMatchObject({ referenceId: result.operationId, ranges: [{ from: 15, to: 18 }], expired: false });
      expect(mapped.documentRevision).toBeGreaterThan(initial.documentRevision);
      await page.evaluate(() => {
        const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
        editor.view.dispatch(editor.state.tr.insertText('!', 16));
      });
      expect(await references(page, result.operationId)).toMatchObject({ ranges: [], expired: true });
      expect((await observe(page)).operations).toEqual([result]);
      expect(initial.ranges).toEqual([{ from: 8, to: 11 }]);
    });

    test('repaints the existing notice with the official German catalog without changing focus or content', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page);
      await paste(page, WARNING_HTML);
      const before = await snapshot(page);
      const applied = await operation(page);
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toBeVisible();

      await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.useGerman(); });

      const notice = page.getByRole('region', { name: 'Hinweis zum Einfügen', exact: true });
      await expect(notice).toHaveAttribute('lang', 'de');
      await expect(notice.getByRole('status')).toHaveText('Eingefügten Inhalt prüfen.');
      await expect(notice.getByRole('status')).toHaveAttribute('lang', 'de');
      await expect(notice.getByRole('button', { name: 'Hinweis zum Einfügen schließen', exact: true })).toHaveText('Schließen');
      expect(await page.evaluate(() => document.activeElement === (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom)).toBe(true);
      expect(await snapshot(page)).toEqual(before);
      expect((await observe(page)).operations).toEqual([applied]);
      await notice.locator('summary').click();
      await expect(notice.locator('details')).toHaveAttribute('open', '');
      await expect(notice.locator('li')).not.toHaveCount(0);
      await expect(notice).not.toContainText('privateClipboardPayload');
      await notice.getByRole('button', { name: 'Hinweis zum Einfügen schließen', exact: true }).click();
      await expect(notice).toBeHidden();
      expect((await snapshot(page)).doc).toEqual(before.doc);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 1, redo: 0 });
    });

    test('supports application-owned feedback and keeps standalone HTML normalization free of editor effects', async ({ page }) => {
      await openFixture(page, framework, { feedback: 'application' });
      await seed(page);
      await paste(page, WARNING_HTML);
      const applied = await operation(page);
      expect(applied).toMatchObject({ status: 'applied' });
      expect(applied.diagnostics.length).toBeGreaterThan(0);
      await expect(page.locator('.dm-paste-feedback')).toHaveCount(0);
      const before = await snapshot(page);
      const observed = await observe(page);

      const normalized = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.normalize(
        '<p onclick="alert(1)"><b>Standalone</b><script>privateClipboardPayload</script></p>',
        { formatting: 'adapt' },
      ));

      expect(normalized.status).toBe('cleaned');
      expect(normalized.html).toContain('<strong>Standalone</strong>');
      expect(normalized.html).not.toMatch(/onclick|<script|privateClipboardPayload/);
      expect(normalized.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsafe-content-removed' }));
      expect(await snapshot(page)).toEqual(before);
      expect(await observe(page)).toEqual(observed);
      await expect(page.locator('.dm-paste-feedback')).toHaveCount(0);
    });
  });
}
