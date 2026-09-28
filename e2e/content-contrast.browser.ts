/**
 * Text on backgrounds the document keeps: highlights with their own color, shaded table cells,
 * color tokens and what sits on them (links, code, quotes, muted headings, mentions, task items,
 * details, block colors), measured as WCAG 2 contrast in the theme's light and dark palettes, in
 * auto mode, across a runtime switch and on paper. Text without a color of its own must reach 4.5:1
 * against what it lands on, theme-colored roles 3:1; authored colors stay as authored. The editor
 * marks each kept background with its tone in the view only (data-dm-tone), so getHTML carries none.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';

type Kind = 'automatic' | 'role' | 'authored' | 'inherited';
interface Probe { label: string; group: string; kind: Kind; color?: string }
interface Measured extends Probe { ratio: number; text: string; background: string; underline: boolean }
interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor } }

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

const HIGHLIGHT_PALETTE = ['#fef08a', '#fde68a', '#fed7aa', '#fecaca', '#fbcfe8', '#fef9c3', '#fef3c7', '#ffedd5', '#fee2e2', '#fce7f3',
  '#a7f3d0', '#99f6e4', '#a5f3fc', '#bfdbfe', '#c4b5fd', '#d1fae5', '#ccfbf1', '#cffafe', '#dbeafe', '#ede9fe',
  '#e5e7eb', '#d1d5db', '#f3f4f6', '#fafafa', '#ffffff'];
// The sixteen highlight colors Word offers, as a Word paste keeps them.
const WORD_HIGHLIGHTS = ['yellow', 'lime', 'cyan', 'magenta', 'blue', 'red', 'navy', 'teal', 'green', 'purple', 'maroon', 'olive', 'gray', 'silver', 'black', 'white'];
const CELL_PALETTE = ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#a7f3d0', '#a5f3fc', '#bfdbfe', '#c4b5fd', '#fef9c3', '#ffedd5', '#dbeafe', '#ede9fe', '#e5e7eb', '#d1d5db', '#f3f4f6', '#ffffff'];
const WORD_SHADING = ['#D9D9D9', '#002060', '#1F3864', '#C00000', '#000000', '#404040', '#595959', '#7F7F7F', '#8EAADB', '#FFF2CC', '#4472C4', '#70AD47'];
const MID_CELLS = ['#808080', '#4472C4', '#70AD47'];
const LINK = { type: 'link', attrs: { href: 'https://example.com/' } };

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
}

/** Every probe's text and background color, composited down to the page, and their WCAG 2 contrast. */
function measure(page: Page): Promise<Measured[]> {
  return page.evaluate((list) => {
    const parse = (value: string): [number, number, number, number] => {
      const match = /rgba?\(([^)]+)\)/.exec(value);
      if (!match?.[1]) throw new Error(`Unreadable color ${value}`);
      const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const over = (top: number[], base: number[]): number[] => {
      const alpha = top[3] ?? 1;
      return [0, 1, 2].map((index) => (top[index] ?? 0) * alpha + (base[index] ?? 0) * (1 - alpha)).concat(1);
    };
    const luminance = (color: number[]): number => {
      const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(color[0] ?? 0) + 0.7152 * linear(color[1] ?? 0) + 0.0722 * linear(color[2] ?? 0);
    };
    const css = (color: number[]): string => `rgb(${color.slice(0, 3).map((channel) => Math.round(channel)).join(', ')})`;
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
      const layers: number[][] = [];
      for (let current: Element | null = element; current; current = current.parentElement) {
        const background = parse(getComputedStyle(current).backgroundColor);
        if (background[3] > 0) layers.push(background);
        if (background[3] >= 1) break;
      }
      let background = [255, 255, 255, 1];
      for (const layer of layers.reverse()) background = over(layer, background);
      const style = getComputedStyle(element);
      const textColor = over(parse(style.color), background);
      const [a, b] = [luminance(textColor), luminance(background)];
      const underline = [...(function* ancestors(from: Element | null) { for (let at = from; at; at = at.parentElement) yield at; })(element)]
        .some((at) => getComputedStyle(at).textDecorationLine.includes('underline'));
      return { ...probe, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), text: css(textColor), background: css(background), underline };
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
      // The tone lives in the view only.
      const html = await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML());
      expect(html).not.toContain('data-dm-tone');
      expect(html).toContain('background-color');
    });
  }

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
