/** Built-in destination probes through real wrappers. Clipboard events are synthetic. */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { NormalizePasteHTMLResult, PasteNormalizationContext, PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const TABLE_HTML = '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>';
const HEADING_NOTICE = 'Some headings were changed to a heading level this editor supports.';
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
  schema?: 'capability-minimal' | 'capability-full' | 'heading-levels'; formatting?: 'preserve' | 'adapt'; diagnostics?: 'one';
  'link-protocols'?: 'https'; 'smart-paste'?: 'off'; 'unique-id'?: 'off';
} = {}): Promise<void> {
  const query = new URLSearchParams({ framework, ...options });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.framework)).toBe(framework);
  expect(await page.evaluate(() => {
    const names = (window as unknown as ProbeWindow).__pasteCleanup.editor.extensionManager.extensions.map(extension => extension.name);
    return { smartPaste: names.includes('smartPaste'), uniqueID: names.includes('uniqueID') };
  })).toEqual({ smartPaste: options['smart-paste'] !== 'off', uniqueID: options['unique-id'] !== 'off' });
  if (options.schema === 'capability-minimal') {
    expect(await page.evaluate(() => {
      const schema = (window as unknown as ProbeWindow).__pasteCleanup.editor.state.schema;
      return { nodes: Object.keys(schema.nodes).sort(), marks: Object.keys(schema.marks).sort() };
    })).toEqual({ nodes: ['doc', 'paragraph', 'text'], marks: [] });
  }
  if (options.schema === 'heading-levels') {
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.extensionManager.extensions
      .find(extension => extension.name === 'heading')?.options)).toMatchObject({ levels: [2, 3] });
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

function headings(page: Page): Promise<{ level: unknown; text: string }[]> {
  return page.evaluate(() => {
    const output: { level: unknown; text: string }[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.type.name === 'heading') output.push({ level: node.attrs['level'], text: node.textContent });
    });
    return output;
  });
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

    test('keeps links whose scheme the editor stores and reports each other one as link-removed (H2, H3, H9)', async ({ page }) => {
      // The probe parses constant anchors in a detached container: no request may leave the page.
      const requests: string[] = [];
      page.on('request', request => { if (!request.url().startsWith(BASE_URL)) requests.push(request.url()); });
      const html = '<p><a href="http://a.example/">http</a> <a href="https://b.example/">https</a> '
        + '<a href="mailto:c@c.example">mail</a> <a href="tel:+385123">phone</a></p>';
      const linked = (): Promise<[string, unknown][]> => page.evaluate(() => {
        const found: [string, unknown][] = [];
        (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
          const link = node.marks.find(mark => mark.type.name === 'link');
          if (node.isText && link) found.push([node.text ?? '', link.attrs['href']]);
        });
        return found;
      });

      await open(page, framework, { 'link-protocols': 'https' });
      await seed(page);
      let observed = await paste(page, html);
      expect(await linked()).toEqual([['https', 'https://b.example/']]);
      await expect(page.locator('.ProseMirror')).toHaveText('http https mail phone');
      expect(observed.results[0]?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['link-removed', 'link-removed', 'link-removed']);
      expect(observed.operations[0]?.status).toBe('applied');

      await open(page, framework, { schema: 'capability-minimal' });
      await seed(page);
      observed = await paste(page, html);
      expect(await linked()).toEqual([]);
      await expect(page.locator('.ProseMirror')).toHaveText('http https mail phone');
      expect(observed.results[0]?.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['link-removed', 'link-removed', 'link-removed', 'link-removed']);
      expect(requests.filter(url => url.includes('probe.invalid') || url.includes('.example'))).toEqual([]);
    });

    test('default heading levels paste level five as level four and report it', async ({ page }) => {
      await open(page, framework);
      await seed(page);
      const observed = await paste(page, '<h5>Level five</h5>');
      await expect(page.locator('.ProseMirror h4')).toHaveText('Level five');
      await expect(page.locator('.ProseMirror h5')).toHaveCount(0);
      expect(await headings(page)).toEqual([{ level: 4, text: 'Level five' }]);
      expect(observed.results[0]?.diagnostics).toEqual([{ code: 'destination-heading-level-adapted', severity: 'warning', offset: 0 }]);
      expect(observed.operations[0]?.status).toBe('applied');
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await expect(notice.getByRole('status')).toHaveText('Review the pasted content.');
      await notice.locator('summary').click();
      await expect(notice.locator('li')).toHaveText([HEADING_NOTICE]);
    });

    test('configured levels two and three keep every pasted heading in outline order', async ({ page }) => {
      await open(page, framework, { schema: 'heading-levels' });
      await seed(page);
      const before = await snapshot(page);
      const html = '<h1>Title</h1><h2>Section</h2><h4>Detail</h4><h6>Note</h6>';
      const observed = await paste(page, html);
      expect(await headings(page)).toEqual([
        { level: 2, text: 'Title' }, { level: 2, text: 'Section' }, { level: 3, text: 'Detail' }, { level: 3, text: 'Note' },
      ]);
      expect(observed.results[0]?.diagnostics).toEqual(['<h1', '<h4', '<h6'].map(tag => ({
        code: 'destination-heading-level-adapted', severity: 'warning', offset: html.indexOf(tag),
      })));
      expect(observed.operations[0]?.status).toBe('applied');
      expect(observed.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await notice.locator('summary').click();
      await expect(notice.locator('li')).toHaveText([HEADING_NOTICE]);
      expect(await history(page)).toEqual({ undo: 1, redo: 0 });
      // The disclosure took focus; undo belongs to the editor.
      await page.locator('.ProseMirror').focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => snapshot(page)).toEqual(before);
    });

    test('a destination without headings keeps the text as a paragraph with the general warning', async ({ page }) => {
      await open(page, framework, { schema: 'capability-minimal' });
      await seed(page);
      const observed = await paste(page, '<h5>Level five</h5>');
      await expect(page.locator('.ProseMirror p')).toHaveText('Level five');
      expect(await headings(page)).toEqual([]);
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
      // A real loss fills the one-entry allowance; Office private declarations are routine and never warn.
      const observed = await paste(page, '<p><span style="position:fixed">Prefix</span></p>' + TABLE_HTML);
      expect(observed.results[0]?.diagnostics).toEqual([{ code: 'destination-table-unsupported', severity: 'error' }]);
      expect(observed.results[0]?.diagnosticsTruncated).toBe(true);
      // The retained terminal diagnostic renders the table refusal detail next to the truncation note.
      await unchangedBlocked(page, before, priorHistory, observed, true);
      const notice = page.getByRole('region', { name: 'Paste notice', exact: true });
      await expect(notice).toContainText('Not all paste details are shown.');
    });
  });
}

