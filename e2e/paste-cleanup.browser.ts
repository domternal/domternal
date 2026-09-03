/**
 * Public-build cleanup contracts through the four real framework wrappers.
 * Office-shaped inputs are synthetic examples, not captures from Microsoft Word.
 * Only the final Chromium test uses the operating system clipboard transport.
 */
import { expect, type Page, type Route } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';
import { test as clipboardTest } from './native-clipboard.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;
const WORD_HTML = '<p class="MsoNormal" style="text-align:center"><span style="mso-font-kerning:0pt;font-family:Calibri;'
  + 'font-size:18pt;color:#123456;font-weight:700;font-style:italic;text-decoration:underline">Styled Word</span></p>'
  + '<ol start="4"><li><p>Four</p></li></ol>'
  + '<table><tr><td colspan="2"><p>Merged</p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></table>';
const INHERITED_HTML = '<div style="font-family:Calibri;font-size:16px;color:#123456"><p>'
  + '<strong>Bold<span style="font-weight:400;color:#654321">Plain</span>Again</strong>'
  + '<em>Italic<span style="font-style:normal">Roman</span></em></p></div>';

/** Explicit synthetic Office metadata, not a clipboard capture from Word. */
function officeListItem(marker: string, text: string, level = 1): string {
  return `<p class="MsoListParagraph" style="mso-list:l0 level${String(level)} lfo1">`
    + `<span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${text}</p>`;
}

const OFFICE_LIST_HTML = officeListItem('7.', 'Seven') + officeListItem('•', 'Nested', 2)
  + officeListItem('8.', 'Eight') + officeListItem('2.', 'Restart');
const OFFICE_CONTINUATION_HTML = officeListItem('7.', 'Seven') + officeListItem('8.', 'Eight');
const paragraphJSON = (text: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text }] });

interface Snapshot {
  doc: unknown;
  selection: unknown;
}

interface ClipboardPayload {
  text: string;
  html?: string;
  imageBase64?: string;
}

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    framework: string;
    results: NormalizePasteHTMLResult[];
    transactions: { paste: boolean; uiEvent: unknown }[];
    normalize: (html: string, options?: NormalizePasteHTMLOptions) => NormalizePasteHTMLResult;
    clearObservations: () => void;
    snapshot: () => Snapshot;
    serializeSelection: () => { html: string; text: string };
  };
}

async function openFixture(
  page: Page,
  framework: string,
  options: { formatting?: 'preserve' | 'adapt'; smallLimits?: boolean; noLists?: boolean } = {},
): Promise<void> {
  const query = new URLSearchParams({ framework, formatting: options.formatting ?? 'preserve' });
  if (options.smallLimits === true) query.set('limits', 'small');
  if (options.noLists === true) query.set('schema', 'no-lists');
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.framework)).toBe(framework);
}

async function seed(page: Page, html: string, position: 'start' | 'end' | 'all' = 'end'): Promise<void> {
  await page.evaluate(({ html, position }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Could not seed the editor');
    probe.editor.commands.focus(position);
    probe.clearObservations();
  }, { html, position });
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot());
}

function observations(page: Page): Promise<{ results: NormalizePasteHTMLResult[]; transactions: { paste: boolean; uiEvent: unknown }[] }> {
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return { results: probe.results, transactions: probe.transactions };
  });
}

async function syntheticPaste(page: Page, payload: ClipboardPayload): Promise<void> {
  const result = await page.evaluate(payload => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const data = new DataTransfer();
    data.setData('text/plain', payload.text);
    if (payload.html !== undefined) data.setData('text/html', payload.html);
    if (payload.imageBase64 !== undefined) {
      const bytes = Uint8Array.from(atob(payload.imageBase64), character => character.charCodeAt(0));
      data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    }
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    // Firefox can replace constructor-supplied clipboard data.
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    return { trusted: event.isTrusted, prevented: event.defaultPrevented };
  }, payload);
  expect(result).toEqual({ trusted: false, prevented: true });
}

async function expectHistoryRoundTrip(page: Page, before: Snapshot): Promise<void> {
  const after = await snapshot(page);
  expect(after.doc).not.toEqual(before.doc);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => snapshot(page)).toEqual(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => snapshot(page)).toEqual(after);
}

