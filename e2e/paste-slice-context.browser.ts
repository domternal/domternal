/**
 * Crafted data-pm-slice contexts through real wrappers, with and without PasteCleanup.
 * Synthetic paste and drop events, ProseMirror's pasteHTML, and a trusted keyboard paste
 * of HTML a page's copy handler wrote. The Core unit matrix is packages/core/src/helpers/pasteSliceContext.test.ts.
 */
import { expect, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import type { Editor } from '@domternal/core';
import type * as Core from '@domternal/core';
import type * as BlockControls from '@domternal/extension-block-controls';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './native-clipboard.js';

const BASE_URL = 'http://127.0.0.1:5895';
const CORE_ENTRY = `/@fs${resolve(__dirname, '../packages/core/dist/index.js')}`;
const BLOCK_CONTROLS_ENTRY = `/@fs${resolve(__dirname, '../packages/extension-block-controls/dist/index.js')}`;
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

// Each of these made the paste throw before Core checked the context.
const THROWING = [
  '["heading",{"level":2}]', '["heading",{"level":9}]', '["heading",{"level":"5"}]', '["codeBlock",null]',
  '["codeBlock",{"language":"js"}]', '["details",null]', '["blockquote",null,"paragraph",null]', '["hardBreak",null]',
  '["text",null]', 'null', '["listItem",null,"heading",{"level":1}]', '["blockquote",null,"details",null]',
];
// ProseMirror never writes a textblock or the top node as context: these paste as an empty context does.
const NEVER_WRITTEN = [
  '["paragraph",null]', '["detailsSummary",null]', '["doc",null]', '["doc",null,"paragraph",null]',
  '["paragraph",null,"doc",null]', '5', '{}', '"heading"',
];
// Contexts ProseMirror writes or could write for these nodes keep pasting.
const WRITTEN = [
  '[]', '["bulletList",null]', '["orderedList",{"start":3}]', '["listItem",null]', '["listItem",null,"listItem",null]',
  '["blockquote",null]', '["table",null]', '["tableRow",null]', '["tableCell",null]', '["tableCell",null,"tableCell",null]',
  '["detailsContent",null]', '["bulletList",null,"listItem",null]',
];
// HTML the parser reads back differently from its own serialization: Core rewrites the marker where it is written.
const UNSERIALIZABLE = ['<pre>\n\nPre</pre>', '<listing>\n\nPre</listing>', '<p>Area<textarea>\n\nx</textarea></p>'];
// Contexts nesting deeper than any document, which overflowed the stack while pasting in every engine.
const DEEP = [
  JSON.stringify(Array.from({ length: 6000 }, () => ['bulletList', null, 'listItem', null]).flat()),
  JSON.stringify(Array.from({ length: 20000 }, () => ['blockquote', null]).flat()),
];
const SEEDS = {
  empty: ['<p></p>', 'end'], middle: ['<p>Hello world</p>', 7], end: ['<p>Hello</p>', 'end'],
  start: ['<p>Hello</p>', 'start'], heading: ['<h2>Title</h2>', 4], emptyHeading: ['<h2></h2>', 'end'],
  listItem: ['<ul><li><p>Item</p></li></ul>', 4], blockquote: ['<blockquote><p>Quote</p></blockquote>', 4],
  cell: ['<table><tr><td><p>Cell</p></td></tr></table>', 5], document: ['<p>One</p><p>Two</p>', 'all'],
} as const satisfies Record<string, readonly [string, number | 'start' | 'end' | 'all']>;
type SeedName = keyof typeof SEEDS;
type Transport = 'event' | 'pasteHTML' | 'drop';

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    framework: string;
    editor: Editor;
    results: { html: string }[];
    serializeSelection: () => { html: string; text: string };
    operations: PasteOperationResult[];
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
  };
  __sliceErrors: string[];
}

interface Row { context: string; open: string; fragment: 'one' | 'two'; seed: SeedName; transport: Transport; before?: string }
interface Outcome {
  row: Row;
  thrown: string | null;
  valid: true | string;
  text: string;
  doc: unknown;
  prevented: boolean | null;
  status: string[];
}