/**
 * Caret seeds of the heading notice matrix. `|` marks the caret and `[` `]` a selected range, and
 * both are removed before the paste; a seed without a mark selects the whole document. `hL` is the
 * level pasted headings adapt to, so a seed heading at that level can share their markup.
 */
const NOTICE_SEEDS: readonly (readonly [name: string, html: string])[] = [
  ['an empty paragraph', '<p>|</p>'],
  ['the start of a paragraph', '<p>|Hello world</p>'],
  ['the middle of a paragraph', '<p>Hello |world</p>'],
  ['the end of a paragraph', '<p>Hello world|</p>'],
  ['the start of a level 2 heading', '<h2>|Hello world</h2>'],
  ['the middle of a level 2 heading', '<h2>Hello |world</h2>'],
  ['an empty level 2 heading', '<h2>|</h2>'],
  ['an empty heading at the adapted level', '<hL>|</hL>'],
  ['a wholly selected heading at the adapted level', '<hL>[Hello world]</hL>'],
  ['the start of a heading at the adapted level', '<hL>|Hello world</hL>'],
  ['the middle of a heading at the adapted level', '<hL>Hello |world</hL>'],
  ['an empty list item label', '<ul><li><p>|</p></li></ul>'],
  ['the start of a list item label', '<ul><li><p>|Hello world</p></li></ul>'],
  ['the middle of a list item label', '<ul><li><p>Hello |world</p></li></ul>'],
  ['the middle of a heading at the adapted level in a list item', '<ul><li><p>Label</p><hL>Hello |world</hL></li></ul>'],
  ['the middle of a quoted paragraph', '<blockquote><p>Hello |world</p></blockquote>'],
  ['the middle of a table cell', '<table><tr><td><p>Hello |world</p></td></tr></table>'],
  ['a range across two paragraphs', '<p>Hel[lo world</p><p>Second] line</p>'],
  ['a range from the start of a heading at the adapted level into a paragraph', '<hL>[Hello world</hL><p>Second] line</p>'],
  ['a range over a heading at the adapted level and a whole paragraph', '<hL>[Hello world</hL><p>Second line]</p>'],
  ['a range over a later heading at the adapted level and a whole paragraph', '<p>Intro</p><hL>[Hello world</hL><p>Second line]</p>'],
  ['a whole document selection', '<p>Hello world</p>'],
];
/** Each pasted heading has its own word, so a document shows where it went. */
const NOTICE_CLIPBOARDS = [
  '<h5>Five</h5>', '<h6>Six</h6>', '<h5>Five</h5><h6>Six</h6>', '<p>Lead</p><h5>Five</h5>', '<h5>Five</h5><p>Tail</p>',
  '<h2>Two</h2><h5>Five</h5>', '<h5>Alpha</h5><h2>Beta</h2>', '<h5>Alpha</h5><p>Mid</p><h6>Omega</h6>',
  '<blockquote><h5>Quoted</h5></blockquote>', '<ul><li><p>Item</p><h5>Nested</h5></li></ul>',
  '<h5>Linked <a href="javascript:alert(1)">here</a></h5>',
] as const;
/** Levels 2 and 3 adapt a level 1 heading up and levels 4 to 6 down. */
const NARROW_NOTICE_CLIPBOARDS = [
  '<h1>One</h1>', '<h5>Five</h5>', '<h1>One</h1><h5>Five</h5>', '<h4>Four</h4><p>Tail</p>', '<p>Lead</p><h6>Six</h6>',
  '<h2>Two</h2><h1>One</h1>', '<h5>Five</h5><h1>One</h1>',
] as const;

