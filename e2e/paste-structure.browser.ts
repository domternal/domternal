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
 * first text position without one), or selects the `select` characters before it, pastes the
 * clipboard and returns the document.
 */
async function paste(page: Page, seed: string, clipboard: { html?: string; text?: string }, caret?: string, select = 0): Promise<Pasted> {
  await page.evaluate(({ seed, clipboard, caret, select }) => {
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
    probe.select(pos - select, pos);
    probe.clearObservations();
    const data = new DataTransfer();
    if (clipboard.html !== undefined) data.setData('text/html', clipboard.html);
    if (clipboard.text !== undefined) data.setData('text/plain', clipboard.text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('The editor did not handle the paste');
  }, { seed, clipboard, caret, select });
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

  test(`${framework} keeps selected text that a link to the pasted address already marks`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await open(page, framework, cleanup === 'on' ? {} : { 'paste-cleanup': 'off' });
      // All of the link's text, then part of it.
      for (const [caret, select] of [['this', 4], ['thi', 2]] as const) {
        const pasted = await paste(page, '<p>read <a href="https://example.com/page">this</a> now</p>', { text: 'https://example.com/page' }, caret, select);
        expect(pasted.doc, `PasteCleanup ${cleanup}, ${caret}`).toBe('doc(paragraph("read ", link("this"), " now"))');
        if (cleanup === 'on') expect(pasted.status, caret).toEqual(['noop']);
      }
    }
  });
}

/** The document's top-level blocks as `type: text`, for shapes whose marks depend on where the copy came from. */
function blocks(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.forEach(node => { found.push(`${node.type.name}: ${node.textContent}`); });
    return found;
  });
}

/**
 * Seeds the document and copies its text from the start of the first `from` to the end of the
 * first `to` with the keyboard, then puts the caret after the first `caret`, or at the end of the
 * document for an empty one, and pastes with the keyboard, so the browser writes and reads the clipboard.
 */
async function copyAndPaste(page: Page, seed: string, from: string, to: string, caret: string): Promise<void> {
  await page.evaluate(({ seed, from, to }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(seed, false)) throw new Error('Could not seed the editor');
    const at = (text: string, end: boolean): number => {
      let found = -1;
      probe.editor.state.doc.descendants((node, pos) => {
        if (found < 0 && node.isText && node.text?.includes(text) === true) found = pos + node.text.indexOf(text) + (end ? text.length : 0);
      });
      return found;
    };
    probe.editor.view.focus();
    probe.select(at(from, false), at(to, true));
  }, { seed, from, to });
  await page.keyboard.press('ControlOrMeta+c');
  await page.evaluate(caret => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    // An empty caret text puts the caret in the document's last textblock, at its end.
    let pos = caret === '' ? probe.editor.state.doc.content.size - 1 : -1;
    probe.editor.state.doc.descendants((node, at) => {
      if (pos < 0 && node.isText && node.text?.includes(caret) === true) pos = at + node.text.lastIndexOf(caret) + caret.length;
    });
    probe.editor.view.focus();
    probe.select(pos);
    probe.clearObservations();
  }, caret);
  await page.keyboard.press('ControlOrMeta+v');
}

// Unit tests: packages/extension-block-controls/src/SmartPaste.copiedText.test.ts.
for (const framework of FRAMEWORKS) {
  test(`${framework} joins text copied from inside a list item or quote to the paragraph it is pasted into`, async ({ page }) => {
    for (const query of [{}, { 'paste-cleanup': 'off' }] as Record<string, string>[]) {
      await open(page, framework, query);
      for (const [source, block] of [['<ul><li><p>alpha beta</p></li></ul>', 'bulletList'], ['<blockquote><p>alpha beta</p></blockquote>', 'blockquote']] as const) {
        await copyAndPaste(page, `${source}<p>x</p>`, 'beta', 'beta', 'x');
        await expect.poll(() => blocks(page), `${source} ${JSON.stringify(query)}`).toEqual([`${block}: alpha beta`, 'paragraph: xbeta']);
      }
    }
  });
}

// Unit tests: packages/extension-details/src/Details.pasteBody.test.ts.
for (const framework of FRAMEWORKS) {
  test(`${framework} pastes blocks copied from a details body as blocks, not in a collapsed details`, async ({ page }) => {
    for (const cleanup of ['on', 'off']) {
      await open(page, framework, { details: '1', ...(cleanup === 'on' ? {} : { 'paste-cleanup': 'off' }) });
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        const { editor } = probe;
        if (!editor.setContent('<details><summary>Sum</summary><div data-details-content><p>one</p><p>two</p></div></details>', false)) {
          throw new Error('Could not seed the editor');
        }
        let from = 0;
        let to = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && node.text === 'one') from = pos;
          if (node.isText && node.text === 'two') to = pos + node.nodeSize;
        });
        editor.view.focus();
        probe.select(from, to);
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
      await expect.poll(() => blocks(page), `PasteCleanup ${cleanup}`).toEqual(['paragraph: one', 'paragraph: two']);
      await expect(page.locator('.ProseMirror p', { hasText: 'two' })).toBeVisible();
    }
  });
}