async function open(page: Page, framework: string, cleanup: boolean, extra: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ framework, details: '1', ...(cleanup ? {} : { 'paste-cleanup': 'off' }), ...extra });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const names = await page.evaluate(() => {
    const target = window as unknown as ProbeWindow;
    target.__sliceErrors = [];
    window.addEventListener('error', event => {
      const error: unknown = event.error;
      target.__sliceErrors.push(error instanceof Error ? error.message : event.message);
    });
    return target.__pasteCleanup.editor.extensionManager.extensions.map(extension => extension.name);
  });
  expect(names.includes('pasteCleanup')).toBe(cleanup);
  expect(names).toContain('details');
}

/** Pastes each row into a freshly seeded editor inside the page and reports what happened. */
function run(page: Page, rows: Row[], cleanup: boolean): Promise<Outcome[]> {
  return page.evaluate(async ({ rows, seeds, cleanup }) => {
    const target = window as unknown as ProbeWindow;
    const probe = target.__pasteCleanup;
    const editor = probe.editor;
    const quote = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const html = (row: Row): string => {
      const marker = `data-pm-slice="${row.open} ${quote(row.context)}"`;
      return (row.before ?? '') + (row.fragment === 'one' ? `<p ${marker}>Pasted</p>` : `<p ${marker}>Alpha</p><p>Beta</p>`);
    };
    const outcomes: Outcome[] = [];
    for (const row of rows) {
      const [content, caret] = seeds[row.seed];
      if (!editor.setContent(content, false)) throw new Error(`Could not seed ${row.seed}`);
      if (caret === 'all') editor.commands.selectAll();
      else probe.select(caret === 'start' ? 1 : caret === 'end' ? editor.state.doc.content.size - 1 : caret);
      probe.clearObservations();
      target.__sliceErrors.length = 0;
      let thrown: string | null = null;
      let prevented: boolean | null = null;
      const data = new DataTransfer();
      data.setData('text/html', html(row));
      data.setData('text/plain', row.fragment === 'one' ? 'Pasted' : 'Alpha\n\nBeta');
      try {
        if (row.transport === 'event') {
          const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
          if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
          editor.view.dom.dispatchEvent(event);
          prevented = event.defaultPrevented;
        } else if (row.transport === 'pasteHTML') {
          editor.view.pasteHTML(html(row), new ClipboardEvent('paste', { cancelable: true }));
        } else {
          const block = editor.view.dom.firstElementChild;
          if (!block) throw new Error('No block to drop on');
          const rect = block.getBoundingClientRect();
          const event = new DragEvent('drop', {
            dataTransfer: data, bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2,
          });
          if (event.dataTransfer !== data) Object.defineProperty(event, 'dataTransfer', { value: data });
          editor.view.dom.dispatchEvent(event);
          prevented = event.defaultPrevented;
        }
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      if (cleanup && row.transport !== 'drop') {
        for (let attempt = 0; attempt < 20 && probe.operations.length === 0; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else await new Promise(resolve => setTimeout(resolve, 0));
      let valid: true | string = true;
      try { editor.state.doc.check(); } catch (error) { valid = error instanceof Error ? error.message : String(error); }
      outcomes.push({
        row, thrown: thrown ?? target.__sliceErrors[0] ?? null, valid, text: editor.state.doc.textContent,
        // UniqueID gives every block a random id, which the comparison ignores.
        doc: JSON.parse(JSON.stringify(editor.getJSON(), (key, value: unknown) => key === 'id' ? undefined : value)) as unknown, prevented, status: probe.operations.map(operation => operation.status),
      });
    }
    return outcomes;
  }, { rows, seeds: SEEDS, cleanup });
}

function rows(contexts: string[], transport: Transport, seeds: SeedName[] = Object.keys(SEEDS) as SeedName[], before?: string): Row[] {
  const output: Row[] = [];
  for (const context of contexts) {
    for (const open of ['0 0', '1 1']) {
      for (const fragment of ['one', 'two'] as const) {
        for (const seed of seeds) output.push({ context, open, fragment, seed, transport, ...(before === undefined ? {} : { before }) });
      }
    }
  }
  return output;
}

/** Every row pasted without an error, into a valid document, as an applied operation when PasteCleanup ran. */
function expectPasted(outcomes: Outcome[], cleanup: boolean): void {
  const failures = outcomes.filter(outcome => {
    const words = outcome.row.fragment === 'one' ? ['Pasted'] : ['Alpha', 'Beta'];
    return outcome.thrown !== null || outcome.valid !== true || words.some(word => !outcome.text.includes(word))
      || (outcome.row.transport !== 'pasteHTML' && outcome.prevented !== true)
      || (cleanup && outcome.row.transport !== 'drop' && outcome.status.join() !== 'applied');
  });
  expect(failures.map(({ row, thrown, valid, text, prevented, status }) => ({ row, thrown, valid, text, prevented, status }))).toEqual([]);
}

for (const cleanup of [false, true]) {
  const label = cleanup ? 'with PasteCleanup' : 'without PasteCleanup';

  test.describe(`vanilla ${label}: crafted slice context`, () => {
    for (const transport of ['event', 'pasteHTML'] as const) {
      test(`${transport}: a context that threw pastes its content into every destination`, async ({ page }) => {
        await open(page, 'vanilla', cleanup);
        expectPasted(await run(page, rows(THROWING, transport), cleanup), cleanup);
      });

      test(`${transport}: a context ProseMirror writes keeps pasting into every destination`, async ({ page }) => {
        await open(page, 'vanilla', cleanup);
        expectPasted(await run(page, rows(WRITTEN, transport), cleanup), cleanup);
      });

      test(`${transport}: a textblock or top node context pastes as an empty context`, async ({ page }) => {
        await open(page, 'vanilla', cleanup);
        const crafted = await run(page, rows(NEVER_WRITTEN, transport), cleanup);
        expectPasted(crafted, cleanup);
        if (cleanup) return;
        // Without PasteCleanup the HTML reaches ProseMirror as pasted, so the empty context is the exact reference.
        const empty = await run(page, crafted.map(({ row }) => ({ ...row, context: '[]' })), cleanup);
        expect(crafted.map(outcome => ({ row: outcome.row, doc: outcome.doc })))
          .toEqual(empty.map((outcome, index) => ({ row: crafted[index]?.row, doc: outcome.doc })));
      });
    }

    for (const transport of ['event', 'pasteHTML', 'drop'] as const) {
      const seeds: SeedName[] = transport === 'drop' ? ['empty', 'middle', 'end', 'document'] : Object.keys(SEEDS) as SeedName[];
      test(`${transport}: a text or null context after HTML that does not serialize as written pastes its content`, async ({ page }) => {
        await open(page, 'vanilla', cleanup);
        const crafted = UNSERIALIZABLE.flatMap(before => rows(['["text",null]', 'null'], transport, seeds, before));
        expectPasted(await run(page, crafted, cleanup), cleanup);
      });

      test(`${transport}: a context nesting thousands of wrappers pastes as an empty context`, async ({ page }) => {
        await open(page, 'vanilla', cleanup);
        const deep = DEEP.flatMap(context => ['empty', 'middle', 'listItem', 'document'].map(seed => ({
          context, open: '1 1', fragment: 'one' as const, seed: seed as SeedName, transport,
        })));
        const crafted = await run(page, deep, cleanup);
        expectPasted(crafted, cleanup);
        if (cleanup) return;
        const empty = await run(page, deep.map(row => ({ ...row, context: '[]' })), cleanup);
        expect(crafted.map(outcome => outcome.doc)).toEqual(empty.map(outcome => outcome.doc));
      });
    }

    test('drop: a crafted context in dropped HTML lands without an error', async ({ page }) => {
      await open(page, 'vanilla', cleanup);
      const seeds: SeedName[] = ['empty', 'middle', 'end', 'document'];
      expectPasted(await run(page, rows([...THROWING, ...NEVER_WRITTEN.slice(0, 2), ...WRITTEN.slice(0, 3)], 'drop', seeds), cleanup), cleanup);
    });
  });

  for (const framework of FRAMEWORKS) {
    test(`${framework} ${label}: a synthetic paste with a context that threw lands`, async ({ page }) => {
      await open(page, framework, cleanup);
      expectPasted(await run(page, rows(THROWING, 'event', ['empty', 'middle', 'heading', 'cell']), cleanup), cleanup);
    });
  }
}

/** Records requests to the probe origin; a routed sentinel drains them without a fixed sleep. */
async function watchRequests(page: Page): Promise<{ requests: string[]; drain: () => Promise<void> }> {
  const requests: string[] = [];
  const pending: Promise<void>[] = [];
  const sentinel = 'https://paste-probe.invalid/__slice_context_drain__';
  await page.route('https://paste-probe.invalid/**', (route: Route) => {
    const url = route.request().url();
    if (url !== sentinel) requests.push(url);
    const completed = url === sentinel
      ? route.fulfill({ status: 200, body: 'drained', headers: { 'access-control-allow-origin': '*' } })
      : route.abort();
    pending.push(completed);
    return completed;
  });
  return {
    requests,
    drain: async () => {
      await page.evaluate(async sentinel => {
        await new Promise<void>(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
        const response = await fetch(sentinel);
        if (!response.ok) throw new Error('The request barrier failed');
      }, sentinel);
      await Promise.all(pending);
    },
  };
}

test('SmartPaste metadata keeps copied list and table-fragment entities inert', async ({ page }) => {
  await open(page, 'vanilla', false);
  const watched = await watchRequests(page);
  const result = await page.evaluate(async ({ coreEntry, controlsEntry }) => {
    const core = await import(coreEntry) as typeof Core;
    const { SmartPaste } = await import(controlsEntry) as typeof BlockControls;
    const host = document.body.appendChild(document.createElement('div'));
    const editor = new core.Editor({ element: host,
      extensions: [core.Document, core.Paragraph, core.Text, core.BulletList, core.ListItem, SmartPaste],
      content: '<ul><li><p>alpha Beta &amp; &lt;tag&gt;</p></li></ul>' });
    const text = 'Beta & <tag>';
    let from = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text?.includes(text)) from = position + node.text.indexOf(text);
    });
    if (from < 0) throw new Error('The copied text was not found');
    const slice = editor.state.doc.slice(from, from + text.length, true);
    const copied = editor.view.serializeForClipboard(slice).dom.innerHTML;
    const marker = /data-pm-slice="([^"]+)"/.exec(copied)?.[1];
    if (!marker?.includes('&quot;bulletList&quot;')) throw new Error('The public copy must encode its list context');
    const plugin = editor.state.plugins.find(candidate => candidate.props.handlePaste);
    if (!plugin?.props.handlePaste) throw new Error('The public SmartPaste prop is missing');
    const hostile = '<script>globalThis.__smartParserExecuted=true</script>'
      + '<link rel="stylesheet" href="https://paste-probe.invalid/smart.css">'
      + '<style>@import url(https://paste-probe.invalid/smart-import.css)</style>'
      + '<iframe src="https://paste-probe.invalid/smart-frame"></iframe>'
      + '<img src="https://paste-probe.invalid/smart.png" onerror="globalThis.__smartParserExecuted=true">'
      + '<svg onload="globalThis.__smartParserExecuted=true"></svg>';
    const outcomes = [];
    try {
      for (const tag of ['p', 'tr', 'td']) {
        editor.setContent('<p>Before</p>', false);
        editor.commands.focus('end');
        const before = document.documentElement.outerHTML;
        const data = new DataTransfer();
        data.setData('text/html', `<${tag} data-pm-slice="${marker}" onclick="globalThis.__smartParserExecuted=true">Beta &amp; &lt;tag&gt;</${tag}>${hostile}`);
        const event = new ClipboardEvent('paste', { clipboardData: data });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        const handled = plugin.props.handlePaste.call(plugin, editor.view, event, slice);
        outcomes.push({ tag, deferred: handled === false, unchanged: document.documentElement.outerHTML === before,
          document: editor.state.doc.toString() });
        // A copied inline selection is left to ProseMirror's default placement.
        if (handled === false) editor.view.dispatch(editor.state.tr.replaceSelection(slice));
        if (editor.state.doc.textContent !== `Before${text}`) throw new Error('Decoded copied text did not join the target paragraph');
      }
      return { outcomes, copiedText: slice.content.textBetween(0, slice.content.size),
        executed: (globalThis as unknown as Record<string, unknown>)['__smartParserExecuted'] === true };
    } finally { editor.destroy(); host.remove(); }
  }, { coreEntry: CORE_ENTRY, controlsEntry: BLOCK_CONTROLS_ENTRY });
  await watched.drain();
  expect(result).toEqual({
    outcomes: ['p', 'tr', 'td'].map(tag => ({ tag, deferred: true, unchanged: true, document: 'doc(paragraph("Before"))' })),
    copiedText: 'Beta & <tag>', executed: false,
  });
  expect(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>)['__smartParserExecuted'])).not.toBe(true);
  expect(watched.requests).toEqual([]);
});