interface NoticeOutcome {
  seed: string;
  html: string;
  status: string;
  /** Every textblock in document order: its type, or `h` and its level, then its text. */
  blocks: string[];
  normalized: { code: string; offset?: number }[];
  reported: { code: string; offset?: number }[];
  /** The rows the notice lists, or null while it is hidden. */
  notice: string[] | null;
}

/** Pastes every clipboard at every seed through a synthetic paste event and records each outcome. */
function pasteNoticeMatrix(page: Page, clipboards: readonly string[], adaptedLevel: number): Promise<NoticeOutcome[]> {
  return page.evaluate(async ({ seeds, clipboards, adaptedLevel }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const editor = probe.editor;
    const outcomes: NoticeOutcome[] = [];
    for (const [seedName, seedHTML] of seeds) {
      for (const html of clipboards) {
        if (!editor.setContent(seedHTML.replaceAll('hL>', `h${String(adaptedLevel)}>`), false)) throw new Error('Could not seed the editor');
        const marks: { char: string; pos: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          const text = node.text ?? '';
          for (let index = 0; index < text.length; index++) if ('|[]'.includes(text.charAt(index))) marks.push({ char: text.charAt(index), pos: pos + index });
        });
        const transaction = editor.state.tr;
        for (const mark of [...marks].reverse()) transaction.delete(mark.pos, mark.pos + 1);
        editor.view.dispatch(transaction);
        // A mark's position after the marks before it are gone.
        const at = (char: string): number | undefined => {
          const index = marks.findIndex(mark => mark.char === char);
          return index < 0 ? undefined : (marks[index]?.pos ?? 0) - index;
        };
        const caret = at('|');
        const from = at('[');
        const to = at(']');
        if (caret !== undefined) probe.select(caret);
        else if (from !== undefined && to !== undefined) probe.select(from, to);
        else editor.commands.selectAll();
        probe.clearObservations();
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'Synthetic clipboard content');
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        editor.view.dom.dispatchEvent(event);
        for (let attempt = 0; attempt < 50 && probe.operations.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
        const operation = probe.operations[0];
        const result = probe.results[0];
        if (operation === undefined || result === undefined || probe.operations.length !== 1) throw new Error(`No single paste result for ${html} at ${seedName}`);
        const blocks: string[] = [];
        editor.state.doc.descendants(node => {
          if (node.isTextblock) blocks.push(`${node.type.name === 'heading' ? `h${String(node.attrs['level'])}` : node.type.name}:${node.textContent}`);
        });
        const region = document.querySelector('[role="region"][aria-label="Paste notice"]');
        outcomes.push({
          seed: seedName, html, status: operation.status, blocks,
          normalized: result.diagnostics.map(({ code, offset }) => offset === undefined ? { code } : { code, offset }),
          reported: operation.diagnostics.map(({ code, offset }) => offset === undefined ? { code } : { code, offset }),
          notice: region instanceof HTMLElement && !region.hidden ? Array.from(region.querySelectorAll('li'), row => row.textContent) : null,
        });
      }
    }
    return outcomes;
  }, { seeds: NOTICE_SEEDS, clipboards, adaptedLevel });
}

