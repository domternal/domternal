/**
 * A pasted list whose first item starts with a nested list, the shape a browser copies when a selection
 * starts inside a nested item, through every wrapper, with and without PasteCleanup. SmartPaste inserted
 * nothing (UniqueID threw on the item without a label) or committed a document its schema refuses.
 * Synthetic paste events of the clipboard shapes browsers and Google Docs write, and trusted keyboard
 * copies of a web page list and of an editor list. The unit matrix is
 * packages/extension-block-controls/src/SmartPaste.openSlice.test.ts.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './native-clipboard.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
  };
  __openSliceErrors: string[];
}

interface Outcome { shape: string; host: Host; outline: string; valid: true | string; prevented: boolean; errors: string[]; status: string[] }

const NESTED = 'bulletList(listItem(paragraph, bulletList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))';
const google = (inner: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b3c4d-7fff-1234-5678-9abcdef01234">${inner}</b>`;
const googleItem = (marker: string, level: number, text: string): string =>
  `<li dir="ltr" style="list-style-type:${marker};font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre;" aria-level="${String(level)}">`
  + `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation">`
  + `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre-wrap;">${text}</span></p></li>`;

// The clipboard HTML of a selection from inside a nested item into the next top level item.
const SHAPES: Record<string, string> = {
  'a Chromium or WebKit copy': '<meta charset=\'utf-8\'><ul style="color: rgb(0, 0, 0); font-family: sans-serif; font-weight: 400;">'
    + '<li><ul><li>nested item</li></ul></li><li>top item</li></ul>',
  'a Firefox copy': '<li><ul><li>nested item</li></ul></li><li>top item</li>',
  'a numbered copy': '<ol start="4"><li><ol><li>nested item</li></ol></li><li>top item</li></ol>',
  // A partial Google Docs selection may write the nested list directly inside its parent list.
  'a Google Docs list in a list': google(`<ul style="margin-top:0;margin-bottom:0;"><ul style="margin-top:0;margin-bottom:0;">${
    googleItem('circle', 2, 'nested item')}</ul>${googleItem('disc', 1, 'top item')}</ul>`),
};
const HOSTS = { 'an empty paragraph': '<p></p>', 'the end of a bullet item': '<ul><li><p>host</p></li></ul>' } as const;
type Host = keyof typeof HOSTS;

const EXPECTED: Record<string, Record<Host, string>> = {
  'a Chromium or WebKit copy': {
    'an empty paragraph': NESTED,
    'the end of a bullet item': 'bulletList(listItem(paragraph("host")), listItem(paragraph, bulletList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))',
  },
  'a Firefox copy': {
    'an empty paragraph': NESTED,
    'the end of a bullet item': 'bulletList(listItem(paragraph("host")), listItem(paragraph, bulletList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))',
  },
  'a numbered copy': {
    'an empty paragraph': 'orderedList(listItem(paragraph, orderedList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))',
    // A numbered list keeps its own kind and splits the bullet list after the caret's item.
    'the end of a bullet item': 'bulletList(listItem(paragraph("host"))), orderedList(listItem(paragraph, orderedList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))',
  },
  // Without PasteCleanup, ProseMirror's parse closes the outer list at the inner one, so the items land in
  // lists of their own, which SmartPaste places below the caret's item as it places any several blocks there.
  'a Google Docs list in a list': {
    'an empty paragraph': 'bulletList(listItem(paragraph)), bulletList(listItem(paragraph("nested item"))), bulletList(listItem(paragraph("top item")))',
    'the end of a bullet item': 'bulletList(listItem(paragraph("host"), bulletList(listItem(paragraph)), bulletList(listItem(paragraph("nested item"))), '
      + 'bulletList(listItem(paragraph("top item")))))',
  },
};

// PasteCleanup puts a list that starts its parent list in a new first item, so the items stay in one list,
// which keeps the markers moved to it apart from an unmarked host list.
const CLEANED: Record<string, Record<Host, string>> = {
  'a Google Docs list in a list': { 'an empty paragraph': NESTED, 'the end of a bullet item': `bulletList(listItem(paragraph("host"))), ${NESTED}` },
};

async function open(page: Page, framework: string, cleanup: boolean, extra: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ framework, ...(cleanup ? {} : { 'paste-cleanup': 'off' }), ...extra });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const names = await page.evaluate(() => {
    const target = window as unknown as ProbeWindow;
    target.__openSliceErrors = [];
    window.addEventListener('error', event => {
      const error: unknown = event.error;
      target.__openSliceErrors.push(error instanceof Error ? error.message : event.message);
    });
    return target.__pasteCleanup.editor.extensionManager.extensions.map(extension => extension.name);
  });
  expect(names.includes('pasteCleanup')).toBe(cleanup);
  expect(names).toContain('smartPaste');
  expect(names.includes('uniqueID')).toBe(extra['unique-id'] !== 'off');
}

/** The document as ProseMirror prints it, without marks and attributes. */
function outline(page: Page): Promise<{ outline: string; valid: true | string; errors: string[]; status: string[] }> {
  return page.evaluate(() => {
    const target = window as unknown as ProbeWindow;
    const editor = target.__pasteCleanup.editor;
    const print = (node: Editor['state']['doc']): string => {
      if (node.isText) return JSON.stringify(node.text);
      const children: string[] = [];
      node.forEach(child => { children.push(print(child)); });
      return children.length > 0 ? `${node.type.name}(${children.join(', ')})` : node.type.name;
    };
    let valid: true | string = true;
    try { editor.state.doc.check(); } catch (error) { valid = error instanceof Error ? error.message : String(error); }
    const doc = print(editor.state.doc);
    return {
      outline: doc.slice('doc('.length, -1), valid, errors: [...target.__openSliceErrors],
      status: target.__pasteCleanup.operations.map(operation => operation.status),
    };
  });
}