/** Seeds the editor, then pastes HTML a page copy handler wrote with trusted keyboard shortcuts. */
async function keyboardPaste(page: Page, html: string, seed = '<p></p>'): Promise<void> {
  await page.evaluate(({ html, seed }) => {
    const target = window as unknown as ProbeWindow;
    const probe = target.__pasteCleanup;
    if (!probe.editor.setContent(seed, false)) throw new Error('Could not seed the editor');
    probe.clearObservations();
    target.__sliceErrors.length = 0;
    document.getElementById('slice-source')?.remove();
    const source = document.body.appendChild(document.createElement('textarea'));
    source.id = 'slice-source';
    source.value = 'source';
    source.addEventListener('copy', event => {
      event.clipboardData?.setData('text/html', html);
      event.clipboardData?.setData('text/plain', 'Pasted bold');
      event.preventDefault();
    });
    const record = document.body.dataset;
    delete record['slicePrevented'];
    window.addEventListener('paste', event => { record['slicePrevented'] = String(event.defaultPrevented); }, { once: true });
  }, { html, seed });
  await page.locator('#slice-source').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('.ProseMirror').focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('ControlOrMeta+v');
  await expect.poll(() => page.evaluate(() => document.body.dataset['slicePrevented'])).toBe('true');
}

/** What the editor holds and shows after a paste, and the errors the page reported. */
function editorState(page: Page): Promise<{ errors: string[]; text: string; images: string[]; domImages: number; bold: number; domText: string }> {
  return page.evaluate(async () => {
    // A native insertion reaches the document through ProseMirror's DOM observer after the event.
    await new Promise<void>(resolve => { requestAnimationFrame(() => { setTimeout(resolve, 50); }); });
    const target = window as unknown as ProbeWindow;
    const editor = target.__pasteCleanup.editor;
    const images: string[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'image') images.push(String(node.attrs['src'])); });
    return {
      errors: [...target.__sliceErrors], text: editor.state.doc.textContent, images,
      domImages: editor.view.dom.querySelectorAll('img').length,
      bold: editor.view.dom.querySelectorAll('strong, b').length,
      domText: editor.view.dom.textContent,
    };
  });
}

