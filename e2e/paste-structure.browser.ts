/**
 * Paste shapes the open slice audit found losing text or structure, through every wrapper and
 * browser, with PasteCleanup on and, where the defect was its own, off for comparison. Synthetic
 * paste events, parsed by each browser's own HTML parser; the unit tests for each shape are named
 * in its section and take their slices from @domternal/tests-clipboard-slices.
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
    results: { diagnostics: { code: string }[] }[];
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
  };
}

interface Pasted {
  doc: string;
  valid: boolean;
  status: string[];
}

async function open(page: Page, framework: string, query: Record<string, string> = {}): Promise<void> {
  await page.goto(`${BASE_URL}/?${new URLSearchParams({ framework, ...query }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/**
 * Seeds the document, puts the caret after the first occurrence of `caret` (at the document's
 * first text position without one), pastes the clipboard and returns the document.
 */
async function paste(page: Page, seed: string, clipboard: { html?: string; text?: string }, caret?: string): Promise<Pasted> {
  await page.evaluate(({ seed, clipboard, caret }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const { editor } = probe;
    if (!editor.setContent(seed, false)) throw new Error('Could not seed the editor');
    let pos = -1;
    editor.state.doc.descendants((node, at) => {
      if (pos >= 0) return false;
      if (caret === undefined ? node.isTextblock : node.isText && node.text?.includes(caret) === true) {
        pos = caret === undefined ? at + 1 : at + (node.text?.indexOf(caret) ?? 0) + caret.length;
      }
      return true;
    });
    probe.select(pos);
    probe.clearObservations();
    const data = new DataTransfer();
    if (clipboard.html !== undefined) data.setData('text/html', clipboard.html);
    if (clipboard.text !== undefined) data.setData('text/plain', clipboard.text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('The editor did not handle the paste');
  }, { seed, clipboard, caret });
  return page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    let valid = true;
    try { probe.editor.state.doc.check(); } catch { valid = false; }
    return { doc: probe.editor.state.doc.toString(), valid, status: probe.operations.map(operation => operation.status) };
  });
}

const cell = (text: string): string => `tableCell(paragraph("${text}"))`;
const table = (rows: string[][]): string => `table(${rows.map(row => `tableRow(${row.map(cell).join(', ')})`).join(', ')})`;

// Unit tests: packages/extension-paste-cleanup/src/html/bareTableParts.test.ts and src/PasteCleanup.bareTableParts.test.ts.
const ROWS = '<tr><td>ra</td><td>rb</td></tr><tr><td>rc</td><td>rd</td></tr>';
const BARE_TABLE_PARTS: Record<string, { html: string; doc: string }> = {
  'bare rows': { html: ROWS, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
  'bare cells': { html: '<td>ta</td><td>tb</td>', doc: `doc(${table([['ta', 'tb']])})` },
  'rows after a column group': { html: `<colgroup><col><col></colgroup>${ROWS}`, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
  'rows after a meta element': { html: `<meta charset="utf-8">${ROWS}`, doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})` },
};
const GRID = '<table><tbody><tr><td><p>x1</p></td><td><p>x2</p></td></tr><tr><td><p>x3</p></td><td><p>x4</p></td></tr></tbody></table>';

for (const framework of FRAMEWORKS) {
  test(`${framework} pastes bare table rows and cells as a table with PasteCleanup, as it does without`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await open(page, framework, cleanup === 'on' ? {} : { 'paste-cleanup': 'off' });
      for (const [name, { html, doc }] of Object.entries(BARE_TABLE_PARTS)) {
        expect(await paste(page, '<p></p>', { html, text: 'fallback' }), `${name}, PasteCleanup ${cleanup}`)
          .toEqual({ doc, valid: true, status: cleanup === 'on' ? ['applied'] : [] });
      }
      expect(await paste(page, GRID, { html: ROWS, text: 'fallback' }, 'x1'), `rows into a table, PasteCleanup ${cleanup}`)
        .toMatchObject({ doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])})`, valid: true });
    }
    // ProseMirror's parse alone drops a paragraph after bare rows; cleanup keeps it.
    await open(page, framework);
    expect(await paste(page, '<p></p>', { html: `${ROWS}<p>after</p>`, text: 'fallback' }))
      .toEqual({ doc: `doc(${table([['ra', 'rb'], ['rc', 'rd']])}, paragraph("after"))`, valid: true, status: ['applied'] });
  });
}