/** Pastes every shape into every host with synthetic paste events and reports each document. */
async function pasteShapes(page: Page, shapes: Record<string, string>, hosts: readonly Host[]): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const [shape, html] of Object.entries(shapes)) {
    for (const host of hosts) {
      const prevented = await page.evaluate(({ html, seed }) => {
        const target = window as unknown as ProbeWindow;
        const probe = target.__pasteCleanup;
        if (!probe.editor.setContent(seed, false)) throw new Error('Could not seed the editor');
        // The end of the last textblock: one position before each node that closes after it.
        let end = probe.editor.state.doc.content.size;
        for (let node = probe.editor.state.doc.lastChild; node && !node.isText; node = node.lastChild) end--;
        probe.select(end);
        probe.clearObservations();
        target.__openSliceErrors.length = 0;
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'nested item\ntop item');
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        probe.editor.view.dom.dispatchEvent(event);
        return event.defaultPrevented;
      }, { html, seed: HOSTS[host] });
      // PasteCleanup reports the operation after the paste transaction.
      await page.evaluate(() => new Promise<void>(resolve => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); }));
      outcomes.push({ shape, host, prevented, ...await outline(page) });
    }
  }
  return outcomes;
}

for (const framework of FRAMEWORKS) {
  for (const cleanup of [true, false]) {
    test(`${framework} ${cleanup ? 'with' : 'without'} PasteCleanup inserts a list whose first item starts with a nested list`, async ({ page }) => {
      await open(page, framework, cleanup);
      const outcomes = await pasteShapes(page, SHAPES, Object.keys(HOSTS) as Host[]);
      expect(outcomes).toEqual(outcomes.map(({ shape, host }) => ({
        shape, host, outline: (cleanup ? CLEANED[shape]?.[host] : undefined) ?? EXPECTED[shape]?.[host] ?? 'missing expectation',
        valid: true, prevented: true, errors: [],
        status: cleanup ? ['applied'] : [],
      })));
    });
  }
}

/** The marker of every list in document order. */
function markers(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const found: unknown[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.type.name.endsWith('List')) found.push(node.attrs['listStyleType']);
    });
    return found;
  });
}

