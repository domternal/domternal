/** Built-in destination probes through real wrappers. Clipboard events are synthetic. */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteNormalizationContext, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const TABLE_HTML = '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>';
const FULL_HTML = '<h2 style="text-align:center;line-height:1.5"><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s> <sub>Sub</sub> <sup>Sup</sup></h2>'
  + '<p><span style="font-family:Georgia;font-size:18pt;color:#123456;background-color:#ffff00">Painted</span></p>'
  + '<ol start="7"><li><p>Seven</p><ul><li><p>Nested</p></li></ul></li><li><p>Eight</p></li></ol>'
  + '<table><tr><th><p>Header A</p></th><th><p>Header B</p></th></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>';

interface Snapshot { doc: unknown; selection: unknown }
interface History { undo: number; redo: number }
interface Observations {
  results: (NormalizePasteHTMLResult & PasteNormalizationContext)[];
  operations: PasteOperationResult[];
  transactions: { paste: boolean; uiEvent: unknown }[];
  hostUpdates: number;
}
interface ProbeWindow {
  __pasteCleanup: Observations & {
    ready: boolean;
    framework: string;
    editor: Editor;
    history: () => History;
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
    snapshot: () => Snapshot;
    pasteProgrammatically: (html: string) => { handled: boolean; error: string | null };
  };
}
type Transport = 'synthetic-event' | 'programmatic';

async function open(page: Page, framework: string, options: {
  schema?: 'capability-minimal' | 'capability-full'; formatting?: 'preserve' | 'adapt'; diagnostics?: 'one';
} = {}): Promise<void> {
  const query = new URLSearchParams({ framework, ...options });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.framework)).toBe(framework);
  if (options.schema === 'capability-minimal') {
    expect(await page.evaluate(() => {
      const schema = (window as unknown as ProbeWindow).__pasteCleanup.editor.state.schema;
      return { nodes: Object.keys(schema.nodes).sort(), marks: Object.keys(schema.marks).sort() };
    })).toEqual({ nodes: ['doc', 'paragraph', 'text'], marks: [] });
  }
}

async function seed(page: Page, html = '<p></p>', selectWord = false): Promise<void> {
  await page.evaluate(({ html, selectWord }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Could not seed the editor');
    probe.editor.commands.focus('end');
    if (selectWord) probe.select(8, 11);
    probe.clearObservations();
  }, { html, selectWord });
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}
function history(page: Page): Promise<History> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history());
}
function observe(page: Page): Promise<Observations> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return { results: probe.results, operations: probe.operations, transactions: probe.transactions, hostUpdates: probe.hostUpdates };
  });
}

async function paste(page: Page, html: string, transport: Transport = 'synthetic-event'): Promise<Observations> {
  if (transport === 'programmatic') {
    expect(await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.pasteProgrammatically(html), html))
      .toEqual({ handled: true, error: null });
  } else {
    const result = await page.evaluate(html => {
      const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', 'Synthetic clipboard content');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      editor.view.dom.dispatchEvent(event);
      return { trusted: event.isTrusted, prevented: event.defaultPrevented };
    }, html);
    expect(result).toEqual({ trusted: false, prevented: true });
  }
  await expect.poll(async () => (await observe(page)).operations.length).toBe(1);
  const observed = await observe(page);
  expect(observed.results).toHaveLength(1);
  expect(observed.operations).toHaveLength(1);
  expect(observed.results[0]?.operationId).toBe(observed.operations[0]?.operationId);
  expect(observed.operations[0]?.diagnostics).toEqual(observed.results[0]?.diagnostics);
  return observed;
}

async function marks(page: Page, text: string): Promise<{ type: string; attrs: Record<string, unknown> }[]> {
  return page.evaluate(text => {
    const output: { type: string; attrs: Record<string, unknown> }[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.isText && node.text === text) for (const mark of node.marks) output.push({ type: mark.type.name, attrs: { ...mark.attrs } });
    });
    return output;
  }, text);
}

async function unchangedBlocked(page: Page, before: Snapshot, priorHistory: History, observed: Observations, fullDiagnostic: boolean): Promise<void> {
  expect(await snapshot(page)).toEqual(before);
  expect(await history(page)).toEqual(priorHistory);
  expect(observed.results[0]).toMatchObject({ status: 'rejected', html: '' });
  expect(observed.operations[0]).toMatchObject({ status: 'rejected', reason: 'unsupported-content', references: { ranges: [], expired: true } });
  expect(observed.transactions).toEqual([]);
  expect(observed.hostUpdates).toBe(0);
  const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('status')).toHaveText('Paste was blocked.');
  await expect(notice.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  await expect(notice).toContainText('Use an editor with table support, or paste as plain text.');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom)).toBe(true);
  if (fullDiagnostic) {
    expect(observed.results[0]?.diagnostics).toContainEqual({ code: 'destination-table-unsupported', severity: 'error' });
    await notice.locator('summary').click();
    await expect(notice).toContainText('Table paste was blocked because table support could not be confirmed.');
  }
}

