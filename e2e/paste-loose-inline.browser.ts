/**
 * Inline content that follows a block at the top of pasted HTML, as a partial Google Docs selection
 * may write its last paragraph: bare spans after the blocks, inside the guid wrapper. ProseMirror's
 * parse dropped a span holding only a space there, so "GB09 bold ita" pasted as
 * "GB09 boldita". PasteCleanup wraps such a run in a division, which a block image in the run
 * ends without an empty paragraph before it. Synthetic paste events through every wrapper; the unit
 * tests are packages/extension-paste-cleanup/src/PasteCleanup.looseInline.test.ts and
 * src/html/looseInline.test.ts. A span left with only one no-break space, as cleanup leaves the first
 * space of a partial Word selection, pastes as a space in every engine, as Chromium's paste turns it.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    operations: PasteOperationResult[];
    select: (from: number, to?: number) => void;
    clearObservations: () => void;
  };
}

// Authored in the shape Google Docs is expected to write; not a native capture.
const google = (content: string): string =>
  `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-00000000-7fff-4000-8000-000000000009">${content}</b>`;
const run = (style: string, text: string): string =>
  `<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;${style}white-space:pre-wrap;">${text}</span>`;
const partialLast = run('font-weight:400;', 'GB09 ') + run('font-weight:700;', 'bold') + run('font-weight:400;', ' ')
  + run('font-weight:400;font-style:italic;', 'ita');
const first = '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;">First</span></p>';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
// The image box Google Docs is expected to write around an image in a paragraph; authored, not a native capture.
const imageBox = run('font-weight:400;', '<span style="border:none;display:inline-block;overflow:hidden;width:20px;height:20px;">'
  + `<img src="${PNG}" width="20" height="20" alt="i" style="margin-left:0px;margin-top:0px;" /></span>`);

const SHAPES: Record<string, { html: string; blocks: string[] }> = {
  'a partial Google Docs last paragraph': { html: google(first + partialLast), blocks: ['paragraph: First', 'paragraph: GB09 bold ita'] },
  'the same after a Google Docs line break': { html: google(`${first}<br />${partialLast}`), blocks: ['paragraph: First', 'paragraph: \nGB09 bold ita'] },
  'formatted words after a paragraph': { html: '<p>x</p><b>a</b> <i>b</i>', blocks: ['paragraph: x', 'paragraph: a b'] },
  'formatted words after a list': { html: '<ul><li>x</li></ul><b>a</b> <i>b</i>', blocks: ['bulletList: x', 'paragraph: a b'] },
  // The fixture's Image is a block.
  'words after an image that starts the run': {
    html: `<p>x</p><img src="${PNG}" alt="i"><span>a</span><span> </span><span>b</span>`, blocks: ['paragraph: x', 'image: ', 'paragraph: a b'],
  },
  'a partial Google Docs last paragraph that starts with an image': {
    html: google(first + imageBox + partialLast), blocks: ['paragraph: First', 'image: ', 'paragraph: GB09 bold ita'],
  },
};

// A span with one no-break space: Chromium's paste turned it into a space, Firefox and WebKit did not.
const SPACES: Record<string, { html: string; blocks: string[] }> = {
  'a bare span holding one no-break space between words': { html: '<p>a<span>\u00a0</span>b</p>', blocks: ['paragraph: a b'] },
  'a partial Word selection that starts at a space': {
    html: '<p class=MsoNormal><span class="MsoSpacer">\u00a0</span><span style="font-size:12pt">a</span> b</p>', blocks: ['paragraph: a b'],
  },
  'two no-break spaces in one span': { html: '<p>a<span>\u00a0\u00a0</span>b</p>', blocks: ['paragraph: a\u00a0\u00a0b'] },
};

async function open(page: Page, framework: string, formatting: 'preserve' | 'adapt'): Promise<void> {
  await page.goto(`${BASE_URL}/?${new URLSearchParams({ framework, formatting }).toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/** Pastes each shape into an empty document and reports its blocks, with a hard break as a line feed. */
async function pasteShapes(page: Page, shapes = SHAPES): Promise<Record<string, { blocks: string[]; valid: boolean; status: string[] }>> {
  const outcomes: Record<string, { blocks: string[]; valid: boolean; status: string[] }> = {};
  for (const [name, { html }] of Object.entries(shapes)) {
    await page.evaluate(html => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      if (!probe.editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
      probe.select(1);
      probe.clearObservations();
      const data = new DataTransfer();
      data.setData('text/html', html);
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      probe.editor.view.dom.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error('The editor did not handle the paste');
    }, html);
    await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.operations.length)).toBe(1);
    outcomes[name] = await page.evaluate(() => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const blocks: string[] = [];
      probe.editor.state.doc.forEach(node => {
        let text = '';
        node.descendants(child => { text += child.isText ? child.text ?? '' : child.type.name === 'hardBreak' ? '\n' : ''; });
        blocks.push(`${node.type.name}: ${text}`);
      });
      let valid = true;
      try { probe.editor.state.doc.check(); } catch { valid = false; }
      return { blocks, valid, status: probe.operations.map(operation => operation.status) };
    });
  }
  return outcomes;
}

for (const framework of FRAMEWORKS) {
  for (const formatting of ['preserve', 'adapt'] as const) {
    test(`${framework} keeps the spaces of inline content that follows a block in ${formatting}`, async ({ page }) => {
      await open(page, framework, formatting);
      const expected = Object.fromEntries(Object.entries(SHAPES).map(([name, { blocks }]) => [name, { blocks, valid: true, status: ['applied'] }]));
      expect(await pasteShapes(page)).toEqual(expected);
    });
  }
}

for (const formatting of ['preserve', 'adapt'] as const) {
  test(`a span holding one no-break space pastes as a space in every engine in ${formatting}`, async ({ page }) => {
    await open(page, 'vanilla', formatting);
    const expected = Object.fromEntries(Object.entries(SPACES).map(([name, { blocks }]) => [name, { blocks, valid: true, status: ['applied'] }]));
    expect(await pasteShapes(page, SPACES)).toEqual(expected);
  });
}
