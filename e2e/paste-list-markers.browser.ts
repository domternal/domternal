/** Built public schemas, default theme and synthetic clipboard list-marker editing. */
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
    closeHistory: () => void;
    history: () => { undo: number; redo: number };
    select: (from: number, to?: number) => void;
    snapshot: () => Snapshot;
    serializeSelection: () => { html: string; text: string };
  };
}
type Formatting = 'preserve' | 'adapt';
type Marker = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman' | 'disc' | 'circle' | 'square' | null;

/** Drop generated identities only; null marker policy and all other semantic fields remain exact. */
function canonical(node: JSONContent): JSONContent {
  const result = { ...node };
  if (result.attrs) {
    result.attrs = { ...result.attrs }; delete result.attrs['id'];
    if (Object.keys(result.attrs).length === 0) delete result.attrs;
  }
  if (result.content) result.content = result.content.map(canonical);
  return result;
}
const text = (value: string, bold = false): JSONContent => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
const p = (value = '', bold = false): JSONContent => ({ type: 'paragraph', attrs: { textAlign: 'left' }, ...(value ? { content: [text(value, bold)] } : {}) });
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content });
const ol = (marker: Marker, content: JSONContent[], start = 1): JSONContent => ({ type: 'orderedList', attrs: { start, listStyleType: marker }, content });
const ul = (marker: Marker, content: JSONContent[]): JSONContent => ({ type: 'bulletList', attrs: { listStyleType: marker }, content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const listHTML = (tag: 'ol' | 'ul', marker: string | null, ...labels: string[]): string =>
  `<${tag}${marker ? ` style="list-style-type:${marker}"` : ''}>${labels.map(value => `<li><p>${value}</p></li>`).join('')}</${tag}>`;

async function open(page: Page, framework: string, formatting: Formatting = 'preserve', legacy = false, schema?: 'capability-full'): Promise<void> {
  await page.goto(`http://127.0.0.1:5895/?${new URLSearchParams({ framework, formatting, 'list-markers': '1',
    ...(legacy ? { 'list-marker-policy': 'legacy' } : {}), ...(schema === undefined ? {} : { schema }),
  }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.dm-editor .ProseMirror')).toBeVisible();
}
async function seed(page: Page, html: string): Promise<void> {
  await page.evaluate(html => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Cannot seed list editor');
    probe.editor.commands.focus('all'); probe.closeHistory(); probe.clearObservations();
  }, html);
}
async function snapshot(page: Page): Promise<Snapshot> { return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.snapshot()); }
async function caret(page: Page, position: number): Promise<void> {
  expect((await snapshot(page)).selection).toEqual({ type: 'text', anchor: position, head: position });
}
async function selection(page: Page, fromText: string, fromOffset: number, toText = fromText, toOffset = fromOffset): Promise<void> {
  await page.evaluate(({ fromText, fromOffset, toText, toOffset }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const found = new Map<string, { pos: number; size: number }>();
    probe.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && [fromText, toText].includes(node.textContent)) {
        if (found.has(node.textContent)) throw new Error('Selection label is ambiguous');
        found.set(node.textContent, { pos: pos + 1, size: node.content.size });
      }
    });
    const first = found.get(fromText); const last = found.get(toText);
    if (!first || !last || fromOffset > first.size || toOffset > last.size) throw new Error('Selection fixture is missing');
    probe.select(first.pos + fromOffset, last.pos + toOffset);
    probe.editor.view.focus(); probe.closeHistory(); probe.clearObservations();
  }, { fromText, fromOffset, toText, toOffset });
}
async function paste(page: Page, html: string, text = ''): Promise<void> {
  expect(await page.evaluate(({ html, text }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const data = new DataTransfer(); data.setData('text/html', html); data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    probe.editor.view.dom.dispatchEvent(event);
    return { trusted: event.isTrusted, prevented: event.defaultPrevented };
  }, { html, text })).toEqual({ trusted: false, prevented: true });
}
async function cleanPaste(page: Page): Promise<void> {
  const actual = await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    return { results: probe.results, transactions: probe.transactions };
  });
  expect(actual.results).toHaveLength(1);
  expect(actual.results[0]?.status).not.toBe('rejected');
  expect(actual.results[0]?.diagnostics.filter(entry => entry.severity !== 'info')).toEqual([]);
  expect(actual.transactions).toEqual([{ paste: true, uiEvent: 'paste' }]);
}
async function history(page: Page, before: Snapshot, expected: JSONContent): Promise<Snapshot> {
  const after = await snapshot(page); expect(canonical(after.doc)).toEqual(expected);
  expect(after).not.toEqual(before);
  await page.keyboard.press('ControlOrMeta+z'); await expect.poll(() => snapshot(page)).toEqual(before);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await expect.poll(() => snapshot(page)).toEqual(after);
  return after;
}
async function reload(page: Page, expected: JSONContent): Promise<void> {
  const actual = await page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const serializedJSON = JSON.stringify(editor.getJSON()); const html = editor.getHTML();
    const styled = editor.getHTML({ styled: true });
    if (!editor.commands.setContent('<p></p>', { emitUpdate: false })
      || !editor.commands.setContent(html, { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })) throw new Error('HTML reload failed');
    editor.state.doc.check(); const fromHTML = JSON.stringify(editor.getJSON());
    if (!editor.setContent('<p></p>', false) || !editor.setContent(JSON.parse(serializedJSON) as JSONContent, false)) throw new Error('JSON reload failed');
    editor.state.doc.check();
    const inspect = (value: string): string[] => Array.from(new DOMParser().parseFromString(value, 'text/html').querySelectorAll('ol,ul'))
      .map(node => (node as HTMLElement).style.listStyleType);
    return { fromHTML, fromJSON: JSON.stringify(editor.getJSON()), markers: inspect(html), styledMarkers: inspect(styled) };
  });
  expect(canonical(JSON.parse(actual.fromHTML) as JSONContent)).toEqual(expected);
  expect(canonical(JSON.parse(actual.fromJSON) as JSONContent)).toEqual(expected);
  const markers: (string | null)[] = [];
  const visit = (node: JSONContent): void => {
    if (node.type === 'orderedList' || node.type === 'bulletList') markers.push(node.attrs?.['listStyleType'] as string | null);
    node.content?.forEach(visit);
  };
  visit(expected);
  expect(actual.markers).toEqual(markers.map(value => value ?? ''));
  expect(actual.styledMarkers).toHaveLength(markers.length);
  markers.forEach((value, index) => { if (value !== null) expect(actual.styledMarkers[index]).toBe(value); });
}
async function computedMarkers(page: Page): Promise<string[]> {
  return page.locator('.ProseMirror ol,.ProseMirror ul').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).listStyleType));
}
async function styleQueries(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const style = document.createElement('style'); style.textContent = '.dm-marker-probe{--marker-probe:1}@container style(--marker-probe:1){.dm-marker-probe>i{color:rgb(0,128,0)}}';
    const host = document.createElement('div'); host.className = 'dm-marker-probe'; const child = document.createElement('i'); host.append(child);
    document.head.append(style); document.body.append(host);
    try { return getComputedStyle(child).color === 'rgb(0, 128, 0)'; } finally { host.remove(); style.remove(); }
  });
}

const mixedHTML = '<ol type="I" start="4"><li><p><strong>Roman</strong></p><ol style="list-style-type:decimal"><li><p>Fixed</p>'
  + '<ol><li><p>Default</p></li></ol></li></ol></li></ol>'
  + '<ol type="a"><li><p>Lower alpha</p></li></ol><ol type="A"><li><p>Upper alpha</p></li></ol>'
  + '<ol type="i"><li><p>Lower roman</p></li></ol><ol type="I" style="list-style-type:decimal"><li><p>CSS wins</p></li></ol>'
  + '<ul type="circle"><li><p>Circle</p></li></ul><ul type="square"><li><p>Square</p></li></ul>'
  + '<ul style="list-style-type:disc"><li><p>Disc</p></li></ul>';
const mixedJSON = doc(ol('upper-roman', [item(p('Roman', true), ol('decimal', [item(p('Fixed'), ol(null, [item(p('Default'))]))]))], 4),
  ol('lower-alpha', [item(p('Lower alpha'))]), ol('upper-alpha', [item(p('Upper alpha'))]), ol('lower-roman', [item(p('Lower roman'))]),
  ol('decimal', [item(p('CSS wins'))]), ul('circle', [item(p('Circle'))]), ul('square', [item(p('Square'))]), ul('disc', [item(p('Disc'))]));
const officeItem = (marker: string, label: string, level = 1): string =>
  `<p style="mso-list:l1 level${String(level)} lfo1"><span style="mso-list:Ignore">${marker} </span>${label}</p>`;
const officeHTML = officeItem('3.', 'Parent') + officeItem('4.', 'Nested', 2)
  + officeItem('•', 'Disc') + officeItem('◦', 'Circle') + officeItem('▪', 'Square')
  + officeItem('●', 'Filled') + officeItem('·', 'Dot');
const officeJSON = doc(ol('decimal', [item(p('Parent'), ol('decimal', [item(p('Nested'))], 4))], 3),
  ul('disc', [item(p('Disc'))]), ul('circle', [item(p('Circle'))]), ul('square', [item(p('Square'))]),
  ul('disc', [item(p('Filled')), item(p('Dot'))]));

// Word default bullets and numbering in the shape Word writes them, not a native capture: the
// level definitions live in the clipboard stylesheet and symbol bullets name their run font.
const wordStyle = '<style><!--\n@list l0:level1 {mso-level-number-format:bullet;mso-level-text:\\F0B7;font-family:Symbol;}\n'
  + '@list l0:level2 {mso-level-number-format:bullet;mso-level-text:o;font-family:"Courier New";}\n'
  + '@list l0:level3 {mso-level-number-format:bullet;mso-level-text:\\F0A7;font-family:Wingdings;}\n'
  + '@list l1:level1 {mso-level-tab-stop:none;}\n@list l1:level2 {mso-level-number-format:alpha-lower;}\n'
  + '@list l1:level3 {mso-level-number-format:roman-lower;mso-level-number-position:right;}\n--></style>';
const wordItem = (list: string, level: number, font: string, marker: string, label: string): string =>
  `<p class=MsoListParagraphCxSpMiddle style="margin-left:${String(level / 2)}in;text-indent:-.25in;mso-list:${list} level${String(level)} lfo1">`
  + `<![if !supportLists]><span style='${font}'><span style="mso-list:Ignore">${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp; </span>`
  + `</span></span><![endif]>${label}<o:p></o:p></p>`;
const wordListHTML = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name=ProgId content=Word.Document>'
  + `${wordStyle}</head><body lang=EN-US><!--StartFragment-->`
  + wordItem('l0', 1, 'font-family:Symbol', '·', 'Disc') + wordItem('l0', 2, 'font-family:"Courier New"', 'o', 'Circle')
  + wordItem('l0', 3, 'font-family:Wingdings', '§', 'Square') + wordItem('l1', 1, 'mso-bidi-font-family:Calibri', '1.', 'Decimal')
  + wordItem('l1', 2, 'mso-bidi-font-family:Calibri', 'a.', 'Alpha') + wordItem('l1', 3, 'mso-bidi-font-family:Calibri', 'i.', 'Roman')
  + '<!--EndFragment--></body></html>';
const wordListJSON = doc(ul('disc', [item(p('Disc'), ul('circle', [item(p('Circle'), ul('square', [item(p('Square'))]))]))]),
  ol('decimal', [item(p('Decimal'), ol('lower-alpha', [item(p('Alpha'), ol('lower-roman', [item(p('Roman'))]))]))]));

// Google Docs lists in the shape Google Docs is expected to write them, authored and not a native capture:
// the marker as list-style-type on each li, a nested list placed directly in its parent list, the guid
// wrapper and the trailing line break. The Google Docs captures confirm or correct this shape.
const googleRun = (label: string): string => '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;'
  + `font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">${label}</span>`;
const googleItem = (marker: string, label: string, level: number): string => `<li dir="ltr" style="list-style-type:${marker};font-size:11pt;`
  + 'font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;'
  + `vertical-align:baseline;white-space:pre;" aria-level="${String(level)}"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" `
  + `role="presentation">${googleRun(label)}</p></li>`;
const googleList = (tag: 'ul' | 'ol', ...content: string[]): string =>
  `<${tag} style="margin-top:0;margin-bottom:0;padding-inline-start:48px;">${content.join('')}</${tag}>`;
const googleSlice = (body: string): string => '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-00000000-7fff-4000-8000-000000000004">'
  + `${body}</b><br class="Apple-interchange-newline">`;
const googleBullets = googleList('ul', googleItem('disc', 'One', 1), googleList('ul', googleItem('circle', 'Two', 2), googleList('ul', googleItem('square', 'Three', 3))));
const googleListHTML = googleSlice(googleBullets
  + googleList('ol', googleItem('decimal', 'Four', 1), googleList('ol', googleItem('lower-alpha', 'Five', 2), googleList('ol', googleItem('lower-roman', 'Six', 3)))));
type ListShape = string | number | null | ListShape[];
/** Lists with their marker, ordered start and item texts; text formatting is not part of this projection. */
function listShape(node: JSONContent): ListShape {
  const content = (node.content ?? []).map(listShape);
  if (node.type === 'paragraph') return (node.content ?? []).map(child => child.text ?? '').join('');
  if (node.type === 'bulletList') return ['bulletList', (node.attrs?.['listStyleType'] as string | null | undefined) ?? null, content];
  if (node.type === 'orderedList') return ['orderedList', (node.attrs?.['listStyleType'] as string | null | undefined) ?? null, node.attrs?.['start'] as number, content];
  return content;
}
const googleShape = (bullets: (string | null)[], ordered: (string | null)[]): ListShape => [
  ['bulletList', bullets[0] ?? null, [['One', ['bulletList', bullets[1] ?? null, [['Two', ['bulletList', bullets[2] ?? null, [['Three']]]]]]]]],
  ['orderedList', ordered[0] ?? null, 1, [['Four', ['orderedList', ordered[1] ?? null, 1, [['Five', ['orderedList', ordered[2] ?? null, 1, [['Six']]]]]]]]],
];
async function pasteResults(page: Page): Promise<NormalizePasteHTMLResult[]> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  test.describe(`${framework}: explicit list markers`, () => {
    for (const formatting of ['preserve', 'adapt'] as const) test(`${formatting} reconstructs Word default bullet and numbering profiles quietly`, async ({ page }) => {
      await open(page, framework, formatting); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      await paste(page, wordListHTML, 'Disc\nCircle\nSquare\nDecimal\nAlpha\nRoman'); await cleanPaste(page);
      await history(page, before, wordListJSON); await reload(page, wordListJSON);
      expect(await computedMarkers(page)).toEqual(['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'lower-roman']);
      await expect(page.locator('.dm-paste-feedback')).toBeHidden();
    });

    for (const [formatting, schema] of [['adapt', undefined], ['preserve', 'capability-full']] as const) {
      test(`${formatting} keeps the markers Google Docs writes on list items on their lists${schema ? ` with ${schema}` : ''}`, async ({ page }) => {
        await open(page, framework, formatting, false, schema); await seed(page, '<p>Replace me</p>');
        await paste(page, googleListHTML, 'One\nTwo\nThree\nFour\nFive\nSix'); await cleanPaste(page);
        expect(listShape((await snapshot(page)).doc)).toEqual(googleShape(['disc', 'circle', 'square'], ['decimal', 'lower-alpha', 'lower-roman']));
        expect(await computedMarkers(page)).toEqual(['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'lower-roman']);
        await expect(page.locator('.dm-paste-feedback')).toBeHidden();
      });
    }

    test('Google Docs list markers stay explicit where only the line spacing is unconfirmed', async ({ page }) => {
      await open(page, framework); await seed(page, '<p>Replace me</p>');
      await paste(page, googleListHTML, 'One\nTwo\nThree\nFour\nFive\nSix');
      const results = await pasteResults(page);
      expect(results).toHaveLength(1); expect(results[0]?.status).toBe('cleaned');
      // The default schema has no LineHeight, so the line spacing Google Docs writes on each paragraph is unconfirmed.
      expect(results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
      expect(listShape((await snapshot(page)).doc)).toEqual(googleShape(['disc', 'circle', 'square'], ['decimal', 'lower-alpha', 'lower-roman']));
      expect(await computedMarkers(page)).toEqual(['disc', 'circle', 'square', 'decimal', 'lower-alpha', 'lower-roman']);
    });

    for (const formatting of ['preserve', 'adapt'] as const) test(`${formatting} reports Google Docs list markers a legacy schema cannot keep once`, async ({ page }) => {
      await open(page, framework, formatting, true); await seed(page, '<p>Replace me</p>');
      await paste(page, googleListHTML, 'One\nTwo\nThree\nFour\nFive\nSix');
      const results = await pasteResults(page);
      expect(results).toHaveLength(1); expect(results[0]?.status).toBe('cleaned');
      expect(results[0]?.diagnostics.filter(entry => entry.severity !== 'info')).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
      expect(listShape((await snapshot(page)).doc)).toEqual(googleShape([null, null, null], [null, null, null]));
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toContainText('Review the pasted content.');
    });

    test('a Google Docs bullet list pasted into a default marker list keeps its own wrapper, as a Word list does', async ({ page }) => {
      const pasteInto = async (html: string, text: string): Promise<ListShape> => {
        await seed(page, listHTML('ul', null, 'HOST', 'END')); await selection(page, 'HOST', 4);
        await paste(page, html, text); await cleanPaste(page);
        return listShape((await snapshot(page)).doc);
      };
      await open(page, framework, 'adapt');
      const google = await pasteInto(googleSlice(googleBullets), 'One\nTwo\nThree');
      const word = await pasteInto(wordStyle + wordItem('l0', 1, 'font-family:Symbol', '·', 'One') + wordItem('l0', 2, 'font-family:"Courier New"', 'o', 'Two')
        + wordItem('l0', 3, 'font-family:Wingdings', '§', 'Three'), 'One\nTwo\nThree');
      expect(google).toEqual(word);
      // Explicit markers differ from the host's null marker, so the pasted list does not merge into the host list.
      expect(google).toEqual([['bulletList', null, [['HOST']]],
        ['bulletList', 'disc', [['One', ['bulletList', 'circle', [['Two', ['bulletList', 'square', [['Three']]]]]]]]],
        ['bulletList', null, [['END']]]]);
    });

    test('a Word list keeps one unsupported item literal inside its parent item and reconstructs the rest', async ({ page }) => {
      await open(page, framework); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      // The level two definition names Courier New, but this marker run is Arial, so its o is not a proven bullet.
      const html = wordStyle + wordItem('l0', 1, 'font-family:Symbol', '·', 'Disc')
        + wordItem('l0', 2, 'font-family:Arial', 'o', 'Literal') + wordItem('l0', 1, 'font-family:Symbol', '·', 'After');
      await paste(page, html, 'Disc\nLiteral\nAfter');
      const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
      expect(results).toHaveLength(1);
      expect(results[0]?.diagnostics.filter(entry => entry.code === 'office-list-unsupported')).toHaveLength(1);
      // The literal paragraph keeps its visible marker run, including that run's own formatting, as its own text node.
      const pasted = canonical((await snapshot(page)).doc);
      expect(pasted.content?.map(node => [node.type, node.attrs?.['listStyleType']])).toEqual([['bulletList', 'disc']]);
      expect(pasted.content?.[0]?.content?.map(entry => [entry.type, ...(entry.content ?? []).map(block =>
        `${block.type}:${(block.content ?? []).map(part => part.text ?? '').join('')}`)])).toEqual([
        ['listItem', 'paragraph:Disc', expect.stringMatching(/^paragraph:o\s+Literal$/u)], ['listItem', 'paragraph:After'],
      ]);
      expect(await computedMarkers(page)).toEqual(['disc']);
      await expect(page.locator('.dm-paste-feedback')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+z'); await expect.poll(() => snapshot(page)).toEqual(before);
    });

    for (const formatting of ['preserve', 'adapt'] as const) test(`${formatting} keeps reconstructed Office decimals and bullet classes at depth`, async ({ page }) => {
      await open(page, framework, formatting); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      await paste(page, officeHTML); await cleanPaste(page); await history(page, before, officeJSON); await reload(page, officeJSON);
      expect(await computedMarkers(page)).toEqual(['decimal', 'decimal', 'disc', 'circle', 'square', 'disc']);
    });

    test('a legacy marker schema retains visible Office labels instead of reconstructing lossy lists', async ({ page }) => {
      await open(page, framework, 'adapt', true); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      await paste(page, officeHTML);
      const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
      expect(results).toHaveLength(1); expect(results[0]?.status).toBe('cleaned');
      expect(results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'office-list-unsupported' }));
      await history(page, before, doc(p('3. Parent'), p('4. Nested'), p('• Disc'), p('◦ Circle'), p('▪ Square'), p('● Filled'), p('· Dot')));
      expect(await computedMarkers(page)).toEqual([]);
    });

    for (const formatting of ['preserve', 'adapt'] as const) test(`${formatting} keeps all marker enums, HTML type and CSS precedence`, async ({ page }) => {
      await open(page, framework, formatting); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      await paste(page, mixedHTML); await cleanPaste(page); await history(page, before, mixedJSON); await reload(page, mixedJSON);
      const markers = await computedMarkers(page);
      expect(markers).toEqual(['upper-roman', 'decimal', await styleQueries(page) ? 'lower-roman' : 'decimal',
        'lower-alpha', 'upper-alpha', 'lower-roman', 'decimal', 'circle', 'square', 'disc']);
    });

    test('null cycles with actual theme support while explicit decimal remains fixed', async ({ page }) => {
      await open(page, framework);
      const nested = (marker: string | null): string => `<ol${marker ? ` style="list-style-type:${marker}"` : ''}><li><p>A</p>`
        + `<ol${marker ? ` style="list-style-type:${marker}"` : ''}><li><p>B</p><ol><li><p>C</p></li></ol></li></ol></li></ol>`;
      await seed(page, nested(null) + nested('decimal'));
      const expected = doc(ol(null, [item(p('A'), ol(null, [item(p('B'), ol(null, [item(p('C'))]))]))]),
        ol('decimal', [item(p('A'), ol('decimal', [item(p('B'), ol(null, [item(p('C'))]))]))]));
      expect(canonical((await snapshot(page)).doc)).toEqual(expected);
      expect(await computedMarkers(page)).toEqual(await styleQueries(page)
        ? ['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'decimal', 'lower-roman']
        : ['decimal', 'decimal', 'decimal', 'decimal', 'decimal', 'decimal']);
      await reload(page, expected);
    });

    test('partial internal copy preserves marker context through an ordered range replacement', async ({ page }) => {
      await open(page, framework, 'adapt'); await seed(page, listHTML('ol', 'upper-roman', 'SOURCEA'));
      await selection(page, 'SOURCEA', 0, 'SOURCEA', 7);
      const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.serializeSelection());
      expect(copied.html).toContain('data-pm-slice');
      expect(copied.html).toContain('listStyleType'); expect(copied.html).toContain('upper-roman');
      await seed(page, listHTML('ol', 'decimal', 'HOST', 'TARGET', 'END')); await selection(page, 'TARGET', 0, 'TARGET', 6);
      const before = await snapshot(page); await paste(page, copied.html, copied.text); await cleanPaste(page);
      const expected = doc(ol('decimal', [item(p('HOST'))]), ol('upper-roman', [item(p('SOURCEA'))]), ol('decimal', [item(p('END'))]));
      await caret(page, 20); // End of SOURCEA in the independently authored output.
      await history(page, before, expected); await reload(page, expected);
    });

    test('partial external ProseMirror copy keeps its marker context through an ordered range replacement', async ({ page }) => {
      await open(page, framework, 'adapt'); await seed(page, listHTML('ol', 'upper-roman', 'SOURCEA'));
      await selection(page, 'SOURCEA', 0, 'SOURCEA', 7);
      const copied = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.serializeSelection());
      // The same ProseMirror markup without the same-page copy marker, as another editor such as Tiptap writes it.
      const external = copied.html.replace(/ data-domternal-copy="v1\.[A-Za-z0-9_-]{22}"/, '');
      expect(external).not.toBe(copied.html);
      expect(external).toContain('data-pm-slice'); expect(external).toContain('upper-roman');
      await seed(page, listHTML('ol', 'decimal', 'HOST', 'TARGET', 'END')); await selection(page, 'TARGET', 0, 'TARGET', 6);
      const before = await snapshot(page); await paste(page, external, copied.text); await cleanPaste(page);
      const expected = doc(ol('decimal', [item(p('HOST'))]), ol('upper-roman', [item(p('SOURCEA'))]), ol('decimal', [item(p('END'))]));
      await caret(page, 20); // End of SOURCEA in the independently authored output.
      await history(page, before, expected); await reload(page, expected);
    });

    test('SmartPaste preserves square bullets while replacing a disc list range', async ({ page }) => {
      await open(page, framework); await seed(page, listHTML('ul', 'disc', 'HOST', 'TARGET', 'END'));
      await selection(page, 'TARGET', 0, 'TARGET', 6); const before = await snapshot(page);
      await paste(page, listHTML('ul', 'square', 'X', 'Y')); await cleanPaste(page);
      const expected = doc(ul('disc', [item(p('HOST'))]), ul('square', [item(p('X')), item(p('Y'))]), ul('disc', [item(p('END'))]));
      await caret(page, 19); // End of Y, before the retained END wrapper.
      await history(page, before, expected); await reload(page, expected);
    });

    test('Tab creates a fresh nested wrapper with the original explicit marker', async ({ page }) => {
      await open(page, framework); await seed(page, listHTML('ol', 'upper-roman', 'A', 'B'));
      await selection(page, 'B', 0); const before = await snapshot(page); await page.keyboard.press('Tab');
      const expected = doc(ol('upper-roman', [item(p('A'), ol('upper-roman', [item(p('B'))]))]));
      await caret(page, 8); // Start of nested B.
      await history(page, before, expected); await reload(page, expected);
    });

    test('Tab retains a conflicting existing nested list and creates its own marker wrapper', async ({ page }) => {
      await open(page, framework);
      await seed(page, '<ol style="list-style-type:decimal"><li><p>A</p>' + listHTML('ol', 'upper-roman', 'B') + '</li><li><p>C</p></li></ol>');
      await selection(page, 'C', 0); const before = await snapshot(page); await page.keyboard.press('Tab');
      const expected = doc(ol('decimal', [item(p('A'), ol('upper-roman', [item(p('B'))]), ol('decimal', [item(p('C'))]))]));
      await caret(page, 15); // Start of C in the second nested wrapper.
      await history(page, before, expected); await reload(page, expected);
    });

    test('Shift-Tab preserves a conflicting explicit marker and the outer remainder ordinal', async ({ page }) => {
      await open(page, framework);
      await seed(page, '<ol style="list-style-type:decimal"><li><p>A</p>' + listHTML('ol', 'upper-roman', 'B') + '</li><li><p>C</p></li></ol>');
      await selection(page, 'B', 0); const before = await snapshot(page); await page.keyboard.press('Shift+Tab');
      const expected = doc(ol('decimal', [item(p('A'))]), ol('upper-roman', [item(p('B'))]), ol('decimal', [item(p('C'))], 2));
      await caret(page, 10); // Start of B in its separate top-level wrapper.
      await history(page, before, expected); await reload(page, expected);
    });

    for (const activeBold of [true, false]) test(`Shift-Tab preserves explicitly ${activeBold ? 'enabled' : 'disabled'} bold for subsequent typing`, async ({ page }) => {
      await open(page, framework);
      await seed(page, listHTML('ol', 'upper-roman', 'A', activeBold ? 'B' : '<strong>B</strong>', 'C'));
      await selection(page, 'B', 1); await page.keyboard.press('ControlOrMeta+b');
      const storedMarks = (): Promise<string[] | null> => page.evaluate(() =>
        (window as unknown as ProbeWindow).__pasteCleanup.editor.state.storedMarks?.map(mark => mark.type.name) ?? null);
      expect(await storedMarks()).toEqual(activeBold ? ['bold'] : []);
      await page.keyboard.press('Shift+Tab');
      expect(await storedMarks()).toEqual(activeBold ? ['bold'] : []);
      const lifted = doc(ol('upper-roman', [item(p('A'))]), p('B', !activeBold), ol('upper-roman', [item(p('C'))], 3));
      expect(canonical((await snapshot(page)).doc)).toEqual(lifted);
      await caret(page, 9); // End of the lifted paragraph B.
      await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.closeHistory(); });
      const beforeTyping = await snapshot(page); await page.keyboard.insertText('X');
      const typed = doc(ol('upper-roman', [item(p('A'))]),
        { type: 'paragraph', attrs: { textAlign: 'left' }, content: [text('B', !activeBold), text('X', activeBold)] },
        ol('upper-roman', [item(p('C'))], 3));
      await caret(page, 10);
      await history(page, beforeTyping, typed); await reload(page, typed);
    });

    test('Backspace removes an empty separator without merging conflicting markers', async ({ page }) => {
      await open(page, framework); await seed(page, listHTML('ol', 'decimal', 'A') + '<p></p>' + listHTML('ol', 'upper-roman', 'B'));
      await selection(page, '', 0); const before = await snapshot(page); await page.keyboard.press('Backspace');
      const expected = doc(ol('decimal', [item(p('A'))]), ol('upper-roman', [item(p('B'))]));
      await history(page, before, expected); await reload(page, expected);
    });

    test('Delete removes a separator then refuses a direct conflicting-wrapper merge without history', async ({ page }) => {
      await open(page, framework); await seed(page, listHTML('ol', 'decimal', 'A') + '<p></p>' + listHTML('ol', 'upper-roman', 'B'));
      await selection(page, 'A', 1); const before = await snapshot(page); await page.keyboard.press('Delete');
      const expected = doc(ol('decimal', [item(p('A'))]), ol('upper-roman', [item(p('B'))]));
      await history(page, before, expected);
      await selection(page, 'A', 1); const boundary = await snapshot(page);
      const depth = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history());
      await page.keyboard.press('Delete');
      expect(await snapshot(page)).toEqual(boundary);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual(depth);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.transactions)).toEqual([]);
      await reload(page, expected);
    });

    test('a schema without marker attributes warns but still performs the paste', async ({ page }) => {
      await open(page, framework, 'preserve', true); await seed(page, '<p>Replace me</p>'); const before = await snapshot(page);
      await paste(page, listHTML('ol', 'upper-roman', 'A') + listHTML('ul', 'square', 'B'));
      const results = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.results);
      expect(results).toHaveLength(1); expect(results[0]?.status).not.toBe('rejected');
      expect(results[0]?.diagnostics).toEqual([{ code: 'destination-formatting-unconfirmed', severity: 'warning' }]);
      await expect(page.getByRole('region', { name: 'Paste notice', exact: true })).toContainText('Review the pasted content.');
      const expected = doc({ type: 'orderedList', attrs: { start: 1 }, content: [item(p('A'))] }, { type: 'bulletList', content: [item(p('B'))] });
      await history(page, before, expected);
    });

    test('task checked state and absent marker policy remain independent', async ({ page }) => {
      await open(page, framework);
      await seed(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>DONE</p></li>'
        + '<li data-type="taskItem" data-checked="false"><p>TODO</p></li></ul>');
      await selection(page, 'TODO', 0); const before = await snapshot(page); await page.keyboard.press('Tab');
      const expected = doc({ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('DONE'),
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('TODO')] }] }] }] });
      await history(page, before, expected);
      expect(await computedMarkers(page)).toEqual(['none', 'none']);
      const value = await page.evaluate(() => JSON.stringify((window as unknown as ProbeWindow).__pasteCleanup.editor.getJSON()));
      expect(value).not.toContain('listStyleType');
    });
  });
}