test('a numbered copy keeps its start, and Google Docs lists keep their kinds and the markers PasteCleanup moves to the lists', async ({ page }) => {
  await open(page, 'vanilla', true);
  await pasteShapes(page, { numbered: SHAPES['a numbered copy'] ?? '' }, ['an empty paragraph']);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild?.attrs['start'] as unknown)).toBe(4);
  await pasteShapes(page, { google: SHAPES['a Google Docs list in a list'] ?? '' }, ['an empty paragraph']);
  expect(await markers(page)).toEqual(['disc', 'circle']);
  const numbered = google(`<ol style="margin-top:0;margin-bottom:0;"><ol style="margin-top:0;margin-bottom:0;">${
    googleItem('lower-alpha', 2, 'nested item')}</ol>${googleItem('decimal', 1, 'top item')}</ol>`);
  expect(await pasteShapes(page, { numbered }, ['an empty paragraph'])).toEqual([{
    shape: 'numbered', host: 'an empty paragraph', valid: true, prevented: true, errors: [], status: ['applied'],
    // The top level item stays in the numbered list instead of landing in a bullet list of its own.
    outline: 'orderedList(listItem(paragraph, orderedList(listItem(paragraph("nested item")))), listItem(paragraph("top item")))',
  }]);
  expect(await markers(page)).toEqual(['decimal', 'lower-alpha']);
});

for (const cleanup of [true, false]) {
  test(`without UniqueID ${cleanup ? 'with' : 'without'} PasteCleanup the pasted list is one the schema accepts`, async ({ page }) => {
    await open(page, 'vanilla', cleanup, { 'unique-id': 'off' });
    const outcomes = await pasteShapes(page, { 'a Chromium or WebKit copy': SHAPES['a Chromium or WebKit copy'] ?? '' }, ['an empty paragraph']);
    expect(outcomes).toEqual([{
      shape: 'a Chromium or WebKit copy', host: 'an empty paragraph', outline: NESTED, valid: true, prevented: true, errors: [],
      status: cleanup ? ['applied'] : [],
    }]);
  });
}

/** Seeds an empty paragraph, puts the caret in it and pastes the clipboard with the keyboard. */
async function keyboardPaste(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as unknown as ProbeWindow;
    const probe = target.__pasteCleanup;
    if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
    probe.editor.view.focus();
    probe.select(1);
    probe.clearObservations();
    target.__openSliceErrors.length = 0;
  });
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.textContent))
    .toContain('top item');
}

for (const cleanup of [true, false]) {
  const label = cleanup ? 'with' : 'without';

  test(`a keyboard copy of a web page list from inside a nested item pastes ${label} PasteCleanup as one list`, async ({ page }) => {
    await open(page, 'vanilla', cleanup);
    await page.evaluate(() => {
      document.getElementById('web-source')?.remove();
      const source = document.body.appendChild(document.createElement('div'));
      source.id = 'web-source';
      source.innerHTML = '<ul><li>one<ul><li id="from">nested item</li></ul></li><li id="to">top item</li></ul>';
      const from = document.querySelector('#from')?.firstChild;
      const to = document.querySelector('#to')?.firstChild;
      if (!from || !to) throw new Error('The web page list is missing');
      const range = document.createRange();
      range.setStart(from, 0);
      range.setEnd(to, 'top item'.length);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');
    await keyboardPaste(page);
    expect(await outline(page)).toEqual({ outline: NESTED, valid: true, errors: [], status: cleanup ? ['applied'] : [] });
  });

  test(`a keyboard copy of an editor list from inside a nested item pastes ${label} PasteCleanup as one list`, async ({ page }) => {
    await open(page, 'vanilla', cleanup);
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const editor = probe.editor;
      if (!editor.setContent('<ul><li><p>one</p><ul><li><p>nested item</p></li></ul></li><li><p>top item</p></li></ul>', false)) {
        throw new Error('Could not seed the editor');
      }
      let from = 0;
      let to = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'nested item') from = pos;
        if (node.isText && node.text === 'top item') to = pos + node.nodeSize;
      });
      editor.view.focus();
      probe.select(from, to);
    });
    await page.keyboard.press('ControlOrMeta+c');
    await keyboardPaste(page);
    expect(await outline(page)).toEqual({ outline: NESTED, valid: true, errors: [], status: cleanup ? ['applied'] : [] });
  });
}
