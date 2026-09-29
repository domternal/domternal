/**
 * Text on backgrounds the document keeps: highlights with their own color, shaded table cells,
 * color tokens and what sits on them (links, code, quotes, muted headings, mentions, task items,
 * details, block colors), measured as WCAG 2 contrast in the theme's light and dark palettes, in
 * auto mode, across a runtime switch and on paper. Text without a color of its own must reach 4.5:1
 * against what it lands on, theme-colored roles (mentions included) 3:1, separators (rules, quote
 * bars, details borders) 3:1; authored colors stay as authored. The editor marks each kept background
 * with its tone in the view only (data-dm-tone), so getHTML carries none. A value the browser does not
 * paint gets no tone; one it paints but the editor cannot read (a variable, oklch(), a system color)
 * is marked unknown and its text is computed by CSS from the painted color.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { installContrastTools, type ContrastTools } from './contrast-tools.js';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';

type Kind = 'automatic' | 'role' | 'authored' | 'inherited';
interface Probe { label: string; group: string; kind: Kind; color?: string }
interface Measured extends Probe { ratio: number; text: string; background: string; underline: boolean }
interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor }; __contrastTools: ContrastTools }

const probes: Probe[] = [];
const probe = (label: string, group: string, kind: Kind, color?: string): string => {
  probes.push({ label, group, kind, ...(color ? { color } : {}) });
  return label;
};

const text = (value: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) });
const style = (attrs: Record<string, string>): NonNullable<JSONContent['marks']>[number] => ({ type: 'textStyle', attrs });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const cell = (background: string, ...content: JSONContent[]): JSONContent => ({ type: 'tableCell', attrs: { background }, content });
const table = (...cells: JSONContent[]): JSONContent => ({ type: 'table', content: [{ type: 'tableRow', content: cells }] });
const spaced = (runs: JSONContent[]): JSONContent[] => runs.flatMap((run, index) => (index === 0 ? [run] : [text(' '), run]));
const mention = (label: string, marks: JSONContent['marks'] = []): JSONContent => ({ type: 'mention', attrs: { id: `u-${label}`, label, type: 'user' }, ...(marks.length ? { marks } : {}) });

const HIGHLIGHT_PALETTE = ['#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8', '#fef9c3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3',
  '#a7f3d0', '#99f6e4', '#a5f3fc', '#bfdbfe', '#c4b5fd', '#d1fae5', '#ccfbf1', '#cffafe', '#dbeafe', '#ede9fe',
  '#e5e7eb', '#d1d5db', '#f3f4f6', '#fafafa', '#ffffff'];
// The sixteen highlight colors Word offers, as a Word paste keeps them.
const WORD_HIGHLIGHTS = ['yellow', 'lime', 'cyan', 'magenta', 'blue', 'red', 'navy', 'teal', 'green', 'purple', 'maroon', 'olive', 'gray', 'silver', 'black', 'white'];
const CELL_PALETTE = ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#a7f3d0', '#a5f3fc', '#bfdbfe', '#c4b5fd', '#fef9c3', '#ffedd5', '#dbeafe', '#ede9fe', '#e5e7eb', '#d1d5db', '#f3f4f6', '#ffffff'];
const WORD_SHADING = ['#D9D9D9', '#002060', '#1F3864', '#C00000', '#000000', '#404040', '#595959', '#7F7F7F', '#8EAADB', '#FFF2CC', '#4472C4', '#70AD47'];
const MID_CELLS = ['#808080', '#4472C4', '#70AD47'];
const LINK = { type: 'link', attrs: { href: 'https://example.com/' } };
// Mentions on mid tones, on Word's light accent tints, and just outside the mid bounds, where roles keep their palette.
const MENTION_CELLS = ['#808080', '#7F7F7F', '#8EAADB', '#B4C6E7', 'teal', '#C00000', '#4472C4', '#70AD47', '#4e4e4e', '#4a4a4a', '#cecece', '#d0d0d0', '#C5E0B3'];
// Stored values the browser does not paint: legacy syntax mixing numbers and percentages, unitless legacy hsl()
// lightness, a number ending in a dot, and white space CSS does not have. They get no tone, so their text stays the
// theme's on the surface around them.
const UNPAINTED = ['hsl(60, 100, 50)', 'rgb(100%, 255, 0)', 'rgb(255., 255., 0)', 'navy\u00a0', '\u3000#000080', 'rgb(0, 0, 50%)'];
const UNPAINTED_CELLS = ['rgb(0, 0, 50%)', '#002060\u00a0', 'hsl(240, 100, 20)', 'rgb(0 0 128 / 1.)'];
// Values the browser paints but the editor cannot read itself: CSS computes black or white from the painted color.
const UNREAD = ['oklch(0.97 0.21 110)', 'var(--dm-probe-unset, #fef08a)', 'hwb(60 0% 0%)', 'color-mix(in srgb, yellow 60%, white)', 'oklch(0.25 0.1 265)', 'Mark', 'light-dark(#fef08a, #002060)', 'rgb(none 0 128)'];

const CONTENT: JSONContent = {
  type: 'doc',
  content: [
    paragraph(...spaced(HIGHLIGHT_PALETTE.map((color, index) => text(probe(`hp${String(index)}`, 'highlight palette', 'automatic'), [style({ backgroundColor: color })])))),
    paragraph(...spaced(WORD_HIGHLIGHTS.map((color, index) => text(probe(`wh${String(index)}`, 'Word highlights', 'automatic'), [style({ backgroundColor: color })])))),
    table(...CELL_PALETTE.map((color, index) => cell(color, paragraph(text(probe(`cp${String(index)}`, 'cell palette', 'automatic')))))),
    table(...WORD_SHADING.map((color, index) => cell(color, paragraph(text(probe(`ws${String(index)}`, 'Word shading', 'automatic')))))),
    // Nested islands: a light highlight in a dark cell, a dark highlight in a light one.
    table(
      cell('#002060', paragraph(text(probe('ndaround', 'nested', 'automatic')), text(' '), text(probe('ndlight', 'nested', 'automatic'), [style({ backgroundColor: '#fef08a' })]))),
      cell('#D9D9D9', paragraph(text(probe('nlaround', 'nested', 'automatic')), text(' '), text(probe('nldark', 'nested', 'automatic'), [style({ backgroundColor: '#000080' })]))),
    ),
    paragraph(
      // Authored colors stay as authored.
      text(probe('augold', 'authored', 'authored', 'rgb(255, 204, 0)'), [style({ backgroundColor: '#002060', color: '#ffcc00' })]), text(' '),
      text(probe('aured', 'authored', 'authored', 'rgb(224, 49, 49)'), [style({ backgroundColor: '#fef08a', color: '#e03131' })]), text(' '),
      // A token color on the run resolves in the palette of its light highlight, in either theme.
      text(probe('tkred', 'token on a highlight', 'authored', 'rgb(196, 85, 77)'), [style({ backgroundColor: '#fef08a', colorToken: 'red' })]), text(' '),
      // Links on a highlight keep a link color readable there; on a mid tone they take black or white.
      text(probe('lkyellow', 'links', 'role'), [LINK, style({ backgroundColor: '#fef08a' })]), text(' '),
      text(probe('lknavy', 'links', 'role'), [LINK, style({ backgroundColor: '#000080' })]), text(' '),
      text(probe('lkteal', 'links', 'role'), [LINK, style({ backgroundColor: 'teal' })]), text(' '),
      // Inline code on a highlight draws in the text color around it.
      text(probe('icnavy', 'code', 'automatic'), [{ type: 'code' }, style({ backgroundColor: '#000080' })]), text(' '),
      text(probe('icyellow', 'code', 'automatic'), [{ type: 'code' }, style({ backgroundColor: '#fef08a' })]), text(' '),
      // A token background is theme aware already and gets no tone.
      text(probe('ntyellow', 'token backgrounds', 'automatic'), [style({ backgroundColorToken: 'yellow' })]),
    ),
    // A block's own token color is inherited unchanged by a highlight inside it.
    { type: 'paragraph', attrs: { textColor: 'blue' }, content: [text(probe('btblue', 'block color', 'inherited'), [style({ backgroundColor: '#fef08a' })])] },
    table(...MID_CELLS.map((color, index) => cell(color,
      paragraph(text(probe(`ma${String(index)}`, 'mid-tone cells', 'automatic')), text(' '), text(probe(`ml${String(index)}`, 'mid-tone cells', 'role'), [LINK])),
      { type: 'heading', attrs: { level: 6 }, content: [text(probe(`mh${String(index)}`, 'mid-tone cells', 'role'))] },
      { type: 'blockquote', content: [paragraph(text(probe(`mq${String(index)}`, 'mid-tone cells', 'role')))] },
    ))),
    table(
      cell('#002060',
        { type: 'codeBlock', content: [text(probe('cbdark', 'content in cells', 'automatic'))] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph(text(probe('tidark', 'content in cells', 'automatic')))] }] },
        { type: 'paragraph', attrs: { bgColor: 'yellow' }, content: [text(probe('bcdark', 'content in cells', 'automatic'))] },
        paragraph(text('mention '), { type: 'mention', attrs: { id: 'u1', label: probe('mndark', 'content in cells', 'role'), type: 'user' } }),
        { type: 'details', attrs: { open: true }, content: [
          { type: 'detailsSummary', content: [text(probe('dtsum', 'content in cells', 'automatic'))] },
          { type: 'detailsContent', content: [paragraph(text(probe('dtbody', 'content in cells', 'automatic')))] },
        ] },
      ),
      cell('#D9D9D9',
        { type: 'paragraph', attrs: { bgColor: 'yellow' }, content: [text(probe('bclight', 'content in cells', 'automatic'))] },
        { type: 'heading', attrs: { level: 6 }, content: [text(probe('hlight', 'content in cells', 'role'))] },
      ),
    ),
    table(...MENTION_CELLS.map((color, index) => cell(color, paragraph(mention(probe(`mnc${String(index)}`, 'mentions', 'role')))))),
    paragraph(...spaced(['teal', '#808080', '#fef08a', '#000080', '#8EAADB'].map((color, index) =>
      mention(probe(`mnh${String(index)}`, 'mentions', 'role'), [style({ backgroundColor: color })])))),
    paragraph(...spaced(UNPAINTED.map((color, index) => text(probe(`upt${String(index)}`, 'unpainted', 'automatic'), [style({ backgroundColor: color })])))),
    table(...UNPAINTED_CELLS.map((color, index) => cell(color, paragraph(text(probe(`upc${String(index)}`, 'unpainted', 'automatic')))))),
    paragraph(...spaced(UNREAD.map((color, index) => text(probe(`rdt${String(index)}`, 'unread', 'automatic'), [style({ backgroundColor: color })])))),
    // Inside a toned cell an unread background draws its own text instead of inheriting the cell's black or white.
    table(
      cell('#002060', paragraph(...spaced(UNREAD.map((color, index) => text(probe(`rdd${String(index)}`, 'unread in cells', 'automatic'), [style({ backgroundColor: color })]))))),
      cell('#D9D9D9', paragraph(...spaced(UNREAD.map((color, index) => text(probe(`rdl${String(index)}`, 'unread in cells', 'automatic'), [style({ backgroundColor: color })]))))),
      cell('var(--dm-probe-unset, #fef08a)', paragraph(text(probe('rdcell', 'unread in cells', 'automatic')), text(' '),
        text(probe('rdcellnavy', 'unread in cells', 'automatic'), [style({ backgroundColor: '#000080' })]))),
    ),
    // Surfaces inside an unread cell (a details box, a nested header cell) sit on its lift, not on the theme's surface.
    table(...['oklch(0.25 0.1 265)', 'var(--dm-probe-unset, #fef08a)'].map((color, index) => cell(color,
      { type: 'details', attrs: { open: true }, content: [
        { type: 'detailsSummary', content: [text(probe(`rdsum${String(index)}`, 'unread surfaces', 'automatic'))] },
        { type: 'detailsContent', content: [paragraph(text(probe(`rdbody${String(index)}`, 'unread surfaces', 'automatic')))] },
      ] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph(text(probe(`rdth${String(index)}`, 'unread surfaces', 'automatic')))] }] }] },
    ))),
    // Roles on an unread background take its black or white, as on a mid tone.
    paragraph(
      text(probe('rdlink', 'unread roles', 'role'), [LINK, style({ backgroundColor: 'oklch(0.3 0.1 265)' })]), text(' '),
      text(probe('rdcode', 'unread roles', 'automatic'), [{ type: 'code' }, style({ backgroundColor: 'var(--dm-probe-unset, #002060)' })]), text(' '),
      mention(probe('rdmention', 'unread roles', 'role'), [style({ backgroundColor: 'oklch(0.6 0.12 200)' })]),
    ),
  ],
};

async function open(page: Page, mode: 'light' | 'dark' | 'auto'): Promise<void> {
  const query = new URLSearchParams({ framework: 'vanilla', theme: '1', contrast: '1', schema: 'capability-full', details: '1', mention: '1', ...(mode === 'light' ? {} : { 'theme-mode': mode }) });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await page.evaluate((json) => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    if (!editor.setContent(JSON.parse(json) as JSONContent, false)) throw new Error('The contrast document did not load');
    editor.view.dom.blur();
  }, JSON.stringify(CONTENT));
  await expect(page.locator('.ProseMirror [data-dm-tone]').first()).toBeAttached();
  await page.evaluate(installContrastTools);
}

/** Every probe's text and background color, composited down to the page, and their WCAG 2 contrast. */
function measure(page: Page): Promise<Measured[]> {
  return page.evaluate((list) => {
    const tools = (window as unknown as ProbeWindow).__contrastTools;
    const root = document.querySelector('.ProseMirror');
    if (!root) throw new Error('No editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const owners = new Map<string, Element>();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const probe of list) {
        if (!owners.has(probe.label) && node.textContent?.includes(probe.label) && node.parentElement) owners.set(probe.label, node.parentElement);
      }
    }
    return list.map((probe) => {
      const element = owners.get(probe.label);
      if (!element) throw new Error(`Probe ${probe.label} is not in the editor`);
      const reading = tools.text(element);
      const underline = [...(function* ancestors(from: Element | null) { for (let at = from; at; at = at.parentElement) yield at; })(element)]
        .some((at) => getComputedStyle(at).textDecorationLine.includes('underline'));
      return { ...probe, ratio: reading.ratio, text: tools.css(reading.text), background: tools.css(reading.background), underline };
    });
  }, probes);
}