for (const cleanup of [false, true]) {
  test(`trusted keyboard paste of a crafted context ${cleanup ? 'with' : 'without'} PasteCleanup never falls back to a native paste`, async ({ page }) => {
    await open(page, 'vanilla', cleanup);
    const watched = await watchRequests(page);
    for (const context of ['["heading",null]', '["text",null]', 'null', '["details",null]', '["blockquote",null,"paragraph",null]', '["paragraph",null]']) {
      const name = context.replace(/[^a-z]+/gi, '-');
      await keyboardPaste(page, `<p data-pm-slice="0 0 ${context.replace(/"/g, '&quot;')}">Pasted <b>bold</b><img src="https://paste-probe.invalid/${name}.png"></p>`);
      if (cleanup) {
        await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.map(o => o.status)))
          .toEqual(['applied']);
      }
      expect({ context, ...await editorState(page) }).toEqual({
        context, errors: [], text: 'Pasted bold', bold: 1, domText: 'Pasted bold',
        // Core keeps a remote image as a node; PasteCleanup removes it before any request.
        images: cleanup ? [] : [`https://paste-probe.invalid/${name}.png`], domImages: cleanup ? 0 : 1,
      });
    }
    await watched.drain();
    if (cleanup) expect(watched.requests).toEqual([]);
  });

  const label = cleanup ? 'with PasteCleanup' : 'without PasteCleanup';
  for (const failure of ['html', 'slice', 'handle'] as const) {
    test(`a throwing ${failure} paste hook ${label} lets no native paste insert the clipboard HTML`, async ({ page }) => {
      await open(page, 'vanilla', cleanup, { 'paste-failure': failure });
      const watched = await watchRequests(page);
      await keyboardPaste(page, `<p>Pasted <b>bold</b><img src="https://paste-probe.invalid/native-${failure}.png"></p>`, '<p>Keep</p>');
      expect(await editorState(page)).toEqual({
        errors: ['Synthetic paste handler failure'], text: 'Keep', images: [], domImages: 0, bold: 0, domText: 'Keep',
      });
      await watched.drain();
      expect(watched.requests).toEqual([]);
    });
  }

  for (const failure of ['html', 'slice'] as const) {
    test(`a throwing ${failure} paste hook ${label} lets no native drop insert dragged HTML`, async ({ page }) => {
      await open(page, 'vanilla', cleanup, { 'paste-failure': failure });
      const watched = await watchRequests(page);
      await page.evaluate(() => {
        const target = window as unknown as ProbeWindow;
        if (!target.__pasteCleanup.editor.setContent('<p>Keep</p>', false)) throw new Error('Could not seed the editor');
        target.__sliceErrors.length = 0;
        const source = document.body.appendChild(document.createElement('div'));
        source.id = 'drag-source';
        source.draggable = true;
        source.textContent = 'Drag me';
        source.addEventListener('dragstart', event => {
          event.dataTransfer?.setData('text/html', `<p>Dropped <b>bold</b><img src="https://paste-probe.invalid/drop.png"></p>`);
          event.dataTransfer?.setData('text/plain', 'Dropped bold');
        });
        const record = document.body.dataset;
        delete record['slicePrevented'];
        window.addEventListener('drop', event => { record['slicePrevented'] = String(event.defaultPrevented); }, { once: true });
      });
      await page.dragAndDrop('#drag-source', '.ProseMirror p');
      await expect.poll(() => page.evaluate(() => document.body.dataset['slicePrevented'])).toBe('true');
      expect(await editorState(page)).toEqual({
        errors: ['Synthetic paste handler failure'], text: 'Keep', images: [], domImages: 0, bold: 0, domText: 'Keep',
      });
      await watched.drain();
      expect(watched.requests).toEqual([]);
    });
  }
}

