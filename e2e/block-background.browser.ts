import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import { installContrastTools, type ContrastTools } from './contrast-tools.js';
import { test } from './fixtures.js';

interface ProbeWindow { __pasteCleanup: { ready: boolean; editor: Editor }; __contrastTools: ContrastTools }
const paragraph = (label: string, bgColor: string): JSONContent => ({
  type: 'paragraph', attrs: { bgColor }, content: [{ type: 'text', text: label }],
});
const CONTENT: JSONContent = { type: 'doc', content: [
  paragraph('Dark paragraph', '#002060'),
  paragraph('Light paragraph', '#fff2cc'),
  { type: 'paragraph', attrs: { bgColor: '#002060' } },
  { type: 'heading', attrs: { level: 2, bgColor: '#002060' }, content: [{ type: 'text', text: 'Shaded heading' }] },
  { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Shaded list text', '#002060')] }] },
  { type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', attrs: { background: '#fff2cc' }, content: [paragraph('Shaded cell paragraph', '#002060')] },
  ] }] },
  { type: 'paragraph', attrs: { bgColor: '#002060' }, content: [
    { type: 'text', text: 'Nested highlight', marks: [{ type: 'textStyle', attrs: { backgroundColor: '#fff2cc' } }] },
    { type: 'text', text: ' Authored black', marks: [{ type: 'textStyle', attrs: { color: '#000000' } }] },
  ] },
  paragraph('Translucent paragraph', 'rgba(0, 0, 0, 0.3)'),
  paragraph('Semantic palette', 'red'),
] };
const labels = ['Dark paragraph', 'Light paragraph', 'Shaded heading', 'Shaded list text', 'Shaded cell paragraph',
  'Nested highlight', ' Authored black'];

async function open(page: Page, mode: 'light' | 'dark'): Promise<void> {
  const query = new URLSearchParams({ framework: 'vanilla', theme: '1', contrast: '1', schema: 'capability-full',
    'theme-mode': mode, 'text-contrast': 'auto' });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await page.evaluate(json => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    if (!editor.setContent(JSON.parse(json) as JSONContent, false)) throw new Error('The block background document was refused');
    editor.view.dom.blur();
  }, JSON.stringify(CONTENT));
  await page.evaluate(installContrastTools);
}

async function snapshot(page: Page): Promise<{ json: string; html: string }> {
  return page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { json: JSON.stringify(editor.getJSON()), html: editor.getHTML() };
  });
}

async function reading(page: Page, label: string): Promise<{ ratio: number; color: string }> {
  return page.evaluate(label => {
    const { __pasteCleanup: { editor }, __contrastTools: tools } = window as unknown as ProbeWindow;
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent === label && node.parentElement) {
        return { ratio: tools.text(node.parentElement).ratio, color: getComputedStyle(node.parentElement).color };
      }
    }
    throw new Error(`Missing block background probe: ${label}`);
  }, label);
}

for (const mode of ['light', 'dark'] as const) test(`full block backgrounds remain readable and independent of highlights in ${mode}`, async ({ page }) => {
  await open(page, mode);
  const before = await snapshot(page);
  for (const label of labels) await expect.poll(async () => (await reading(page, label)).ratio, { message: label }).toBeGreaterThanOrEqual(4.5);
  const blocks = page.locator('.ProseMirror > p');
  await expect(blocks.nth(0)).toHaveCSS('background-color', 'rgb(0, 32, 96)');
  await expect(blocks.nth(1)).toHaveCSS('background-color', 'rgb(255, 242, 204)');
  await expect(blocks.nth(2)).toHaveAttribute('data-dm-tone', 'dark');
  const widths = await blocks.nth(0).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return { block: element.getBoundingClientRect().width, text: range.getBoundingClientRect().width };
  });
  expect(widths.block).toBeGreaterThan(widths.text * 2);
  expect((await blocks.nth(2).boundingBox())?.height).toBeGreaterThan(0);
  await expect(page.getByText('Nested highlight', { exact: true })).toHaveCSS('background-color', 'rgb(255, 242, 204)');
  await expect(page.getByText('Translucent paragraph', { exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.3)');
  await expect(page.getByText('Translucent paragraph', { exact: true })).not.toHaveAttribute('data-dm-tone');
  await expect(page.getByText('Semantic palette', { exact: true })).toHaveAttribute('data-bg-color', 'red');
  expect(await snapshot(page)).toEqual(before);
  expect(before.html).not.toContain('data-dm-tone');
  expect(before.html).not.toContain('dm-readable');
});

test('theme changes and printing keep the original block fills and authored text', async ({ page }) => {
  await open(page, 'dark');
  const before = await snapshot(page);
  await expect.poll(async () => (await reading(page, ' Authored black')).ratio).toBeGreaterThanOrEqual(4.5);
  await page.locator('body').evaluate(element => { element.setAttribute('class', 'dm-theme-light'); });
  await expect.poll(async () => (await reading(page, 'Dark paragraph')).ratio).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByText('Dark paragraph', { exact: true })).toHaveCSS('background-color', 'rgb(0, 32, 96)');
  await expect.poll(async () => (await reading(page, ' Authored black')).color).toBe('rgb(0, 0, 0)');
  await page.emulateMedia({ media: 'screen' });
  await expect.poll(async () => (await reading(page, ' Authored black')).ratio).toBeGreaterThanOrEqual(4.5);
  expect(await snapshot(page)).toEqual(before);
});

test('changing and undoing a paragraph fill updates only its presentation', async ({ page }) => {
  await open(page, 'dark');
  const before = await snapshot(page);
  await page.evaluate(() => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'bgColor', '#fff2cc'));
  });
  await expect(page.getByText('Dark paragraph', { exact: true })).toHaveCSS('background-color', 'rgb(255, 242, 204)');
  await expect(page.getByText('Dark paragraph', { exact: true })).toHaveAttribute('data-dm-tone', 'light');
  await expect.poll(async () => (await reading(page, 'Dark paragraph')).ratio).toBeGreaterThanOrEqual(4.5);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  await expect(page.getByText('Dark paragraph', { exact: true })).toHaveCSS('background-color', 'rgb(0, 32, 96)');
  expect(await snapshot(page)).toEqual(before);
});