/** The rules every reading must keep, as failures that name the probe and its colors. */
function failures(measured: Measured[], blockColor?: string): string[] {
  const found: string[] = [];
  for (const row of measured) {
    const where = `${row.group} ${row.label}: ${row.text} on ${row.background} is ${row.ratio.toFixed(2)}:1`;
    if (row.kind === 'automatic' && row.ratio < 4.5) found.push(where);
    if (row.kind === 'role' && row.ratio < 3) found.push(where);
    if (row.kind === 'authored' && row.text !== row.color) found.push(`${where}, authored ${String(row.color)}`);
    if (row.kind === 'inherited' && blockColor !== undefined && row.text !== blockColor) found.push(`${where}, block color ${blockColor}`);
  }
  return found;
}

/** The lowest ratio per group, attached to the report. */
function summary(measured: Measured[]): Record<string, { min: number; under45: number }> {
  const groups: Record<string, { min: number; under45: number }> = {};
  for (const row of measured) {
    const group = (groups[row.group] ??= { min: Infinity, under45: 0 });
    group.min = Math.min(group.min, Math.round(row.ratio * 100) / 100);
    if (row.ratio < 4.5) group.under45++;
  }
  return groups;
}

async function attach(page: Page, testInfo: TestInfo, name: string, measured: Measured[]): Promise<void> {
  await testInfo.attach(`${name}.json`, { body: JSON.stringify({ summary: summary(measured), measured }, null, 2), contentType: 'application/json' });
  await testInfo.attach(`${name}.png`, { body: await page.locator('.dm-editor').screenshot(), contentType: 'image/png' });
}