for (const framework of FRAMEWORKS) {
  test.describe(`${framework}: paste destination capabilities`, () => {
    for (const transport of ['synthetic-event', 'programmatic'] as const) {
      test(`missing bold produces a truthful warning and readable text through ${transport}`, async ({ page }) => {
        await open(page, framework, { schema: 'capability-minimal' });
        await seed(page);
        const observed = await paste(page, '<p><strong>Readable</strong></p>', transport);
        await expect(page.locator('.ProseMirror')).toHaveText('Readable');
        expect(await marks(page, 'Readable')).toEqual([]);
        expect(observed.operations[0]?.status).toBe('applied');
        expect(observed.results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
        expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
        const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
        await expect(notice.getByRole('status')).toHaveText('Review the pasted content.');
        await notice.locator('summary').click();
        await expect(notice).toContainText('This editor may not preserve some pasted formatting.');
      });
    }

    test('default heading levels warn for level five while retaining its text', async ({ page }) => {
      await open(page, framework);
      await seed(page);
      const observed = await paste(page, '<h5>Level five</h5>');
      await expect(page.locator('.ProseMirror')).toHaveText('Level five');
      await expect(page.locator('.ProseMirror h5')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild?.type.name)).toBe('paragraph');
      expect(observed.results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
      expect(observed.operations[0]?.status).toBe('applied');
    });

    test('the full destination preserves level five without a warning', async ({ page }) => {
      await open(page, framework, { schema: 'capability-full' });
      await seed(page);
      const observed = await paste(page, '<h5>Level five</h5>', 'programmatic');
      await expect(page.locator('.ProseMirror h5')).toHaveText('Level five');
      expect(observed.results[0]?.diagnostics).toEqual([]);
      expect(observed.operations[0]?.status).toBe('applied');
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toHaveCount(0);
    });

    test('the full destination retains supported formatting, list structure and table headers', async ({ page }) => {
      await open(page, framework, { schema: 'capability-full' });
      await seed(page);
      const before = await snapshot(page);
      const observed = await paste(page, FULL_HTML);
      expect(observed.results[0]?.diagnostics).toEqual([]);
      expect(observed.operations[0]?.status).toBe('applied');
      for (const [text, mark] of [['Bold', 'bold'], ['Italic', 'italic'], ['Underline', 'underline'], ['Strike', 'strike'], ['Sub', 'subscript'], ['Sup', 'superscript']] as const) {
        expect((await marks(page, text)).map(item => item.type)).toContain(mark);
      }
      expect((await marks(page, 'Painted')).find(item => item.type === 'textStyle')?.attrs)
        .toMatchObject({ fontFamily: 'Georgia', fontSize: '18pt', color: '#123456', backgroundColor: '#ffff00' });
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild?.attrs))
        .toMatchObject({ level: 2, textAlign: 'center', lineHeight: '1.5' });
      await expect(page.locator('.ProseMirror ol')).toHaveAttribute('start', '7');
      await expect(page.locator('.ProseMirror ol > li')).toHaveCount(2);
      await expect(page.locator('.ProseMirror ol > li ul > li')).toHaveText('Nested');
      await expect(page.locator('.ProseMirror th')).toHaveText(['Header A', 'Header B']);
      await expect(page.locator('.ProseMirror td')).toHaveText(['A', 'B']);
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toHaveCount(0);
      const after = await snapshot(page);
      expect(await history(page)).toEqual({ undo: 1, redo: 0 });
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => snapshot(page)).toEqual(before);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => snapshot(page)).toEqual(after);
      expect((await observe(page)).operations).toHaveLength(1);
    });

    test('adapt removes intentional typography with information only on a minimal destination', async ({ page }) => {
      await open(page, framework, { schema: 'capability-minimal', formatting: 'adapt' });
      await seed(page);
      const observed = await paste(page, '<p><span style="font-family:Georgia;font-size:18pt;color:#123456">Adapted</span></p>');
      await expect(page.locator('.ProseMirror')).toHaveText('Adapted');
      expect(await marks(page, 'Adapted')).toEqual([]);
      expect(observed.results[0]?.diagnostics.length).toBeGreaterThan(0);
      expect(observed.results[0]?.diagnostics.every(item => item.code === 'formatting-adapted' && item.severity === 'info')).toBe(true);
      expect(observed.results[0]?.diagnosticsTruncated).toBe(false);
      expect(observed.operations[0]?.status).toBe('applied');
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toHaveCount(0);
    });

    for (const transport of ['synthetic-event', 'programmatic'] as const) {
      test(`unsupported tables preserve document, selection and history through ${transport}`, async ({ page }) => {
        await open(page, framework, { schema: 'capability-minimal' });
        await seed(page, '<p>Before old after</p>', true);
        const before = await snapshot(page);
        const priorHistory = await history(page);
        const observed = await paste(page, TABLE_HTML, transport);
        await unchangedBlocked(page, before, priorHistory, observed, true);
      });
    }

    test('a full diagnostic allowance cannot hide the independent table refusal', async ({ page }) => {
      await open(page, framework, { schema: 'capability-minimal', diagnostics: 'one' });
      await seed(page, '<p>Before old after</p>', true);
      const before = await snapshot(page);
      const priorHistory = await history(page);
      const observed = await paste(page, '<p><span style="mso-font-kerning:0pt">Prefix</span></p>' + TABLE_HTML);
      expect(observed.results[0]?.diagnostics).toHaveLength(1);
      expect(observed.results[0]?.diagnostics[0]?.code).toBe('unsupported-formatting');
      expect(observed.results[0]?.diagnosticsTruncated).toBe(true);
      await unchangedBlocked(page, before, priorHistory, observed, false);
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await notice.locator('summary').click();
      await expect(notice).toContainText('Not all paste details are shown.');
    });
  });
}
