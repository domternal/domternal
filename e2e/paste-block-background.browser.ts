import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { installContrastTools, type ContrastTools } from './contrast-tools.js';
import { test } from './fixtures.js';

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    clearObservations(): void;
    history(): { undo: number; redo: number };
    setAssetBindings(bindings: { reference: string; itemIndex: number }[]): void;
    holdAssetReads(): void;
    releaseAssetReads(): Promise<void>;
    preparationProgress: { phase: string }[];
  };
  __contrastTools: ContrastTools;
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const HTML = '<p style="background:#002060">Dark paragraph <span style="background:#fff2cc">Highlight</span></p>'
  + '<p style="background:#fff2cc"></p><h2 style="background:#002060">Heading</h2>'
  + '<ul><li><p style="background:#002060">List paragraph</p></li></ul>'
  + '<table><tr><td style="background:#fff2cc"><p style="background:#002060">Cell paragraph</p></td></tr></table>';

async function open(page: Page, framework: string, extras: Record<string, string> = {}): Promise<void> {
  const query = new URLSearchParams({ framework, schema: 'capability-full', theme: '1', contrast: '1',
    'theme-mode': 'dark', 'text-contrast': 'auto', assets: 'embedded', 'asset-hooks': 'off', ...extras });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed editor');
    probe.editor.commands.focus('start');
    probe.clearObservations();
  });
  await page.waitForFunction(() => typeof (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild?.attrs['id'] === 'string');
  await page.evaluate(installContrastTools);
}
function snapshot(page: Page): Promise<JSONContent> {
  return page.evaluate((): JSONContent => (window as unknown as ProbeWindow).__pasteCleanup.editor.getJSON());
}
async function paste(page: Page, html: string, image = false): Promise<void> {
  expect(await page.evaluate(({ html, image, png }) => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const data = new DataTransfer();
    data.setData('text/html', html);
    if (image) data.items.add(new File([Uint8Array.from(atob(png), value => value.charCodeAt(0))], 'diagram.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  }, { html, image, png: PNG })).toBe(true);
}
async function completed(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations[0]?.status)).toBe('applied');
}
async function undoRedo(page: Page, before: JSONContent): Promise<void> {
  const after = await snapshot(page);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 1, redo: 0 });
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo())).toBe(true);
  expect(await snapshot(page)).toEqual(after);
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const mode of ['light', 'dark']) test(`${framework}: pasted full-width backgrounds and nested highlights in ${mode}`, async ({ page }) => {
    await open(page, framework, { 'theme-mode': mode });
    const before = await snapshot(page);
    await paste(page, HTML);
    await completed(page);
    await expect(page.locator('.ProseMirror > p').first()).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.locator('.ProseMirror > p').nth(1)).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    await expect(page.locator('.ProseMirror h2')).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.locator('.ProseMirror li p')).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.locator('.ProseMirror td p')).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.locator('.ProseMirror td')).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    await expect(page.getByText('Highlight', { exact: true })).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    expect(await page.evaluate(() => {
      const { __pasteCleanup: { editor }, __contrastTools: tools } = window as unknown as ProbeWindow;
      const first = editor.view.dom.querySelector('p');
      if (!first) throw new Error('Missing paragraph');
      const range = document.createRange();
      range.selectNodeContents(first);
      const bgColor: unknown = editor.state.doc.firstChild?.attrs['bgColor'];
      return { ratio: tools.text(first).ratio, fullWidth: first.getBoundingClientRect().width > range.getBoundingClientRect().width * 2,
        bgColor, firstMarks: editor.state.doc.firstChild?.firstChild?.marks.length };
    })).toMatchObject({ ratio: expect.any(Number), fullWidth: true, bgColor: '#002060', firstMarks: 0 });
    await expect.poll(() => page.evaluate(() => {
      const { __pasteCleanup: { editor }, __contrastTools: tools } = window as unknown as ProbeWindow;
      return tools.text(editor.view.dom.querySelector('p') as HTMLElement).ratio;
    })).toBeGreaterThanOrEqual(4.5);
    await undoRedo(page, before);
  });

  test(`${framework}: unavailable block fills use a disclosed inline fallback and Adapt removes them`, async ({ page }) => {
    await open(page, framework, { contrast: '0' });
    await paste(page, '<p style="background:#002060">Fallback <span style="background:#fff2cc">Highlight</span></p>');
    await completed(page);
    await expect(page.locator('.ProseMirror p')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByText('Fallback ', { exact: true })).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.getByText('Highlight', { exact: true })).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations[0]?.diagnostics.map(item => item.code)))
      .toContain('destination-formatting-unconfirmed');
    await open(page, framework, { formatting: 'adapt' });
    await paste(page, '<p style="background:#002060">Adapted <span style="background:#fff2cc">highlight</span></p>');
    await completed(page);
    expect(await page.evaluate(() => {
      const first = (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild;
      const fill: unknown = first?.attrs['bgColor'];
      return { fill, marks: first?.firstChild?.marks.length, text: first?.textContent };
    })).toEqual({ fill: null, marks: 0, text: 'Adapted highlight' });
  });

  test(`${framework}: paragraph fill survives asynchronous image preparation`, async ({ page }) => {
    await open(page, framework);
    const before = await snapshot(page);
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      probe.setAssetBindings([{ reference: 'cid:diagram', itemIndex: 1 }]);
      probe.holdAssetReads();
    });
    await paste(page, '<p style="background:#002060">Before picture</p><img src="cid:diagram" alt="Diagram"><p>After picture</p>', true);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.preparationProgress.length)).toBeGreaterThan(0);
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseAssetReads(); });
    await completed(page);
    await expect(page.locator('.ProseMirror p').first()).toHaveCSS('background-color', 'rgb(0, 32, 96)');
    await expect(page.locator('.ProseMirror img')).toHaveAttribute('src', /^data:image\/png;base64,/u);
    expect(await page.evaluate((): unknown => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild?.attrs['bgColor'])).toBe('#002060');
    await undoRedo(page, before);
  });
}
