import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { installContrastTools, type ContrastTools } from './contrast-tools.js';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor }; __contrastTools: ContrastTools }
const text = (value: string, color: string, backgroundColor?: string, link = false): JSONContent => ({
  type: 'text', text: value, marks: [
    ...(link ? [{ type: 'link', attrs: { href: 'https://example.com/' } }] : []),
    { type: 'textStyle', attrs: { color, ...(backgroundColor ? { backgroundColor } : {}) } },
  ],
});
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const CONTENT: JSONContent = { type: 'doc', content: [
  paragraph(text('Dark ink', '#000000'), { type: 'text', text: ' ' }, text('Light ink', '#ffffff')),
  paragraph(text('Readable gold', '#ffcc00', '#002060'), { type: 'text', text: ' ' }, text('Hidden gold', '#ffcc00', '#ffffff')),
  paragraph(text('Authored link', '#000000', undefined, true)),
  { type: 'heading', attrs: { level: 6 }, content: [text('Heading ink', '#000000')] },
  { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph(text('List ink', '#000000'))] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', attrs: { background: '#002060' }, content: [paragraph(
      text('Cell ink', '#000000'), { type: 'text', text: ' ' }, text('Light island', '#ffffff', '#fef08a'),
    )] },
    { type: 'tableCell', attrs: { background: '#ffffff' }, content: [paragraph(
      text('Dark island', '#000000', '#002060'), { type: 'text', text: ' ' }, text('Translucent island', '#ffffff', 'rgba(255, 255, 255, 0.8)'),
    )] },
  ] }] },
  paragraph(text('Transparent ink', 'transparent'), { type: 'text', text: ' ' }, text('Partial ink', 'rgba(0, 0, 0, 0.5)')),
] };
const READABLE = ['Dark ink', 'Light ink', 'Readable gold', 'Hidden gold', 'Authored link', 'Heading ink', 'List ink',
  'Cell ink', 'Light island', 'Dark island', 'Translucent island'];

async function open(page: Page, mode: 'light' | 'dark' | 'auto', automatic = true, order = ''): Promise<void> {
  const query = new URLSearchParams({ framework: 'vanilla', theme: '1', contrast: '1', schema: 'capability-full',
    'theme-mode': mode, ...(automatic ? { 'text-contrast': 'auto' } : {}), 'text-style-order': order });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await page.evaluate(content => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    if (!editor.setContent(content, false)) throw new Error('The readability document was refused');
    editor.view.dom.blur();
  }, CONTENT);
  await page.evaluate(installContrastTools);
}

async function reading(page: Page, label: string): Promise<{ ratio: number; color: string; authored: string; adjusted: string }> {
  return page.evaluate(label => {
    const { __pasteCleanup: { editor }, __contrastTools: tools } = window as unknown as ProbeWindow;
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent !== label || !node.parentElement) continue;
      const element = node.parentElement;
      const span = element.closest<HTMLElement>('span[style]');
      return { ratio: tools.text(element).ratio, color: getComputedStyle(element).color, authored: span?.style.color ?? '',
        adjusted: span?.style.getPropertyValue('--dm-readable-color') ?? '' };
    }
    throw new Error(`Missing readability probe: ${label}`);
  }, label);
}

async function snapshot(page: Page): Promise<{ json: string; html: string }> {
  return page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { json: JSON.stringify(editor.getJSON()), html: editor.getHTML() };
  });
}

for (const mode of ['light', 'dark'] as const) {
  for (const order of ['', 'highlight-first']) {
    test(`literal colors stay readable in ${mode}, ${order || 'text-color-first'}, without changing stored formatting`, async ({ page }) => {
      await open(page, mode, true, order);
      const before = await snapshot(page);
      for (const label of READABLE) await expect.poll(async () => (await reading(page, label)).ratio, { message: label }).toBeGreaterThanOrEqual(4.5);
      expect((await reading(page, 'Readable gold')).color).toBe('rgb(255, 204, 0)');
      expect((await reading(page, 'Dark ink')).authored).toBe('rgb(0, 0, 0)');
      expect((await reading(page, 'Light ink')).authored).toBe('rgb(255, 255, 255)');
      expect((await reading(page, 'Transparent ink')).adjusted).toBe('');
      expect((await reading(page, 'Partial ink')).adjusted).toBe('');
      expect(await snapshot(page)).toEqual(before);
      expect(before.html).not.toContain('dm-readable');
      expect(before.html).not.toContain('data-dm-text-contrast');
      await expect(page.getByText('Light island', { exact: true })).toHaveAttribute('data-dm-tone', 'light');
    });
  }
}

test('theme and system-mode changes repaint without document transactions or accumulated color drift', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page, 'auto');
  const before = await snapshot(page);
  await expect.poll(async () => (await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
  await page.evaluate(() => {
    const target = window as unknown as ProbeWindow & { __readabilityTransactions: number };
    target.__readabilityTransactions = 0;
    target.__pasteCleanup.editor.on('transaction', () => { target.__readabilityTransactions++; });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => (await reading(page, 'Dark ink')).ratio).toBeGreaterThanOrEqual(4.5);
  const dark = (await reading(page, 'Dark ink')).color;
  for (let index = 0; index < 2; index++) {
    await page.evaluate(() => { document.body.className = 'dm-theme-light'; });
    await expect.poll(async () => (await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
    await page.evaluate(() => { document.body.className = 'dm-theme-dark'; });
    await expect.poll(async () => (await reading(page, 'Dark ink')).color).toBe(dark);
  }
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as { __readabilityTransactions: number }).__readabilityTransactions)).toBe(0);
});