const blockBlue = { light: 'rgb(72, 124, 165)', dark: 'rgb(122, 155, 214)' };
const byLabel = (measured: Measured[], label: string): Measured => {
  const row = measured.find((entry) => entry.label === label);
  if (!row) throw new Error(`No probe ${label}`);
  return row;
};

// Separators on kept backgrounds: a rule, a quote bar and a details border reach 3:1 against the background,
// and an inline code chip stands out from it, by its outline or its fill, at least as clearly as on the editor's
// own background.
const EDGE_CELLS = ['#002060', '#D9D9D9', '#808080', '#C00000', '#fef08a', '#0000ff', '#ffffff', '#4e4e4e', '#cecece', 'oklch(0.25 0.1 265)', 'var(--dm-probe-unset, #fef08a)'];
const EDGES: JSONContent = {
  type: 'doc',
  content: [
    paragraph(text('canvas '), text('chip', [{ type: 'code' }])),
    { type: 'table', content: EDGE_CELLS.map((color, index) => ({ type: 'tableRow', content: [cell(color,
      paragraph(text(`edge${String(index)} `), text(`code${String(index)}`, [{ type: 'code' }])),
      { type: 'horizontalRule' },
      { type: 'blockquote', content: [paragraph(text(`quote${String(index)}`))] },
      { type: 'details', attrs: { open: true }, content: [
        { type: 'detailsSummary', content: [text(`summary${String(index)}`)] },
        { type: 'detailsContent', content: [paragraph(text(`body${String(index)}`))] },
      ] },
    )] })) },
  ],
};

