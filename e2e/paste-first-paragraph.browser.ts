/** Empty-paragraph formatting through real framework wrappers and synthetic clipboard transfers. */
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

interface Snapshot { doc: JSONContent; selection: unknown }
interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    select(from: number, to?: number): void;
    clearObservations(): void;
    history(): { undo: number; redo: number };
    setAssetBindings(bindings: { reference: string; itemIndex: number }[]): void;
    holdAssetReads(): void;
    releaseAssetReads(): Promise<void>;
    preparationProgress: { phase: string }[];
  };
}
const EMPTY = '<p style="text-align:right;line-height:2"></p>';
const SOURCE = '<p style="text-align:center;line-height:1.5">First <strong>paragraph</strong></p>'
  + '<p style="text-align:justify;line-height:1.25">Second paragraph</p>';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';

type Route = 'native' | 'programmatic';
async function open(page: Page, framework: string): Promise<void> {
  const query = new URLSearchParams({ framework, schema: 'capability-full', assets: 'embedded', 'asset-hooks': 'off' });
  await page.goto(`http://127.0.0.1:5895/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}
async function seed(page: Page, html = EMPTY): Promise<void> {
  await page.evaluate(html => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Could not seed editor');
    probe.editor.commands.focus('start');
    probe.clearObservations();
  }, html);
  await page.waitForFunction(() => {
    let paragraph: string | undefined;
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.type.name === 'paragraph' && typeof node.attrs['id'] === 'string') paragraph ??= node.attrs['id'];
    });
    return paragraph !== undefined;
  });
}
function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((): Snapshot => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    return { doc: editor.getJSON(), selection: editor.state.selection.toJSON() };
  });
}
function paragraphs(page: Page): Promise<{ attrs: Record<string, unknown>; text: string }[]> {
  return page.evaluate(() => {
    const result: { attrs: Record<string, unknown>; text: string }[] = [];
    (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
      if (node.type.name === 'paragraph') result.push({ attrs: { ...node.attrs }, text: node.textContent });
    });
    return result;
  });
}
async function paste(page: Page, html: string, route: Route, image = false): Promise<void> {
  expect(await page.evaluate(({ html, route, image, png }) => {
    const editor = (window as unknown as ProbeWindow).__pasteCleanup.editor;
    const data = new DataTransfer();
    data.setData('text/html', html);
    if (image) data.items.add(new File([Uint8Array.from(atob(png), value => value.charCodeAt(0))], 'diagram.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    if (route === 'programmatic') return editor.view.pasteHTML(html, event);
    editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  }, { html, route, image, png: PNG })).toBe(true);
}
async function completed(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations[0]))
    .toMatchObject({ status: 'applied', references: { expired: false } });
}
async function undoRedo(page: Page, before: Snapshot): Promise<void> {
  const after = await snapshot(page);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.history())).toEqual({ undo: 1, redo: 0 });
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.commands.redo())).toBe(true);
  expect(await snapshot(page)).toEqual(after);
}

for (const framework of ['vanilla', 'react', 'vue', 'angular']) {
  for (const route of ['native', 'programmatic'] as const) {
    test(`${framework}: first paragraph preserves explicit source formatting through ${route}`, async ({ page }) => {
      await open(page, framework);
      await seed(page);
      const before = await snapshot(page);
      const id = (await paragraphs(page))[0]?.attrs['id'];
      await paste(page, SOURCE, route);
      await completed(page);
      expect(await paragraphs(page)).toEqual([
        { attrs: expect.objectContaining({ id, textAlign: 'center', lineHeight: '1.5' }), text: 'First paragraph' },
        { attrs: expect.objectContaining({ textAlign: 'justify', lineHeight: '1.25' }), text: 'Second paragraph' },
      ]);
      await expect(page.locator('.ProseMirror p').first()).toHaveCSS('text-align', 'center');
      await expect(page.locator('.ProseMirror strong')).toHaveText('paragraph');
      await undoRedo(page, before);
    });
  }

  test(`${framework}: first paragraph stays attached to an asynchronous image paste`, async ({ page }) => {
    await open(page, framework);
    await seed(page);
    const before = await snapshot(page);
    const id = (await paragraphs(page))[0]?.attrs['id'];
    await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      probe.setAssetBindings([{ reference: 'cid:diagram', itemIndex: 1 }]);
      probe.holdAssetReads();
    });
    await paste(page, '<p style="text-align:center;line-height:1.5">First paragraph</p><img src="cid:diagram" alt="Diagram"><p>After picture</p>', 'native', true);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.preparationProgress.length)).toBeGreaterThan(0);
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(async () => { await (window as unknown as ProbeWindow).__pasteCleanup.releaseAssetReads(); });
    await completed(page);
    const first = (await paragraphs(page))[0];
    expect(first).toMatchObject({ attrs: { id: expect.any(String), textAlign: 'center', lineHeight: '1.5' }, text: 'First paragraph' });
    // A block image selects SmartPaste's existing whole-node replacement path, including new block identities.
    expect(first?.attrs['id']).not.toBe(id);
    expect(await page.evaluate(() => {
      const ids: string[] = [];
      (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.descendants(node => {
        if (typeof node.attrs['id'] === 'string') ids.push(node.attrs['id']);
      });
      return new Set(ids).size === ids.length;
    })).toBe(true);
    await expect(page.locator('.ProseMirror img[alt="Diagram"]')).toHaveAttribute('src', /^data:image\/png;base64,/u);
    await undoRedo(page, before);
  });

  test(`${framework}: existing text and empty semantic containers keep their insertion semantics`, async ({ page }) => {
    await open(page, framework);
    for (const [html, kind, text, alignment] of [
      [EMPTY.replace('></p>', '>Existing</p>'), 'paragraph', 'First paragraphExisting', 'right'],
      [`<ul><li>${EMPTY}</li></ul>`, 'bulletList', 'First paragraph', 'center'],
      [`<table><tr><td>${EMPTY}</td></tr></table>`, 'table', 'First paragraph', 'center'],
      ['<h2 style="text-align:right;line-height:2"></h2><p>After</p>', 'heading', 'First paragraph', 'right'],
    ]) {
      await seed(page, html);
      await paste(page, '<p style="text-align:center;line-height:1.5">First paragraph</p>', 'native');
      await completed(page);
      expect(await page.evaluate(() => {
        const first = (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.firstChild;
        let block = first;
        while (block !== null && !block.isTextblock) block = block.firstChild;
        return { kind: first?.type.name, text: block?.textContent, alignment: block?.attrs['textAlign'] as unknown };
      })).toEqual({ kind, text, alignment });
    }
  });
}