// Unit tests: packages/extension-paste-cleanup/src/html/blockBoxes.test.ts and src/PasteCleanup.blockBoxes.test.ts.
const BLOCK_BOXES: Record<string, { html: string; doc: string }> = {
  'a definition list': { html: '<dl><dt>term</dt><dd>definition</dd></dl>', doc: 'doc(paragraph("term"), paragraph("definition"))' },
  'two sections': { html: '<section>one</section><section>two</section>', doc: 'doc(paragraph("one"), paragraph("two"))' },
  'a figure caption after a paragraph': { html: '<p>text</p><figure><figcaption>caption</figcaption></figure>', doc: 'doc(paragraph("text"), paragraph("caption"))' },
};

for (const framework of FRAMEWORKS) {
  test(`${framework} pastes block elements PasteCleanup does not keep as separate paragraphs, as it does without`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await open(page, framework, cleanup === 'on' ? {} : { 'paste-cleanup': 'off' });
      for (const [name, { html, doc }] of Object.entries(BLOCK_BOXES)) {
        expect(await paste(page, '<p></p>', { html, text: 'fallback' }), `${name}, PasteCleanup ${cleanup}`)
          .toEqual({ doc, valid: true, status: cleanup === 'on' ? ['applied'] : [] });
      }
    }
  });
}

test('a keyboard copy of a web page definition list pastes its term and definition as separate paragraphs', async ({ page }) => {
  for (const cleanup of ['on', 'off']) {
    await open(page, 'vanilla', cleanup === 'on' ? {} : { 'paste-cleanup': 'off' });
    await page.evaluate(() => {
      const source = document.body.appendChild(document.createElement('div'));
      source.innerHTML = '<dl><dt>term</dt><dd>definition</dd></dl>';
      const range = document.createRange();
      range.selectNodeContents(source);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
    await page.keyboard.press('ControlOrMeta+c');
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
      probe.editor.view.focus();
      probe.select(1);
      probe.clearObservations();
    });
    await page.keyboard.press('ControlOrMeta+v');
    // The blocks and their text; a copy can bring the page's font as a text style.
    await expect.poll(() => page.evaluate(() => {
      const blocks: string[] = [];
      (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.forEach(node => { blocks.push(`${node.type.name}: ${node.textContent}`); });
      return blocks;
    }), `PasteCleanup ${cleanup}`).toEqual(['paragraph: term', 'paragraph: definition']);
  }
});

// Unit tests: packages/extension-paste-cleanup/src/PasteCleanup.mentionType.test.ts.
for (const framework of FRAMEWORKS) {
  test(`${framework} keeps the type of a mention the editor copied, so a tag mention pastes back as a tag`, async ({ page }) => {
    await open(page, framework, { mention: '1' });
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const { editor } = probe;
      if (!editor.setContent('<p>See <span data-type="mention" data-id="f1" data-label="feature" data-mention-type="tag">#feature</span> and '
        + '<span data-type="mention" data-id="u1" data-label="Ana" data-mention-type="user">@Ana</span></p>', false)) throw new Error('Could not seed the editor');
      editor.view.focus();
      probe.select(1, editor.state.doc.content.size - 1);
    });
    await page.keyboard.press('ControlOrMeta+c');
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
      probe.editor.view.focus();
      probe.select(1);
      probe.clearObservations();
    });
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => page.evaluate(() => {
      const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
      const mentions: string[] = [];
      editor.state.doc.descendants(node => { if (node.type.name === 'mention') mentions.push(`${String(node.attrs['type'])} ${String(node.attrs['label'])}`); });
      return { text: editor.state.doc.textContent, mentions };
    })).toEqual({ text: 'See #feature and @Ana', mentions: ['tag feature', 'user Ana'] });
  });
}

// Unit tests: packages/core/src/marks/helpers/linkPastePlugin.selection.test.ts.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
for (const framework of FRAMEWORKS) {
  test(`${framework} replaces a selected image with a pasted address as a link`, async ({ page }) => {
    await open(page, framework);
    await page.evaluate(png => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      if (!probe.editor.setContent(`<p>before</p><img src="${png}" alt="i"><p>after</p>`, false)) throw new Error('Could not seed the editor');
    }, PNG);
    await page.locator('.ProseMirror img').click();
    expect(await page.evaluate(() => ((window as unknown as ProbeWindow).__pasteCleanup.editor.state.selection.toJSON() as { type: string }).type)).toBe('node');
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      probe.clearObservations();
      const data = new DataTransfer();
      data.setData('text/plain', 'https://example.com/page');
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      probe.editor.view.dom.dispatchEvent(event);
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.map(operation => operation.status))).toEqual(['applied']);
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML()))
      .toMatch(/^<p[^>]*>before<\/p><p[^>]*><a href="https:\/\/example\.com\/page"[^>]*>https:\/\/example\.com\/page<\/a><\/p><p[^>]*>after<\/p>$/);
  });
}