function textMarks(page: Page, text: string): Promise<{ type: string; attrs: Record<string, unknown> }[]> {
  return page.evaluate(text => {
    const marks: { type: string; attrs: Record<string, unknown> }[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.isText && node.text === text) {
        for (const mark of node.marks) marks.push({ type: mark.type.name, attrs: { ...mark.attrs } });
      }
    });
    return marks;
  }, text);
}

/** A routed sentinel after rendering drains handlers without an arbitrary sleep. */
async function watchResourceRequests(page: Page): Promise<{ requests: string[]; drain: () => Promise<void> }> {
  const requests: string[] = [];
  const pending: Promise<void>[] = [];
  const sentinel = 'https://paste-probe.invalid/__test_route_drain__';
  const handler = (route: Route): Promise<void> => {
    const url = route.request().url();
    if (url !== sentinel) requests.push(url);
    const completed = url === sentinel
      ? route.fulfill({ status: 200, body: 'drained', headers: { 'access-control-allow-origin': '*' } })
      : route.abort();
    pending.push(completed);
    return completed;
  };
  await page.route('https://paste-probe.invalid/**', handler);
  return {
    requests,
    drain: async () => {
      await page.evaluate(async sentinel => {
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
        });
        const response = await fetch(sentinel);
        if (!response.ok) throw new Error('The resource-route barrier failed');
      }, sentinel);
      await Promise.all(pending);
    },
  };
}