interface Edges { cell: string; rule: number; quote: number; details: number; code: number }

async function openEdges(page: Page, mode: 'light' | 'dark'): Promise<{ canvasCode: number; cells: Edges[] }> {
  await open(page, mode);
  await page.evaluate((json) => { (window as unknown as ProbeWindow).__pasteCleanup.editor.setContent(JSON.parse(json) as JSONContent, false); }, JSON.stringify(EDGES));
  return page.evaluate(() => {
    const tools = (window as unknown as ProbeWindow).__contrastTools;
    const one = (root: ParentNode, selector: string): Element => {
      const found = root.querySelector(selector);
      if (!found) throw new Error(`No ${selector}`);
      return found;
    };
    // A chip shows by its outline or by its fill, whichever stands out more from the surface around it.
    const chip = (code: Element): number => Math.max(tools.edge(code, 'top').ratio,
      tools.ratio(tools.background(code), tools.background(code.parentElement)));
    const canvasCode = chip(one(document, '.ProseMirror > p code'));
    const cells = [...document.querySelectorAll('.ProseMirror td')].map((cell) => ({
      cell: cell.getAttribute('data-background') ?? '',
      rule: tools.edge(one(cell, 'hr'), 'top').ratio,
      quote: tools.edge(one(cell, 'blockquote'), 'left').ratio,
      details: tools.edge(one(cell, 'div[data-type="details"]'), 'top').ratio,
      code: chip(one(cell, 'code')),
    }));
    return { canvasCode, cells };
  });
}