test('printing uses the original colors and returning to the screen restores readability', async ({ page }) => {
  await open(page, 'dark');
  const before = await snapshot(page);
  await expect.poll(async () => (await reading(page, 'Dark ink')).ratio).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ media: 'print' });
  await expect.poll(async () => (await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
  await expect.poll(async () => (await reading(page, 'Hidden gold')).color).toBe('rgb(255, 204, 0)');
  await page.emulateMedia({ media: 'screen' });
  await expect.poll(async () => (await reading(page, 'Dark ink')).ratio).toBeGreaterThanOrEqual(4.5);
  expect(await snapshot(page)).toEqual(before);
});

test('the default policy retains original colors and unknown painted backgrounds are not guessed', async ({ page }) => {
  await open(page, 'dark', false);
  expect((await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
  await expect(page.locator('[data-dm-text-contrast]')).toHaveCount(0);
  await open(page, 'dark');
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).not.toBe('');
  await page.addStyleTag({ content: '.unknown-background .ProseMirror p { background-image: linear-gradient(black, white); }' });
  await page.locator('body').evaluate(element => { element.classList.add('unknown-background'); });
  expect(await page.getByText('Dark ink', { exact: true }).evaluate(element => {
    if (!element.parentElement) throw new Error('Missing paragraph');
    return getComputedStyle(element.parentElement).backgroundImage;
  }))
    .toBe('linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))');
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).toBe('');
  expect((await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
});

test('moving an unchanged editor between equally sized surfaces remeasures its text', async ({ page }) => {
  await open(page, 'dark');
  const before = await snapshot(page);
  await page.evaluate(() => {
    const root = (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom;
    const frame = root.closest<HTMLElement>('.dm-editor');
    if (!frame) throw new Error('Missing editor frame');
    frame.style.backgroundColor = 'transparent';
    root.style.backgroundColor = 'transparent';
    for (const [id, color] of [['readability-dark', '#202020'], ['readability-light', '#ffffff']] as const) {
      const host = document.createElement('div');
      host.id = id;
      host.style.cssText = `width:700px;min-height:600px;background-color:${color};`;
      document.body.append(host);
    }
    const dark = document.getElementById('readability-dark');
    if (!dark) throw new Error('Missing dark surface');
    dark.append(frame);
  });
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).not.toBe('');
  const bounds = await page.locator('.ProseMirror').boundingBox();
  if (!bounds) throw new Error('Missing editor bounds before moving');
  await page.evaluate(() => {
    const light = document.getElementById('readability-light');
    const frame = document.querySelector('.dm-editor');
    if (!light || !frame) throw new Error('Missing light surface or editor frame');
    light.append(frame);
  });
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).toBe('');
  const moved = await page.locator('.ProseMirror').boundingBox();
  if (!moved) throw new Error('Missing editor bounds after moving');
  // Moving between page positions can change the last floating-point bits of a browser's bounding rectangle.
  expect(moved.width).toBeCloseTo(bounds.width, 3);
  expect(moved.height).toBeCloseTo(bounds.height, 3);
  expect(await snapshot(page)).toEqual(before);
});

test('ancestor background transitions finish with a fresh contrast measurement', async ({ page }) => {
  await open(page, 'dark');
  await page.evaluate(() => {
    const root = (window as unknown as ProbeWindow).__pasteCleanup.editor.view.dom;
    const frame = root.closest<HTMLElement>('.dm-editor');
    if (!frame) throw new Error('Missing editor frame');
    root.style.backgroundColor = 'transparent';
    frame.style.backgroundColor = '#202020';
    frame.style.transition = 'background-color 180ms linear';
    frame.dataset['contrastHost'] = 'true';
  });
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).not.toBe('');
  await page.locator('[data-contrast-host]').evaluate(element => { (element as HTMLElement).style.backgroundColor = '#ffffff'; });
  await expect(page.locator('[data-contrast-host]')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).toBe('');
});

test('an inset shadow is treated as an unknown painted surface', async ({ page }) => {
  await open(page, 'dark');
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).not.toBe('');
  await page.addStyleTag({ content: '.inset-background .ProseMirror p { box-shadow: inset 0 0 0 9999px white; }' });
  await page.locator('body').evaluate(element => { element.classList.add('inset-background'); });
  await expect.poll(async () => (await reading(page, 'Dark ink')).adjusted).toBe('');
  expect((await reading(page, 'Dark ink')).color).toBe('rgb(0, 0, 0)');
});

test('a long document finishes painting and responds to a subsequent theme change', async ({ page }) => {
  await open(page, 'dark');
  const count = 1001;
  await page.evaluate(count => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    editor.setContent({ type: 'doc', content: Array.from({ length: count }, (_, index) => ({ type: 'paragraph', content: [
      { type: 'text', text: `Imported paragraph ${String(index + 1)}`, marks: [{ type: 'textStyle', attrs: { color: '#000000' } }] },
    ] })) }, false);
  }, count);
  const before = await snapshot(page);
  await expect(page.locator('[data-dm-text-contrast="adjusted"]')).toHaveCount(count);
  await expect.poll(async () => (await reading(page, 'Imported paragraph 1001')).ratio).toBeGreaterThanOrEqual(4.5);
  await page.locator('body').evaluate(element => { element.setAttribute('class', 'dm-theme-light'); });
  await expect(page.locator('[data-dm-text-contrast="adjusted"]')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