for (const framework of FRAMEWORKS) {
  test.describe(`${framework}: paste cleanup`, () => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      test(`synthetic Office formatting uses ${formatting} policy and retains table geometry`, async ({ page }) => {
        await openFixture(page, framework, { formatting });
        await seed(page, '<p></p>');
        const before = await snapshot(page);
        await syntheticPaste(page, { text: 'Styled Word\nFour\nMerged\nA\nB', html: WORD_HTML });

        const editor = page.locator('.ProseMirror');
        await expect(editor.locator('strong')).toHaveText('Styled Word');
        await expect(editor.locator('em')).toHaveText('Styled Word');
        await expect(editor.locator('u')).toHaveText('Styled Word');
        expect(await editor.locator('p').first().evaluate(node => node.style.textAlign)).toBe(formatting === 'preserve' ? 'center' : '');
        await expect(editor.locator('ol')).toHaveAttribute('start', '4');
        await expect(editor.locator('table')).toHaveCount(1);
        await expect(editor.locator('td[colspan="2"]')).toHaveText('Merged');
        await expect(editor.locator('td')).toHaveText(['Merged', 'A', 'B']);
        const style = (await textMarks(page, 'Styled Word')).find(mark => mark.type === 'textStyle');
        if (formatting === 'preserve') {
          expect(style?.attrs).toMatchObject({ fontFamily: 'Calibri', fontSize: '18pt', color: '#123456' });
        } else expect(style).toBeUndefined();

        const observed = await observations(page);
        expect(observed.results.at(-1)).toMatchObject({ status: 'cleaned', source: 'word' });
        // The Office private mso-font-kerning declaration is routine envelope, not a reported loss.
        expect(observed.results.at(-1)?.diagnostics.filter(diagnostic => diagnostic.severity !== 'info')).toEqual([]);
        if (formatting === 'adapt') {
          expect(observed.results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted' }));
        }
        expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
        await expectHistoryRoundTrip(page, before);
      });

      test(`synthetic inherited typography uses ${formatting} policy with true mark resets`, async ({ page }) => {
        await openFixture(page, framework, { formatting });
        await seed(page, '<p></p>');
        const before = await snapshot(page);
        await syntheticPaste(page, { text: 'BoldPlainAgainItalicRoman', html: INHERITED_HTML });

        await expect(page.locator('.ProseMirror')).toHaveText('BoldPlainAgainItalicRoman');
        for (const text of ['Bold', 'Plain', 'Again', 'Italic', 'Roman']) {
          const marks = await textMarks(page, text);
          const names = marks.map(mark => mark.type);
          if (text === 'Bold' || text === 'Again') expect(names).toContain('bold');
          else expect(names).not.toContain('bold');
          if (text === 'Italic') expect(names).toContain('italic');
          else expect(names).not.toContain('italic');
          const visual = marks.find(mark => mark.type === 'textStyle');
          if (formatting === 'preserve') {
            expect(visual?.attrs).toMatchObject({
              fontFamily: 'Calibri', fontSize: '16px', color: text === 'Plain' ? '#654321' : '#123456',
            });
          } else expect(visual).toBeUndefined();
        }
        expect((await observations(page)).transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
        await expectHistoryRoundTrip(page, before);
      });
    }

    test('synthetic Office list metadata reconstructs a numbered start, nested bullet and restart', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<p></p>');
      const before = await snapshot(page);
      await syntheticPaste(page, { text: '7. Seven\n• Nested\n8. Eight\n2. Restart', html: OFFICE_LIST_HTML });

      expect((await snapshot(page)).doc).toMatchObject({
        type: 'doc', content: [
          { type: 'orderedList', attrs: { start: 7, listStyleType: 'decimal' }, content: [
            { type: 'listItem', content: [paragraphJSON('Seven'), { type: 'bulletList', attrs: { listStyleType: 'disc' }, content: [
              { type: 'listItem', content: [paragraphJSON('Nested')] },
            ] }] },
            { type: 'listItem', content: [paragraphJSON('Eight')] },
          ] },
          { type: 'orderedList', attrs: { start: 2, listStyleType: 'decimal' }, content: [
            { type: 'listItem', content: [paragraphJSON('Restart')] },
          ] },
        ],
      });
      const observed = await observations(page);
      expect(observed.results.at(-1)).toMatchObject({ status: 'cleaned', source: 'word' });
      expect(observed.results.at(-1)?.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'office-list-unsupported' }));
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      await expectHistoryRoundTrip(page, before);
    });

    test('synthetic Office numbering retains source start seven after an existing list starting at ten', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<ol start="10"><li><p>Existing</p></li></ol>');
      const before = await snapshot(page);
      await syntheticPaste(page, { text: '7. Seven\n8. Eight', html: OFFICE_CONTINUATION_HTML });

      expect((await snapshot(page)).doc).toMatchObject({
        type: 'doc', content: [
          { type: 'orderedList', attrs: { start: 10 }, content: [{ type: 'listItem', content: [paragraphJSON('Existing')] }] },
          { type: 'orderedList', attrs: { start: 7 }, content: [
            { type: 'listItem', content: [paragraphJSON('Seven')] },
            { type: 'listItem', content: [paragraphJSON('Eight')] },
          ] },
        ],
      });
      expect((await observations(page)).transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      await expectHistoryRoundTrip(page, before);
    });

    test('synthetic Office restarts remain sibling lists after an existing numbered item', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<ol start="10"><li><p>Existing</p></li></ol>');
      const before = await snapshot(page);
      await syntheticPaste(page, { text: '7. Seven\n• Nested\n8. Eight\n2. Restart', html: OFFICE_LIST_HTML });

      expect((await snapshot(page)).doc).toMatchObject({
        type: 'doc', content: [
          { type: 'orderedList', attrs: { start: 10 }, content: [{ type: 'listItem', content: [paragraphJSON('Existing')] }] },
          { type: 'orderedList', attrs: { start: 7 }, content: [
            { type: 'listItem', content: [paragraphJSON('Seven'), { type: 'bulletList', content: [
              { type: 'listItem', content: [paragraphJSON('Nested')] },
            ] }] },
            { type: 'listItem', content: [paragraphJSON('Eight')] },
          ] },
          { type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [paragraphJSON('Restart')] }] },
        ],
      });
      expect((await observations(page)).transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      await expectHistoryRoundTrip(page, before);
    });

    test('a schema without list nodes retains visible synthetic Office markers and reports the unsupported list', async ({ page }) => {
      await openFixture(page, framework, { noLists: true });
      await seed(page, '<p></p>');
      const before = await snapshot(page);
      expect(await page.evaluate(() => {
        const nodes = (window as unknown as ProbeWindow).__pasteCleanup.editor.schema.nodes;
        return ['bulletList', 'orderedList', 'listItem'].filter(name => nodes[name] !== undefined);
      })).toEqual([]);
      await syntheticPaste(page, { text: '7. Seven\n• Nested\n8. Eight\n2. Restart', html: OFFICE_LIST_HTML });

      const paragraphs = await page.evaluate(() => {
        const result: { type: string; text: string }[] = [];
        (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.forEach(node => {
          result.push({ type: node.type.name, text: node.textContent });
        });
        return result;
      });
      expect(paragraphs).toEqual([
        { type: 'paragraph', text: expect.stringMatching(/^7\.\s+Seven$/u) },
        { type: 'paragraph', text: expect.stringMatching(/^•\s+Nested$/u) },
        { type: 'paragraph', text: expect.stringMatching(/^8\.\s+Eight$/u) },
        { type: 'paragraph', text: expect.stringMatching(/^2\.\s+Restart$/u) },
      ]);
      const observed = await observations(page);
      expect(observed.results.at(-1)).toMatchObject({ status: 'cleaned', source: 'word' });
      expect(observed.results.at(-1)?.diagnostics).toContainEqual(expect.objectContaining({ code: 'office-list-unsupported', severity: 'warning' }));
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      await expectHistoryRoundTrip(page, before);
    });

    test('standalone normalization and paste do not execute markup or request its resources', async ({ page }) => {
      const network = await watchResourceRequests(page);
      await openFixture(page, framework);
      await seed(page, '<p></p>');
      const before = await snapshot(page);
      const html = '<script>window.__pasteExecuted=true</script>'
        + '<style>@import url(https://paste-probe.invalid/import.css);</style>'
        + '<link rel="stylesheet" href="https://paste-probe.invalid/link.css">'
        + '<p onclick="window.__pasteExecuted=true" style="background-image:url(https://paste-probe.invalid/background.png)">'
        + 'Safe <a href="javascript:window.__pasteExecuted=true">link</a>'
        + '<img src="https://paste-probe.invalid/image.png" alt="Blocked image" onerror="window.__pasteExecuted=true"></p>'
        + '<img srcset="https://paste-probe.invalid/srcset.png 1x">'
        + '<iframe src="https://paste-probe.invalid/frame"></iframe>';
      const normalized = await page.evaluate(html => (window as unknown as ProbeWindow).__pasteCleanup.normalize(html), html);
      expect(normalized.status).toBe('cleaned');
      expect(normalized.html).not.toMatch(/paste-probe|script|onclick|onerror|javascript:/i);
      expect(await snapshot(page)).toEqual(before);
      await network.drain();
      expect(network.requests).toEqual([]);

      await syntheticPaste(page, { text: 'Safe linkBlocked image', html });
      await expect(page.locator('.ProseMirror')).toHaveText('Safe linkBlocked image');
      await expect(page.locator('.ProseMirror img, .ProseMirror iframe, .ProseMirror script')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__pasteExecuted'])).not.toBe(true);
      await network.drain();
      expect(network.requests).toEqual([]);
      const codes = (await observations(page)).results.flatMap(result => result.diagnostics.map(diagnostic => diagnostic.code));
      expect(codes).toEqual(expect.arrayContaining(['unsafe-content-removed', 'image-removed', 'link-removed']));
    });

    for (const scenario of [
      { name: 'input length', code: 'input-limit', payload: { text: 'x'.repeat(1025) } },
      { name: 'plain-text complexity', code: 'input-limit', payload: { text: 'x\n'.repeat(81) } },
      { name: 'HTML nesting', code: 'structure-limit', payload: { text: 'Nested', html: '<div>'.repeat(12) + 'Nested' + '</div>'.repeat(12) } },
      { name: 'expanded table geometry', code: 'structure-limit', payload: { text: 'Wide', html: '<table><tr><td colspan="17">Wide</td></tr></table>' } },
    ]) {
      test(`rejects excess ${scenario.name} without changing the document or selection`, async ({ page }) => {
        await openFixture(page, framework, { smallLimits: true });
        await seed(page, '<p>Keep</p>');
        const before = await snapshot(page);
        await syntheticPaste(page, scenario.payload);
        expect(await snapshot(page)).toEqual(before);
        const observed = await observations(page);
        expect(observed.transactions).toEqual([]);
        expect(observed.results.at(-1)).toMatchObject({
          status: 'rejected', html: '', diagnostics: [{ code: scenario.code, severity: 'error' }],
        });
        await syntheticPaste(page, { text: ' ok' });
        await expect(page.locator('.ProseMirror')).toHaveText('Keep ok');
      });
    }

    test('serialized internal copy preserves styles, regenerates copied IDs and supports undo', async ({ page }) => {
      await openFixture(page, framework, { formatting: 'adapt' });
      await seed(page, '<h2 id="source-heading"><span style="color:#123456;font-size:18pt">Colored title</span></h2>'
        + '<p id="source-paragraph">Original paragraph</p>', 'all');
      const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.serializeSelection());
      expect(copied.html).toContain('data-pm-slice');
      expect(copied.html).toContain('source-heading');
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        probe.editor.commands.focus('end');
        probe.clearObservations();
      });
      const before = await snapshot(page);
      await syntheticPaste(page, copied);
      await expect(page.locator('.ProseMirror > h2')).toHaveText(['Colored title', 'Colored title']);
      await expect(page.locator('.ProseMirror > p')).toHaveText(['Original paragraph', 'Original paragraph']);
      const ids = await page.locator('.ProseMirror > *').evaluateAll(nodes => nodes.map(node => node.id));
      expect(ids.slice(0, 2)).toEqual(['source-heading', 'source-paragraph']);
      expect(ids.every(id => id.length > 0)).toBe(true);
      expect(new Set(ids).size).toBe(4);
      const styles = (await textMarks(page, 'Colored title')).filter(mark => mark.type === 'textStyle');
      expect(styles).toHaveLength(2);
      for (const style of styles) expect(style.attrs).toMatchObject({ color: '#123456', fontSize: '18pt' });
      await expectHistoryRoundTrip(page, before);
    });

    test('mixed HTML and image File preserve text and insert one bounded data image', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<p></p>');
      const before = await snapshot(page);
      await syntheticPaste(page, {
        text: 'Rich clipboard text', imageBase64: PNG_BASE64,
        html: `<p>Rich <strong>clipboard</strong> text</p><img src="${PNG_URL}" alt="Clipboard image">`,
      });
      await expect(page.locator('.ProseMirror > p')).toHaveText('Rich clipboard text');
      await expect(page.locator('.ProseMirror strong')).toHaveText('clipboard');
      await expect(page.locator('.ProseMirror img')).toHaveCount(1);
      await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', PNG_URL);
      expect((await observations(page)).transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      await expectHistoryRoundTrip(page, before);
    });

    test('plain text, Markdown and code-block paste retain their existing routing', async ({ page }) => {
      await openFixture(page, framework);
      await seed(page, '<p></p>');
      await syntheticPaste(page, { text: 'Plain sentence.' });
      await expect(page.locator('.ProseMirror > p')).toHaveText('Plain sentence.');
      expect((await observations(page)).results).toEqual([]);

      await seed(page, '<p></p>');
      await syntheticPaste(page, { text: '# Markdown title\n\n- alpha\n- beta' });
      await expect(page.locator('.ProseMirror h1')).toHaveText('Markdown title');
      await expect(page.locator('.ProseMirror li')).toHaveText(['alpha', 'beta']);
      expect((await observations(page)).results).toEqual([]);

      await seed(page, '<pre><code>start </code></pre>');
      await syntheticPaste(page, { text: '# literal **code**', html: '<h1><strong>HTML flavor</strong></h1>' });
      await expect(page.locator('.ProseMirror pre code')).toHaveText('start # literal **code**');
      await expect(page.locator('.ProseMirror h1, .ProseMirror strong')).toHaveCount(0);
      expect((await observations(page)).results).toEqual([]);
    });
  });
}

clipboardTest('Chromium native clipboard preserves an editor copy through cleanup', async ({ page, context, browserName }) => {
  clipboardTest.skip(browserName !== 'chromium', 'Native clipboard permissions are exercised in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  await openFixture(page, 'vanilla', { formatting: 'adapt' });
  await seed(page, '<p><strong>Native editor copy</strong></p>', 'all');
  await page.keyboard.press('ControlOrMeta+c');
  const copiedHTML = await page.evaluate(async () => {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) return (await item.getType('text/html')).text();
    }
    throw new Error('The browser copy did not expose HTML');
  });
  expect(copiedHTML).toContain('data-pm-slice');
  await seed(page, '<p></p>');
  const before = await snapshot(page);
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.ProseMirror strong')).toHaveText('Native editor copy');
  expect((await observations(page)).results.at(-1)?.status).toBe('cleaned');
  await expectHistoryRoundTrip(page, before);
});