test.describe('text on kept backgrounds', () => {
  for (const mode of ['light', 'dark'] as const) {
    test(`reads at 4.5:1 for automatic text and 3:1 for roles in the ${mode} theme`, async ({ page }, testInfo) => {
      await open(page, mode);
      const measured = await measure(page);
      await attach(page, testInfo, `contrast-${mode}`, measured);
      expect(failures(measured, blockBlue[mode])).toEqual([]);
      // A mid tone turns links black or white, and they keep their underline.
      const teal = byLabel(measured, 'lkteal');
      expect([teal.text, teal.underline]).toEqual(['rgb(255, 255, 255)', true]);
      // Mentions on a mid tone take its black or white as links do.
      expect(['mnc0', 'mnc4', 'mnc5'].map((label) => byLabel(measured, label).text)).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
      // The tone and the unread surface live in the view only.
      const html = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML());
      expect(html).not.toContain('data-dm-tone');
      expect(html).not.toContain('--dm-tone');
      expect(html).toContain('background-color');
      // A value the browser does not paint has no tone, and one it paints but the editor cannot read is unknown.
      const tones = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror [style*="background-color"]')]
        .map((element): [string, string | null] => [element.textContent.trim().split(' ')[0] ?? '', element.getAttribute('data-dm-tone')]));
      const toneOf = new Map(tones);
      const toneList = (labels: string[]): (string | null)[] => labels.map((label) => toneOf.get(label) ?? null);
      expect(toneList(['upt0', 'upt1', 'upt2', 'upt3', 'upt4', 'upt5', 'upc0', 'upc1', 'upc2', 'upc3'])).toEqual(Array<null>(10).fill(null));
      expect(toneList(['rdt0', 'rdt1', 'rdt2', 'rdt3', 'rdt4', 'rdt5', 'rdt6', 'rdt7', 'rdcell'])).toEqual(Array<string>(9).fill('unknown'));
    });
  }

  test('an unread background inside a toned cell draws its own black or white, not the cell\'s', async ({ page }) => {
    for (const mode of ['light', 'dark'] as const) {
      await open(page, mode);
      const measured = await measure(page);
      const colors = (prefix: string): string[] => [0, 1, 2, 3, 4, 5, 6, 7].map((index) => byLabel(measured, `${prefix}${String(index)}`).text);
      const white = 'rgb(255, 255, 255)';
      const black = 'rgb(0, 0, 0)';
      // Pale yellow, yellow, yellow, pale yellow, navy, Mark, light-dark() in the cell's scheme, navy.
      expect(colors('rdd')).toEqual([black, black, black, black, white, black, white, white]);
      expect(colors('rdl')).toEqual([black, black, black, black, white, black, black, white]);
      expect([byLabel(measured, 'rdcell').text, byLabel(measured, 'rdcellnavy').text]).toEqual([black, white]);
    }
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`separators on kept backgrounds reach 3:1 and code chips stay outlined in the ${mode} theme`, async ({ page }, testInfo) => {
      const { canvasCode, cells } = await openEdges(page, mode);
      await testInfo.attach(`edges-${mode}.json`, { body: JSON.stringify({ canvasCode, cells }, null, 2), contentType: 'application/json' });
      await testInfo.attach(`edges-${mode}.png`, { body: await page.locator('.dm-editor').screenshot(), contentType: 'image/png' });
      const low = cells.flatMap((row) => [
        ...(['rule', 'quote', 'details'] as const).filter((edge) => row[edge] < 3).map((edge) => `${row.cell} ${edge} ${row[edge].toFixed(2)}`),
        ...(row.code < canvasCode ? [`${row.cell} code ${row.code.toFixed(2)} under the canvas chip ${canvasCode.toFixed(2)}`] : []),
      ]);
      expect(low).toEqual([]);
    });
  }

  test('a color attribute on the page around the editor leaves automatic text black or white', async ({ page }) => {
    for (const mode of ['light', 'dark'] as const) {
      await open(page, mode);
      await page.evaluate(() => {
        document.body.setAttribute('data-text-color', 'brand');
        document.querySelector('.dm-editor')?.setAttribute('data-text-color', 'brand');
      });
      const measured = await measure(page);
      expect(failures(measured.filter((row) => row.kind === 'automatic'))).toEqual([]);
      expect([byLabel(measured, 'hp0').text, byLabel(measured, 'ws1').text]).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
    }
  });

  test('auto mode with a dark system scheme reads like the dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, 'auto');
    const auto = await measure(page);
    expect(failures(auto, blockBlue.dark)).toEqual([]);
    await open(page, 'dark');
    const dark = await measure(page);
    expect(auto.map((row) => [row.label, row.text, row.background])).toEqual(dark.map((row) => [row.label, row.text, row.background]));
  });

  test('a runtime switch between light and dark gives the same colors as a fresh render', async ({ page }, testInfo) => {
    await open(page, 'dark');
    const freshDark = await measure(page);
    await open(page, 'light');
    const freshLight = await measure(page);
    const colors = (rows: Measured[]): string[][] => rows.map((row) => [row.label, row.text, row.background]);
    await page.evaluate(() => { document.body.classList.add('dm-theme-dark'); });
    const switched = await measure(page);
    await attach(page, testInfo, 'contrast-switched-to-dark', switched);
    expect(colors(switched)).toEqual(colors(freshDark));
    await page.evaluate(() => { document.body.classList.remove('dm-theme-dark'); });
    expect(colors(await measure(page))).toEqual(colors(freshLight));
  });

  test('a light island inside a dark page keeps the light palette with readable kept backgrounds', async ({ page }) => {
    await open(page, 'dark');
    await page.evaluate(() => { document.querySelector('.dm-editor')?.classList.add('dm-theme-light'); });
    const measured = await measure(page);
    expect(failures(measured)).toEqual([]);
  });

  test('a dark editor prints its kept backgrounds with readable text', async ({ page }, testInfo) => {
    await open(page, 'dark');
    await page.emulateMedia({ media: 'print' });
    const measured = await measure(page);
    await attach(page, testInfo, 'contrast-print-from-dark', measured);
    expect(failures(measured, blockBlue.light)).toEqual([]);
    const adjust = await page.evaluate(() => [...document.querySelectorAll('.ProseMirror [data-dm-tone]')].map((element) => {
      const style = getComputedStyle(element);
      return style.printColorAdjust || style.getPropertyValue('-webkit-print-color-adjust');
    }));
    expect(adjust.length).toBeGreaterThan(40);
    expect([...new Set(adjust)]).toEqual(['exact']);
  });

  test('nested islands take the palette of their own background', async ({ page }) => {
    for (const mode of ['light', 'dark'] as const) {
      await open(page, mode);
      const measured = await measure(page);
      expect([byLabel(measured, 'ndaround').text, byLabel(measured, 'ndlight').text, byLabel(measured, 'nlaround').text, byLabel(measured, 'nldark').text])
        .toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
      const scheme = await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror td[data-dm-tone="dark"] input[type="checkbox"]') ?? document.body).colorScheme);
      expect(scheme).toBe('dark');
    }
  });
});