const ADAPTED_CODE = 'destination-heading-level-adapted';
/** The pasted heading a source offset points at, as its tag level and the text before its first element. */
function pastedHeadingAt(html: string, offset: number | undefined): string {
  const match = offset === undefined ? null : /^<h([1-6])>([^<]*)/.exec(html.slice(offset));
  return match === null ? '?' : `h${match[1] ?? ''}:${match[2] ?? ''}`;
}
function headingLabels(outcome: NoticeOutcome, diagnostics: NoticeOutcome['reported']): string[] {
  return diagnostics.filter(item => item.code === ADAPTED_CODE).map(item => pastedHeadingAt(outcome.html, item.offset));
}
function nearestLevel(level: number, levels: readonly number[]): number {
  return levels.filter(candidate => candidate >= level).sort((a, b) => a - b)[0] ?? Math.max(...levels);
}

/**
 * Checks each outcome against the same paste in an editor with all six levels, where no heading
 * adapts: a pasted heading the notice reports must be one that editor keeps as a heading at its
 * own level, so its adaptation changed the document, and every other must merge there too.
 */
function expectNoticesFollowFullLevels(adapted: NoticeOutcome[], full: NoticeOutcome[], levels: readonly number[]): { removed: number; kept: number } {
  expect(adapted.map(({ seed, html }) => `${html} at ${seed}`)).toEqual(full.map(({ seed, html }) => `${html} at ${seed}`));
  let removed = 0;
  let kept = 0;
  adapted.forEach((outcome, index) => {
    const counterpart = full[index];
    if (counterpart === undefined) throw new Error('Missing full-level outcome');
    const name = `${outcome.html} at ${outcome.seed}`;
    const pasted = [...outcome.html.matchAll(/<h([1-6])>([^<]*)/g)]
      .filter(match => !levels.includes(Number(match[1]))).map(match => `h${match[1] ?? ''}:${match[2] ?? ''}`);
    const landed = pasted.filter(label => counterpart.blocks.some(block => block.startsWith(label)));
    expect({ name, status: outcome.status, full: counterpart.status }).toEqual({ name, status: 'applied', full: 'applied' });
    expect({ name, normalized: headingLabels(outcome, outcome.normalized) }).toEqual({ name, normalized: pasted });
    expect({ name, reported: headingLabels(outcome, outcome.reported) }).toEqual({ name, reported: landed });
    const others = (diagnostics: NoticeOutcome['reported']): NoticeOutcome['reported'] => diagnostics.filter(item => item.code !== ADAPTED_CODE);
    expect({ name, others: others(outcome.reported) }).toEqual({ name, others: others(outcome.normalized) });
    expect({ name, notice: outcome.notice === null ? null : outcome.notice.includes(HEADING_NOTICE) })
      .toEqual({ name, notice: outcome.reported.length === 0 ? null : landed.length > 0 });
    // Adapting a heading changes its level and nothing else in the document.
    const mapped = counterpart.blocks.map(block => block.replace(/^h([1-6]):/, (_, level: string) => `h${String(nearestLevel(Number(level), levels))}:`));
    expect({ name, blocks: outcome.blocks }).toEqual({ name, blocks: mapped });
    removed += pasted.length - landed.length;
    kept += landed.length;
  });
  return { removed, kept };
}

function noticeOutcome(outcomes: NoticeOutcome[], html: string, seed: string): NoticeOutcome {
  const found = outcomes.find(outcome => outcome.html === html && outcome.seed === seed);
  if (found === undefined) throw new Error(`No outcome for ${html} at ${seed}`);
  return found;
}