// Unit tests: packages/extension-details/src/Details.pasteSummary.test.ts.
const SUMMARY = '<details><summary>Title</summary><div data-details-content><p>body</p></div></details>';
const IN_CONTENT = (blocks: string): string => `doc(details(detailsSummary("Title"), detailsContent(${blocks}, paragraph("body"))))`;
for (const framework of FRAMEWORKS) {
  test(`${framework} keeps a details summary whole and puts blocks pasted into it at the start of the opened content`, async ({ page }) => {
    for (const query of [{}, { 'paste-cleanup': 'off' }, { 'smart-paste': 'off' }] as Record<string, string>[]) {
      await open(page, framework, { details: '1', ...query });
      for (const caret of ['Title', 'Ti']) {
        const label = `${JSON.stringify(query)} after ${caret}`;
        expect(await paste(page, SUMMARY, { html: '<p>a</p><ul><li>l1</li><li>l2</li></ul>', text: 'a\nl1\nl2' }, caret), label)
          .toMatchObject({ doc: IN_CONTENT('paragraph("a"), bulletList(listItem(paragraph("l1")), listItem(paragraph("l2")))'), valid: true });
        await expect(page.locator('.ProseMirror [data-type="details"]'), label).toHaveClass(/is-open/);
        await expect(page.locator('.ProseMirror li', { hasText: 'l2' }), label).toBeVisible();
      }
      // Inline content still joins the summary's text.
      expect(await paste(page, SUMMARY, { html: '<p>add</p>', text: 'add' }, 'Title'), JSON.stringify(query))
        .toMatchObject({ doc: 'doc(details(detailsSummary("Titleadd"), detailsContent(paragraph("body"))))', valid: true });
    }
  });
}

/** Pastes a DataTransfer with the HTML and a PNG file, bound to `cid:private-chart` for image assets, after the first `caret`. */
async function pasteFile(page: Page, seed: string, caret: string, html?: string): Promise<void> {
  await page.evaluate(({ seed, caret, html, png }) => {
    const probe = (window as unknown as ProbeWindow & { __pasteCleanup: { setAssetBindings: (bindings: { reference: string; itemIndex: number }[]) => void } }).__pasteCleanup;
    if (!probe.editor.setContent(seed, false)) throw new Error('Could not seed the editor');
    let pos = -1;
    probe.editor.state.doc.descendants((node, at) => {
      if (pos < 0 && node.isText && node.text?.includes(caret) === true) pos = at + node.text.indexOf(caret) + caret.length;
    });
    probe.select(pos);
    probe.clearObservations();
    const data = new DataTransfer();
    if (html !== undefined) data.setData('text/html', html);
    const index = data.items.length;
    data.items.add(new File([Uint8Array.from(atob(png.slice(png.indexOf(',') + 1)), c => c.charCodeAt(0))], 'a.png', { type: 'image/png' }));
    probe.setAssetBindings([{ reference: 'cid:private-chart', itemIndex: index }]);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    probe.editor.view.dom.dispatchEvent(event);
  }, { seed, caret, html, png: PNG });
}

const docOf = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.toString());

for (const framework of FRAMEWORKS) {
  test(`${framework} pastes an image file, prepared image assets and a refused paste into a summary in one transaction`, async ({ page }) => {
    const details = page.locator('.ProseMirror [data-type="details"]');
    // An image file, which PasteCleanup and the image node insert.
    for (const query of [{}, { 'paste-cleanup': 'off' }] as Record<string, string>[]) {
      await open(page, framework, { details: '1', ...query });
      await pasteFile(page, SUMMARY, 'Title');
      await expect.poll(() => docOf(page), JSON.stringify(query)).toBe(IN_CONTENT('image'));
      await expect(details, JSON.stringify(query)).toHaveClass(/is-open/);
    }
    // Content whose image PasteCleanup prepares first, then pastes against the document it captured.
    await open(page, framework, { details: '1', assets: 'embedded' });
    await pasteFile(page, SUMMARY, 'Title', '<p>New</p><img src="cid:private-chart" alt="Chart"><p>End</p>');
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.map(operation => operation.status))).toEqual(['applied']);
    expect(await docOf(page)).toBe(IN_CONTENT('paragraph("New"), image, paragraph("End")'));
    await expect(details).toHaveClass(/is-open/);
    // A paste a CharacterCount limit refuses leaves the details as it was, and closed.
    await open(page, framework, { details: '1', limit: '12' });
    expect(await paste(page, SUMMARY, { html: '<p>aaaaaaaaaa</p><p>bbbbbbbbbb</p>', text: 'aaaaaaaaaa\n\nbbbbbbbbbb' }, 'Title'))
      .toMatchObject({ doc: 'doc(details(detailsSummary("Title"), detailsContent(paragraph("body"))))', valid: true });
    await expect(details).not.toHaveClass(/is-open/);
  });

  test(`${framework} joins text copied from inside a list item, and a line copied with its line break, to a summary`, async ({ page }) => {
    for (const query of [{}, { 'paste-cleanup': 'off' }, { 'smart-paste': 'off' }] as Record<string, string>[]) {
      await open(page, framework, { details: '1', ...query });
      await copyAndPaste(page, `<ul><li><p>alpha beta</p></li></ul>${SUMMARY}`, 'beta', 'beta', 'Title');
      await expect.poll(() => docOf(page), JSON.stringify(query))
        .toBe('doc(bulletList(listItem(paragraph("alpha beta"))), details(detailsSummary("Titlebeta"), detailsContent(paragraph("body"))))');
      expect(await paste(page, SUMMARY, { text: 'word\n' }, 'Title'), JSON.stringify(query))
        .toMatchObject({ doc: 'doc(details(detailsSummary("Titleword"), detailsContent(paragraph("body"))))', valid: true });
    }
  });
}

