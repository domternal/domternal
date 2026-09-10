/**
 * When a paste or drop inserts the clipboard's image files, through public builds and real
 * browsers: every row of the qualification table, with and without PasteCleanup, with image
 * assets, with an uploadHandler and with allowBase64 false. Clipboard and drop events are synthetic
 * DataTransfers holding a real PNG; one trusted Chromium paste goes through the system clipboard.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './native-clipboard.js';

const BASE_URL = 'http://127.0.0.1:5895';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const REMOTE = 'https://example.com/picture.png';

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    clearObservations: () => void;
  };
}

type Config = 'off' | 'cleanup' | 'assets' | 'assets-omit' | 'upload' | 'no-base64';
const QUERIES: Record<Config, Record<string, string>> = {
  off: { 'paste-cleanup': 'off' },
  cleanup: {},
  assets: { assets: 'embedded' },
  'assets-omit': { assets: 'embedded', unresolved: 'omit' },
  upload: { 'paste-cleanup': 'off', 'image-upload': 'on' },
  'no-base64': { 'paste-cleanup': 'off', 'image-policy': 'no-base64' },
};

interface Clipboard { html?: string; text?: string; files?: number; pdf?: boolean }
/** What the document shows: the pasted file as an image (with its alt), the content's own text, or nothing. */
interface Expected { file?: number; alt?: string; text?: string; htmlImage?: boolean; nothing?: boolean; rejected?: boolean }

interface Row { name: string; clipboard: Clipboard; expect: Partial<Record<Config, Expected>> }

// Default expectations: files inserted in every configuration.
const FILE: Expected = { file: 1 };
const ALL_FILE: Row['expect'] = { off: FILE, cleanup: FILE, assets: FILE, 'assets-omit': FILE, upload: FILE, 'no-base64': { nothing: true } };

const ROWS: Row[] = [
  { name: 'one image file', clipboard: { files: 1 }, expect: ALL_FILE },
  { name: 'two image files', clipboard: { files: 2 }, expect: { off: { file: 2 }, cleanup: { file: 2 }, assets: { file: 2 }, 'assets-omit': { file: 2 }, upload: { file: 2 }, 'no-base64': { nothing: true } } },
  { name: 'plain text and a file', clipboard: { text: 'Hello', files: 1 }, expect: { off: { text: 'Hello' }, cleanup: { text: 'Hello' }, assets: { text: 'Hello' }, 'assets-omit': { text: 'Hello' }, upload: { text: 'Hello' }, 'no-base64': { text: 'Hello' } } },
  // Without a way to store the file, the name pastes as the text it is.
  { name: 'plain text naming the file', clipboard: { text: 'shot-0.png', files: 1 }, expect: { ...ALL_FILE, 'no-base64': { text: 'shot-0.png' } } },
  { name: 'white space and a file', clipboard: { text: ' \n ', files: 1 }, expect: ALL_FILE },
  { name: 'HTML text and a file', clipboard: { html: '<p>Hello</p>', files: 1 }, expect: { off: { text: 'Hello' }, cleanup: { text: 'Hello' }, assets: { text: 'Hello' }, 'assets-omit': { text: 'Hello' }, upload: { text: 'Hello' }, 'no-base64': { text: 'Hello' } } },
  {
    name: 'a copied web image with alt text and its file',
    clipboard: { html: `<meta charset="utf-8"><img src="${REMOTE}" alt="A cat">`, files: 1 },
    expect: { off: { file: 1, alt: 'A cat' }, cleanup: { file: 1, alt: 'A cat' }, assets: { file: 1, alt: 'A cat' }, 'assets-omit': { file: 1, alt: 'A cat' }, upload: { file: 1, alt: 'A cat' }, 'no-base64': { htmlImage: true } },
  },
  {
    name: 'a copied web image whose text is its address',
    clipboard: { html: `<img src="${REMOTE}">`, text: REMOTE, files: 1 },
    expect: { off: FILE, cleanup: FILE, assets: FILE, 'assets-omit': FILE, upload: FILE, 'no-base64': { text: REMOTE } },
  },
  {
    name: 'a copied local image with alt text and its file',
    clipboard: { html: '<img src="file:///C:/Users/me/cat.png" alt="A cat">', files: 1 },
    expect: { off: { file: 1, alt: 'A cat' }, cleanup: { file: 1, alt: 'A cat' }, assets: { rejected: true }, 'assets-omit': { file: 1, alt: 'A cat' }, upload: { file: 1, alt: 'A cat' } },
  },
  { name: 'a data image and its file', clipboard: { html: `<img src="data:image/png;base64,${PNG}">`, files: 1 }, expect: { off: FILE, cleanup: FILE, assets: FILE, 'assets-omit': FILE, upload: FILE } },
  { name: 'a blob image and its file', clipboard: { html: '<img src="blob:https://example.com/1234">', files: 1 }, expect: { off: FILE, cleanup: FILE, assets: { rejected: true }, 'assets-omit': FILE, upload: FILE } },
  { name: 'HTML white space and a file', clipboard: { html: '<p> </p>', files: 1 }, expect: ALL_FILE },
  { name: 'HTML no-break space and a file', clipboard: { html: '<p>&nbsp;</p>', files: 1 }, expect: ALL_FILE },
  { name: 'HTML zero-width characters and a file', clipboard: { html: '<p>\u200b\u200d\u00ad</p>', files: 1 }, expect: ALL_FILE },
  { name: 'HTML with only a meta element and a file', clipboard: { html: '<meta charset="utf-8">', files: 1 }, expect: ALL_FILE },
  {
    name: 'a figure with a caption and a file',
    clipboard: { html: `<figure><img src="${REMOTE}"><figcaption>Caption</figcaption></figure>`, files: 1 },
    expect: { off: { text: 'Caption' }, cleanup: { text: 'Caption' }, assets: { text: 'Caption' }, 'assets-omit': { text: 'Caption' }, upload: { text: 'Caption' } },
  },
  {
    name: 'two images without text and one file',
    clipboard: { html: `<img src="${REMOTE}" alt="A"><img src="${REMOTE}" alt="B">`, files: 1 },
    expect: { off: FILE, cleanup: FILE, assets: FILE, 'assets-omit': FILE, upload: FILE },
  },
  { name: 'HTML text without a file', clipboard: { html: '<p>Hello</p>' }, expect: { off: { text: 'Hello' }, cleanup: { text: 'Hello' }, assets: { text: 'Hello' }, upload: { text: 'Hello' } } },
];