test('PasteCleanup keeps the table and details contexts a Domternal copy writes', async ({ page }) => {
  await open(page, 'vanilla', true);
  const structures: [string, string][] = [
    ['<table><tr><td><p>One</p><p>Two</p></td><td><p>B</p></td></tr></table>', '["table",'],
    ['<table><tr><td><blockquote><p>One</p><p>Two</p></blockquote></td></tr></table>', '["table",'],
    ['<details open><summary>Title</summary><div data-details-content><p>One</p><p>Two</p></div></details>', '["details",'],
    ['<ul><li><p>Item</p><details open><summary>Title</summary><div data-details-content><p>One</p><p>Two</p></div></details></li></ul>', '["bulletList",'],
  ];
  for (const [content, prefix] of structures) {
    const outcome = await page.evaluate(async content => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const editor = probe.editor;
      if (!editor.setContent(content, false)) throw new Error('Could not seed the editor');
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'One') from = pos + 1;
        if (node.isText && node.text === 'Two') to = pos + node.nodeSize - 1;
      });
      probe.select(from, to);
      const copied = probe.serializeSelection().html;
      if (!editor.setContent('<p></p>', false)) throw new Error('Could not reset the editor');
      probe.clearObservations();
      const data = new DataTransfer();
      data.setData('text/html', copied);
      data.setData('text/plain', 'ne\n\nTw');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      editor.view.dom.dispatchEvent(event);
      for (let attempt = 0; attempt < 20 && probe.operations.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
      const marker = (html: string): string | undefined => /data-pm-slice="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"').replaceAll('&#x22;', '"');
      return { copied: marker(copied), cleaned: marker(probe.results[0]?.html ?? ''), status: probe.operations.map(operation => operation.status),
        text: editor.state.doc.textContent };
    }, content);
    expect(outcome.copied).toContain(prefix);
    expect(outcome).toEqual({ copied: outcome.copied, cleaned: outcome.copied, status: ['applied'], text: 'neTw' });
  }
});