// Unit tests: packages/extension-markdown/src/pastePlugin.summary.test.ts.
for (const framework of FRAMEWORKS) {
  test(`${framework} pastes Markdown into a details summary as text, and Markdown lines into its content`, async ({ page }) => {
    await open(page, framework, { details: '1' });
    expect(await paste(page, SUMMARY, { text: '- item' }, 'Title'))
      .toMatchObject({ doc: 'doc(details(detailsSummary("Title- item"), detailsContent(paragraph("body"))))', valid: true });
    expect(await paste(page, SUMMARY, { text: '# Head' }, 'Title'))
      .toMatchObject({ doc: 'doc(details(detailsSummary("TitleHead"), detailsContent(paragraph("body"))))', valid: true });
    expect(await paste(page, SUMMARY, { text: '# Head\n\n- one' }, 'Title'))
      .toMatchObject({ doc: IN_CONTENT('heading("Head"), bulletList(listItem(paragraph("one")))'), valid: true });
    await expect(page.locator('.ProseMirror [data-type="details"]')).toHaveClass(/is-open/);
  });
}

// Unit tests: packages/extension-paste-cleanup/src/html/listItemLabels.test.ts and src/PasteCleanup.listItemLabels.test.ts.
const NESTED = (kind: string, inner: string, later: string): string =>
  `${kind}(listItem(paragraph, ${kind}(listItem(paragraph("${inner}")))), listItem(paragraph("${later}")))`;
const LABELS: Record<string, { html: string; doc: string }> = {
  'after a paragraph': { html: '<p>p</p><ul><li><ul><li>a</li></ul></li><li>b</li></ul>', doc: `doc(paragraph("p"), ${NESTED('bulletList', 'a', 'b')})` },
  'numbered, after a paragraph': { html: '<p>p</p><ol><li><ol><li>a</li></ol></li><li>b</li></ol>', doc: `doc(paragraph("p"), ${NESTED('orderedList', 'a', 'b')})` },
  'in a later item': {
    html: '<ul><li>a</li><li><ul><li>b</li></ul></li></ul>', doc: 'doc(bulletList(listItem(paragraph("a")), listItem(paragraph, bulletList(listItem(paragraph("b"))))))',
  },
};
for (const framework of FRAMEWORKS) {
  test(`${framework} keeps a nested list that starts a list item in its item with PasteCleanup`, async ({ page }) => {
    for (const query of [{}, { 'smart-paste': 'off' }] as Record<string, string>[]) {
      await open(page, framework, query);
      for (const [name, { html, doc }] of Object.entries(LABELS)) {
        expect(await paste(page, '<p></p>', { html, text: 'fallback' }), `${name} ${JSON.stringify(query)}`)
          .toEqual({ doc, valid: true, status: ['applied'] });
      }
    }
  });
}

// Unit tests: packages/extension-paste-cleanup/src/html/editorChrome.test.ts and src/PasteCleanup.editorChrome.test.ts.
const CHROME: Record<string, string> = {
  'a to-do list': '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>done</p></li><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>',
  'an aligned image': `<p>x</p><img src="${PNG}" data-align="center"><p>y</p>`,
};
for (const framework of FRAMEWORKS) {
  test(`${framework} pastes an own copy of a to-do list or an aligned image with no notice`, async ({ page }) => {
    await open(page, framework, { 'list-markers': '1' });
    for (const [name, content] of Object.entries(CHROME)) {
      const before = await page.evaluate(content => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent(content, false)) throw new Error('Could not seed the editor');
        probe.editor.view.focus();
        probe.select(1, probe.editor.state.doc.content.size - 1);
        return probe.editor.state.doc.toString();
      }, content);
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+c');
      await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
        probe.editor.view.focus();
        probe.select(1);
        probe.clearObservations();
      });
      await page.keyboard.press('ControlOrMeta+v');
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.map(operation => operation.status)), name)
        .toEqual(['applied']);
      expect(await page.evaluate(() => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        return { doc: probe.editor.state.doc.toString(), codes: probe.results.flatMap(result => result.diagnostics.map(diagnostic => diagnostic.code)) };
      }), name).toEqual({ doc: before, codes: [] });
      await expect(page.locator('.dm-paste-feedback'), name).toBeHidden();
    }
  });
}