async function open(page: Page, framework: string, config: Config): Promise<void> {
  const params = new URLSearchParams({ framework, 'unique-id': 'off', ...QUERIES[config] });
  await page.goto(`${BASE_URL}/?${params.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

interface Outcome { prevented: boolean; files: string[]; alts: (string | null)[]; htmlImages: number; text: string; statuses: string[]; codes: string[] }

/** Pastes or drops the clipboard into an empty document and reports what it holds once every file settled. */
async function transfer(page: Page, clipboard: Clipboard, transport: 'paste' | 'drop'): Promise<Outcome> {
  return page.evaluate(async ({ clipboard, transport, png }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const { editor } = probe;
    if (!editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
    editor.commands.focus('start');
    probe.clearObservations();
    const data = new DataTransfer();
    if (clipboard.html !== undefined) data.setData('text/html', clipboard.html);
    if (clipboard.text !== undefined) data.setData('text/plain', clipboard.text);
    const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
    for (let index = 0; index < (clipboard.files ?? 0); index++) data.items.add(new File([bytes], `shot-${String(index)}.png`, { type: 'image/png' }));
    if (clipboard.pdf === true) data.items.add(new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));
    let event: Event;
    if (transport === 'paste') {
      event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if ((event as ClipboardEvent).clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    } else {
      const block = editor.view.dom.firstElementChild;
      if (!block) throw new Error('No block to drop on');
      const rect = block.getBoundingClientRect();
      event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 });
      if ((event as DragEvent).dataTransfer !== data) Object.defineProperty(event, 'dataTransfer', { value: data });
    }
    editor.view.dom.dispatchEvent(event);
    // Files are stored behind placeholders; wait until none is left and operations settled.
    for (let attempt = 0; attempt < 200; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (editor.view.dom.querySelector('.domternal-image-uploading') === null && attempt > 5) break;
    }
    const files: string[] = [];
    const alts: (string | null)[] = [];
    let htmlImages = 0;
    // Text nodes only: an image's leaf text is its alt.
    let text = '';
    editor.state.doc.descendants(node => {
      if (node.isText) text += node.text ?? '';
      if (node.type.name !== 'image') return;
      const src = String(node.attrs['src'] ?? '');
      if (src.startsWith('data:image/png') || src.includes('/__uploads__/')) {
        files.push(src.startsWith('data:') ? 'data' : src.slice(src.lastIndexOf('/') + 1));
        alts.push(node.attrs['alt'] as string | null);
      } else htmlImages++;
    });
    return {
      prevented: event.defaultPrevented, files, alts, htmlImages, text,
      statuses: probe.operations.map(operation => operation.status),
      codes: probe.operations.flatMap(operation => operation.diagnostics.map(diagnostic => diagnostic.code)),
    };
  }, { clipboard, transport, png: PNG });
}

function check(outcome: Outcome, expected: Expected, config: Config): void {
  if (expected.file !== undefined) {
    expect(outcome.files).toHaveLength(expected.file);
    if (config === 'upload') expect(outcome.files).toEqual(Array.from({ length: expected.file }, (_, index) => `shot-${String(index)}.png`));
    expect(outcome.alts).toEqual(Array.from({ length: expected.file }, () => expected.alt ?? null));
    expect(outcome.htmlImages).toBe(0);
    expect(outcome.text.replace(/[\s\u200b-\u200d\u00ad]/g, '')).toBe('');
    expect(outcome.codes).not.toContain('image-removed');
  }
  if (expected.text !== undefined) {
    expect(outcome.files).toEqual([]);
    expect(outcome.text).toContain(expected.text);
  }
  if (expected.htmlImage === true) {
    expect(outcome.files).toEqual([]);
    expect(outcome.htmlImages).toBe(1);
  }
  if (expected.nothing === true) {
    expect(outcome.files).toEqual([]);
    expect(outcome.htmlImages).toBe(0);
    expect(outcome.text.replace(/[\s\u200b-\u200d\u00ad]/g, '')).toBe('');
  }
  if (expected.rejected === true) {
    expect(outcome.files).toEqual([]);
    expect(outcome.statuses).toContain('rejected');
  }
}

const CONFIGS: Config[] = ['off', 'upload', 'no-base64'];

for (const config of CONFIGS) {
  test.describe(`image files on paste (${config})`, () => {
    for (const row of ROWS) {
      const expected = row.expect[config];
      if (expected === undefined) continue;
      test(row.name, async ({ page }) => {
        await open(page, 'vanilla', config);
        check(await transfer(page, row.clipboard, 'paste'), expected, config);
      });
    }
  });
}

for (const framework of ['react', 'vue', 'angular'] as const) {
  test(`${framework}: a copied web image pastes its file with the alt text`, async ({ page }) => {
    for (const config of ['off'] as const) {
      await open(page, framework, config);
      check(await transfer(page, { html: `<meta charset="utf-8"><img src="${REMOTE}" alt="A cat">`, files: 1 }, 'paste'), { file: 1, alt: 'A cat' }, config);
    }
  });
}

test.describe('image files on drop', () => {
  for (const config of ['off', 'upload'] as const) {
    test(`every dropped file wins over the dropped HTML, in order (${config})`, async ({ page }) => {
      await open(page, 'vanilla', config);
      const outcome = await transfer(page, { html: '<p>Dragged text</p>', files: 2 }, 'drop');
      expect(outcome.prevented).toBe(true);
      expect(outcome.files).toHaveLength(2);
      if (config === 'upload') expect(outcome.files).toEqual(['shot-0.png', 'shot-1.png']);
      expect(outcome.text).toBe('');
    });

    test(`a dropped file keeps the alt text of the one image the drop held (${config})`, async ({ page }) => {
      await open(page, 'vanilla', config);
      check(await transfer(page, { html: `<img src="${REMOTE}" alt="A cat">`, files: 1 }, 'drop'), { file: 1, alt: 'A cat' }, config);
    });
  }

  test('a dropped file with allowBase64 false and no uploadHandler inserts nothing, and the browser does not open it', async ({ page }) => {
    await open(page, 'vanilla', 'no-base64');
    const outcome = await transfer(page, { files: 1 }, 'drop');
    expect(outcome.prevented).toBe(true);
    expect(outcome).toMatchObject({ files: [], htmlImages: 0 });
  });
});

test.describe('uploads in order', () => {
  test('three uploads finishing out of order land in clipboard order', async ({ page }) => {
    await open(page, 'vanilla', 'upload');
    const outcome = await page.evaluate(async png => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const { editor } = probe;
      editor.setContent('<p>Start</p>', false);
      editor.commands.focus('end');
      const data = new DataTransfer();
      const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
      // The fixture's uploadHandler waits the milliseconds a name gives after @.
      for (const name of ['first@120.png', 'second@10.png', 'third@60.png']) data.items.add(new File([bytes], name, { type: 'image/png' }));
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      editor.view.dom.dispatchEvent(event);
      const placeholders = editor.view.dom.querySelectorAll('.domternal-image-uploading').length;
      await new Promise(resolve => setTimeout(resolve, 400));
      const sources: string[] = [];
      editor.state.doc.descendants(node => { if (node.type.name === 'image') sources.push(decodeURIComponent(String(node.attrs['src']).split('/').pop() ?? '')); });
      return { placeholders, sources, html: editor.getHTML() };
    }, PNG);
    expect(outcome.placeholders).toBe(3);
    expect(outcome.sources).toEqual(['first@120.png', 'second@10.png', 'third@60.png']);
    expect(outcome.html).not.toContain('<p></p>');
  });
});

test('Chromium: a trusted paste of a copied image inserts its file once, with the alt text', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'The system clipboard takes an image file in Chromium only');
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
  for (const config of ['off'] as const) {
    await open(page, 'vanilla', config);
    await page.evaluate(async png => {
      const bytes = Uint8Array.from(atob(png), value => value.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([`<meta charset="utf-8"><img src="https://example.com/picture.png" alt="A cat">`], { type: 'text/html' }),
        'image/png': new Blob([bytes], { type: 'image/png' }),
      })]);
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      probe.editor.setContent('<p></p>', false);
      probe.editor.commands.focus('start');
      probe.clearObservations();
    }, PNG);
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => page.evaluate(() => {
      let count = 0;
      (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => { if (node.type.name === 'image') count++; });
      return count;
    })).toBe(1);
    const image = await page.evaluate(() => {
      let found: { src: string; alt: unknown } | undefined;
      (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
        if (node.type.name === 'image') found = { src: String(node.attrs['src']).slice(0, 15), alt: node.attrs['alt'] };
      });
      return found;
    });
    expect(image).toEqual({ src: 'data:image/png;', alt: 'A cat' });
  }
});