for (const framework of FRAMEWORKS) {
  for (const smartPaste of [true, false]) {
    for (const uniqueID of [true, false]) {
      const setup = `${smartPaste ? 'with' : 'without'} SmartPaste, ${uniqueID ? 'with' : 'without'} block ids`;
      const options = { ...(smartPaste ? {} : { 'smart-paste': 'off' as const }), ...(uniqueID ? {} : { 'unique-id': 'off' as const }) };
      test(`${framework}: the heading notice reports exactly the adapted headings that reach the document as headings, ${setup}`, async ({ page }) => {
        await open(page, framework, { ...options, schema: 'capability-full' });
        const full = await pasteNoticeMatrix(page, NOTICE_CLIPBOARDS, 4);
        await open(page, framework, options);
        const adapted = await pasteNoticeMatrix(page, NOTICE_CLIPBOARDS, 4);
        expect(adapted).toHaveLength(NOTICE_SEEDS.length * NOTICE_CLIPBOARDS.length);
        const { removed, kept } = expectNoticesFollowFullLevels(adapted, full, [1, 2, 3, 4]);
        // SmartPaste inserts most pasted headings as blocks, so fewer merge.
        expect(removed).toBeGreaterThan(smartPaste ? 10 : 20);
        expect(kept).toBeGreaterThan(20);
        const middle = noticeOutcome(adapted, '<h5>Five</h5>', 'the middle of a paragraph');
        const second = noticeOutcome(adapted, '<h5>Five</h5><h6>Six</h6>', 'the middle of a paragraph');
        if (smartPaste) {
          expect(middle).toMatchObject({ blocks: ['paragraph:Hello ', 'h4:Five', 'paragraph:world'], notice: [HEADING_NOTICE] });
          expect(second.blocks).toEqual(['paragraph:Hello ', 'h4:Five', 'h4:Six', 'paragraph:world']);
        } else {
          expect(middle).toMatchObject({ blocks: ['paragraph:Hello Fiveworld'], reported: [], notice: null });
          expect(second).toMatchObject({ blocks: ['paragraph:Hello Five', 'h4:Sixworld'], notice: [HEADING_NOTICE] });
          expect(headingLabels(second, second.reported)).toEqual(['h6:Six']);
        }
        expect(noticeOutcome(adapted, '<h5>Five</h5>', 'the middle of a heading at the adapted level'))
          .toMatchObject({ blocks: ['h4:Hello Fiveworld'], reported: [], notice: null });
        // An empty heading at level 4 takes the pasted heading: kept as the same node without ids, replaced with them.
        expect(noticeOutcome(adapted, '<h5>Five</h5>', 'an empty heading at the adapted level'))
          .toMatchObject({ blocks: ['h4:Five'], notice: [HEADING_NOTICE] });
        const linked = noticeOutcome(adapted, '<h5>Linked <a href="javascript:alert(1)">here</a></h5>', 'the middle of a paragraph');
        expect(linked.reported.map(item => item.code)).toEqual(smartPaste ? ['link-removed', ADAPTED_CODE] : ['link-removed']);
      });
    }
  }

  test(`${framework}: with levels 2 and 3 the heading notice follows the same rule for headings adapted up and down`, async ({ page }) => {
    for (const smartPaste of [true, false]) {
      const options = { 'unique-id': 'off' as const, ...(smartPaste ? {} : { 'smart-paste': 'off' as const }) };
      await open(page, framework, { ...options, schema: 'capability-full' });
      const full = await pasteNoticeMatrix(page, NARROW_NOTICE_CLIPBOARDS, 3);
      await open(page, framework, { ...options, schema: 'heading-levels' });
      const adapted = await pasteNoticeMatrix(page, NARROW_NOTICE_CLIPBOARDS, 3);
      const { removed, kept } = expectNoticesFollowFullLevels(adapted, full, [2, 3]);
      expect(removed).toBeGreaterThan(5);
      expect(kept).toBeGreaterThan(5);
      // A level 1 heading pasted into an empty level 2 heading fills it.
      expect(noticeOutcome(adapted, '<h1>One</h1>', 'an empty level 2 heading')).toMatchObject({ blocks: ['h2:One'], notice: [HEADING_NOTICE] });
    }
  });
}
