/** Built-package break formatting through real wrappers and synthetic clipboard events. */
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { NormalizePasteHTMLResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface Snapshot { doc: JSONContent; selection: unknown }
interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    results: NormalizePasteHTMLResult[];
    transactions: { paste: boolean; uiEvent: unknown }[];
    clearObservations: () => void;
    snapshot: () => Snapshot;
    serializeSelection: () => { html: string; text: string };
  };
}
type Formatting = 'preserve' | 'adapt';
const TYPOGRAPHY = 'font-family:Calibri;font-size:18pt;color:#123456';

/** Ignore generated block IDs and mark ordering, retaining every semantic field. */
function canonical(node: JSONContent): JSONContent {
  const result = { ...node };
  if (result.attrs !== undefined) {
    result.attrs = { ...result.attrs };
    delete result.attrs['id'];
  }
  if (result.marks !== undefined) result.marks = [...result.marks].sort((a, b) => a.type.localeCompare(b.type));
  if (result.content !== undefined) result.content = result.content.map(canonical);
  return result;
}

function leaf(text: string | null, marks: string[], formatting: Formatting, styled = true): JSONContent {
  const value: JSONContent = text === null ? { type: 'hardBreak' } : { type: 'text', text };
  const expected: NonNullable<JSONContent['marks']> = marks.map(type => ({ type }));
  if (formatting === 'preserve' && styled) expected.push({ type: 'textStyle', attrs: {
    color: '#123456', colorToken: null, backgroundColor: null, backgroundColorToken: null,
    fontFamily: 'Calibri', fontSize: '18pt',
  } });
  if (expected.length > 0) value.marks = expected;
  return value;
}

function documentJSON(content: JSONContent[], formatting: Formatting, geometry = false): JSONContent {
  return canonical({ type: 'doc', content: [{ type: 'paragraph', attrs: {
    textAlign: formatting === 'preserve' && geometry ? 'center' : 'left',
    lineHeight: formatting === 'preserve' && geometry ? '1.5' : null,
  }, content }] });
}

const cases = [
  {
    name: 'leading consecutive and trailing breaks carry all marks and inherited typography',
    html: `<div style="${TYPOGRAPHY}"><p style="text-align:center;line-height:1.5">`
      + '<strong><em><u><s><sub><br>A<br><br>B<br></sub></s></u></em></strong></p></div>',
    expected: (formatting: Formatting) => documentJSON(
      [null, 'A', null, null, 'B', null].map(text => leaf(text, ['bold', 'italic', 'underline', 'strike', 'subscript'], formatting)),
      formatting, true,
    ),
  },
  {
    name: 'break-only runs retain distinct semantic marks without character text',
    html: `<p><span style="${TYPOGRAPHY}"><strong><br></strong><sup><br></sup><s><br></s></span></p>`,
    expected: (formatting: Formatting) => documentJSON(
      [['bold'], ['superscript'], ['strike']].map(marks => leaf(null, marks, formatting)), formatting,
    ),
  },
  {
    name: 'direct break styles reset bold and italic while retaining the ancestor script box',
    html: `<p><strong><em><sup><br style="${TYPOGRAPHY};font-weight:400;font-style:normal;vertical-align:baseline">`
      + '<br></sup></em></strong></p>',
    expected: (formatting: Formatting) => documentJSON([
      leaf(null, ['superscript'], formatting), leaf(null, ['bold', 'italic', 'superscript'], formatting, false),
    ], formatting),
  },
  {
    name: 'baseline on the script owner resets that mark without changing its sibling',
    html: `<p><sup style="vertical-align:baseline"><br style="${TYPOGRAPHY}"></sup><sup><br></sup></p>`,
    expected: (formatting: Formatting) => documentJSON([
      leaf(null, [], formatting), leaf(null, ['superscript'], formatting, false),
    ], formatting),
  },
];

async function open(page: Page, framework: string, formatting: Formatting, fullSchema = true): Promise<void> {
  await page.goto(`http://127.0.0.1:5895/?${new URLSearchParams({ framework, formatting,
    ...(fullSchema ? { schema: 'capability-full' } : {}),
  }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent('<p>Replace me</p>', false)) throw new Error('Cannot seed editor');
    probe.editor.commands.focus('all');
    probe.clearObservations();
  });
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}

async function paste(page: Page, html: string, text = ''): Promise<void> {
  expect(await page.evaluate(({ html, text }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    probe.editor.view.dom.dispatchEvent(event);
    return { trusted: event.isTrusted, prevented: event.defaultPrevented };
  }, { html, text })).toEqual({ trusted: false, prevented: true });
}

async function historyAndReload(page: Page, before: Snapshot, expected: JSONContent): Promise<void> {
  const after = await snapshot(page);
  expect(canonical(after.doc)).toEqual(expected);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => snapshot(page)).toEqual(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => snapshot(page)).toEqual(after);
  const reloaded = await page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const html = editor.getHTML();
    if (!editor.setContent('<p></p>', false) || !editor.setContent(html, false)) throw new Error('Cannot reload serialized HTML');
    editor.state.doc.check();
    return editor.getJSON();
  });
  expect(canonical(reloaded)).toEqual(expected);
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test.describe(`${framework}: formatted paste breaks`, () => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      for (const scenario of cases) {
        test(`${formatting}: ${scenario.name}`, async ({ page }) => {
          await open(page, framework, formatting);
          const before = await snapshot(page);
          await paste(page, scenario.html);
          const observed = await page.evaluate(() => {
            const probe = (window as unknown as ProbeWindow).__pasteCleanup;
            return { results: probe.results, transactions: probe.transactions };
          });
          expect(observed.results).toHaveLength(1);
          expect(observed.results[0]?.status).toBe('cleaned');
          expect(observed.results[0]?.diagnostics.filter(item => item.severity !== 'info')).toEqual([]);
          expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
          await historyAndReload(page, before, scenario.expected(formatting));
        });
      }
    }

    test('internal clipboard bypass preserves styled breaks under adapt policy', async ({ page }) => {
      await open(page, framework, 'adapt');
      const copied = await page.evaluate(html => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent(html, false)) throw new Error('Cannot seed internal content');
        probe.editor.commands.focus('all');
        const copied = probe.serializeSelection();
        if (!probe.editor.setContent('<p>Replace me</p>', false)) throw new Error('Cannot reset destination');
        probe.editor.commands.focus('all');
        probe.clearObservations();
        return copied;
      }, `<p><span style="${TYPOGRAPHY}"><strong><br>A<br></strong></span></p>`);
      expect(copied.html).toContain('data-pm-slice');
      const before = await snapshot(page);
      await paste(page, copied.html, copied.text);
      const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ status: 'cleaned', diagnostics: [] });
      await historyAndReload(page, before, documentJSON([null, 'A', null].map(text => leaf(text, ['bold'], 'preserve')), 'preserve'));
    });

    test('a break-only unsupported script mark warns through the real destination', async ({ page }) => {
      await open(page, framework, 'preserve', false);
      const before = await snapshot(page);
      await paste(page, '<p><sup><br></sup></p>');
      const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
      expect(results).toHaveLength(1);
      expect(results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toContainText('Review the pasted content.');
      const expected: JSONContent = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' },
        content: [{ type: 'hardBreak' }] }] };
      await historyAndReload(page, before, expected);
    });
  });
}
