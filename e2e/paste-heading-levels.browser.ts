/**
 * Heading levels the configuration lacks through real wrappers, with and without PasteCleanup:
 * HTML heading tags paste and drop at the nearest configured level, as JSON content loads them.
 * Clipboard and drop events are synthetic.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import type { PasteOperationResult } from '@domternal/extension-paste-cleanup';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;
const HTML = '<h1>A</h1><h5>B</h5><h6>C</h6>';

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    framework: string;
    editor: Editor;
    operations: PasteOperationResult[];
    clearObservations: () => void;
  };
}
type Transport = 'event' | 'pasteHTML' | 'drop';

async function open(page: Page, framework: string, options: { cleanup: boolean; levels?: 'narrow' }): Promise<void> {
  const query = new URLSearchParams({
    framework, ...(options.cleanup ? {} : { 'paste-cleanup': 'off' }), ...(options.levels === 'narrow' ? { schema: 'heading-levels' } : {}),
  });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/** Pastes or drops HTML into a fresh document and returns the heading levels and the operation's diagnostics. */
function transfer(page: Page, html: string, transport: Transport): Promise<{ levels: unknown[]; codes: string[]; prevented: boolean | null }> {
  return page.evaluate(async ({ html, transport }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const editor = probe.editor;
    if (!editor.setContent('<p></p><p>After</p>', false)) throw new Error('Could not seed the editor');
    editor.commands.focus('start');
    probe.clearObservations();
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'A\n\nB\n\nC');
    let prevented: boolean | null = null;
    if (transport === 'event') {
      const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
      if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
      editor.view.dom.dispatchEvent(event);
      prevented = event.defaultPrevented;
    } else if (transport === 'pasteHTML') {
      editor.view.pasteHTML(html, new ClipboardEvent('paste', { cancelable: true }));
    } else {
      const block = editor.view.dom.firstElementChild;
      if (!block) throw new Error('No block to drop on');
      const rect = block.getBoundingClientRect();
      const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 });
      if (event.dataTransfer !== data) Object.defineProperty(event, 'dataTransfer', { value: data });
      editor.view.dom.dispatchEvent(event);
      prevented = event.defaultPrevented;
    }
    for (let attempt = 0; attempt < 20 && probe.operations.length === 0 && transport !== 'drop'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const levels: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'heading') levels.push(node.attrs['level']); });
    return { levels, codes: probe.operations.flatMap(operation => operation.diagnostics.map(diagnostic => diagnostic.code)), prevented };
  }, { html, transport });
}

for (const cleanup of [false, true]) {
  const label = cleanup ? 'with PasteCleanup' : 'without PasteCleanup';
  for (const [levels, expected] of [[undefined, [1, 4, 4]], ['narrow', [2, 3, 3]]] as const) {
    for (const transport of ['event', 'pasteHTML', 'drop'] as const) {
      test(`${transport} ${label}: heading tags the levels ${levels === 'narrow' ? '2 and 3' : '1 to 4'} lack land at the nearest configured level`, async ({ page }) => {
        await open(page, 'vanilla', { cleanup, ...(levels === undefined ? {} : { levels }) });
        const outcome = await transfer(page, HTML, transport);
        expect(outcome.levels).toEqual(expected);
        if (transport !== 'pasteHTML') expect(outcome.prevented).toBe(true);
        // PasteCleanup adapts the tags before parsing and reports it; Core maps them silently.
        if (cleanup && transport !== 'drop') expect(outcome.codes).toContain('destination-heading-level-adapted');
        if (!cleanup) expect(outcome.codes).toEqual([]);
      });
    }
  }

  for (const framework of FRAMEWORKS) {
    test(`${framework} ${label}: a pasted h5 lands as a heading at level 4`, async ({ page }) => {
      await open(page, framework, { cleanup });
      expect((await transfer(page, '<h5>Five</h5>', 'event')).levels).toEqual([4]);
    });
  }
}
