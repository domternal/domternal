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

async function open(page: Page, framework: string, options: { cleanup: boolean; levels?: 'narrow'; details?: boolean; noLists?: boolean }): Promise<void> {
  const query = new URLSearchParams({
    framework, ...(options.cleanup ? {} : { 'paste-cleanup': 'off' }), ...(options.levels === 'narrow' ? { schema: 'heading-levels' } : {}),
    ...(options.noLists === true ? { schema: 'no-lists' } : {}),
    ...(options.details === true ? { details: '1' } : {}),
  });
  await page.goto(`${BASE_URL}/?${query.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/** Pastes or drops HTML into a fresh document and returns the heading levels and the operation's diagnostics. */
function transfer(page: Page, html: string, transport: Transport): Promise<{ levels: unknown[]; codes: string[]; statuses: string[]; prevented: boolean | null }> {
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
    // Without PasteCleanup no operation is reported; with it, a drop reports one too.
    const cleanup = editor.extensionManager.extensions.some(extension => extension.name === 'pasteCleanup');
    for (let attempt = 0; attempt < 20 && probe.operations.length === 0 && cleanup; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const levels: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'heading') levels.push(node.attrs['level']); });
    return {
      levels, codes: probe.operations.flatMap(operation => operation.diagnostics.map(diagnostic => diagnostic.code)),
      statuses: probe.operations.map(operation => operation.status), prevented,
    };
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
        // A drop has no paste receipt, so its operation stays untracked with every warning.
        if (cleanup) expect(outcome.codes).toContain('destination-heading-level-adapted');
        if (cleanup) expect(outcome.statuses).toEqual([transport === 'drop' ? 'untracked' : 'applied']);
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

// Where a heading cannot stand, a tag the levels lack keeps the paragraph 1.2 parsed, so the list and summary stay whole.
const CONFINED = '<ul><li><h5>First</h5></li><li><h6>Second</h6><ul><li><h5>Nested</h5></li></ul></li></ul>'
  + '<details open><summary><h5>Summary</h5></summary><div data-details-content><p>Body</p></div></details>';

for (const framework of FRAMEWORKS) {
  test(`${framework} without PasteCleanup: an h5 or h6 that starts a list item or sits in a summary keeps its text in place`, async ({ page }) => {
    await open(page, framework, { cleanup: false, details: true });
    const outcomes = await page.evaluate(async html => {
      const probe = (window as unknown as ProbeWindow).__pasteCleanup;
      const editor = probe.editor;
      const shape = (): unknown => {
        const doc = editor.getJSON();
        const names: string[] = [];
        editor.state.doc.descendants(node => { if (!node.isText) names.push(node.type.name); });
        return { top: doc.content?.map(node => node.type), headings: names.filter(name => name === 'heading').length,
          items: names.filter(name => name === 'listItem').length, text: editor.state.doc.textContent };
      };
      const results: unknown[] = [];
      if (!editor.setContent(html, false)) throw new Error('Could not set the content');
      results.push(shape());
      for (const transport of ['event', 'drop'] as const) {
        if (!editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
        editor.commands.focus('start');
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'First Second Nested Summary Body');
        if (transport === 'event') {
          const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
          if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
          editor.view.dom.dispatchEvent(event);
        } else {
          const block = editor.view.dom.firstElementChild;
          if (!block) throw new Error('No block to drop on');
          const rect = block.getBoundingClientRect();
          const event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: rect.left + 2, clientY: rect.top + rect.height / 2 });
          if (event.dataTransfer !== data) Object.defineProperty(event, 'dataTransfer', { value: data });
          editor.view.dom.dispatchEvent(event);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        results.push(shape());
      }
      return results;
    }, CONFINED);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({ headings: 0, items: 3, text: 'FirstSecondNestedSummaryBody' });
    }
    expect(outcomes[0]).toMatchObject({ top: ['bulletList', 'details'] });
  });
}

// Where a heading cannot stand, every heading tag, a configured level too, parses as that block's text.
const CONFIGURED = '<ol start="3"><li><h2>First</h2><p>more</p></li><li><h3>Second</h3><ul><li><h1>Nested</h1></li></ul></li></ol>'
  + '<details open><summary><h2>Summary</h2></summary><div data-details-content><p>Body</p></div></details>';

for (const cleanup of [false, true]) {
  for (const framework of FRAMEWORKS) {
    test(`${framework} ${cleanup ? 'with' : 'without'} PasteCleanup: a configured heading tag that starts a list item or sits in a summary keeps the list and summary whole`, async ({ page }) => {
      await open(page, framework, { cleanup, details: true });
      const outcomes = await page.evaluate(async html => {
        const probe = (window as unknown as ProbeWindow).__pasteCleanup;
        const editor = probe.editor;
        const shape = (): unknown => {
          const names: string[] = [];
          editor.state.doc.descendants(node => { if (!node.isText) names.push(node.type.name); });
          const list = editor.state.doc.firstChild;
          return {
            top: editor.getJSON().content?.map(node => node.type), headings: names.filter(name => name === 'heading').length,
            items: names.filter(name => name === 'listItem').length, start: list?.attrs['start'] as unknown, text: editor.state.doc.textContent,
            codes: probe.operations.flatMap(operation => operation.diagnostics.map(diagnostic => diagnostic.code)),
          };
        };
        const results: unknown[] = [];
        if (!editor.setContent(html, false)) throw new Error('Could not set the content');
        results.push(shape());
        if (!editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
        editor.commands.focus('start');
        probe.clearObservations();
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'First more Second Nested Summary Body');
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
        editor.view.dom.dispatchEvent(event);
        for (let attempt = 0; attempt < 20 && probe.operations.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const region = document.querySelector('[role="region"][aria-label="Paste notice"]');
        results.push({ ...(shape() as object), notice: region instanceof HTMLElement && !region.hidden && region.textContent.includes('heading') });
        return results;
      }, CONFIGURED);
      for (const outcome of outcomes) {
        expect(outcome).toMatchObject({ top: ['orderedList', 'details'], headings: 0, items: 3, start: 3, text: 'FirstmoreSecondNestedSummaryBody' });
        expect((outcome as { codes: string[] }).codes).not.toContain('destination-heading-level-adapted');
      }
      expect(outcomes[1]).toMatchObject({ notice: false });
    });
  }
}

for (const cleanup of [false, true]) {
  for (const framework of FRAMEWORKS) {
    test(`${framework} ${cleanup ? 'with' : 'without'} PasteCleanup: a heading after an empty item paragraph stays a heading, as getHTML writes it`, async ({ page }) => {
      await open(page, framework, { cleanup });
      const outcome = await transfer(page, '<ul><li><p></p><h5>Kept</h5></li><li><p>two</p></li></ul>', 'event');
      expect(outcome.levels).toEqual([4]);
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML().replace(/ id="[^"]*"/g, '')))
        .toContain('<ul><li><p></p><h4>Kept</h4></li><li><p>two</p></li></ul>');
      if (cleanup) expect(outcome.codes).toContain('destination-heading-level-adapted');
    });
  }

  test(`${cleanup ? 'with' : 'without'} PasteCleanup: a heading that starts a list item stays a heading in an editor without lists, as in 1.2`, async ({ page }) => {
    await open(page, 'vanilla', { cleanup, noLists: true });
    const outcome = await transfer(page, '<ul><li><h2>Title</h2></li><li><h5>Deep</h5></li></ul>', 'event');
    expect(outcome.levels).toEqual([2, 4]);
    if (cleanup) expect(outcome.codes).toContain('destination-heading-level-adapted');
  });
}

/** Pastes Markdown as plain text, which the Markdown extension converts. */
function pasteMarkdown(page: Page, markdown: string): Promise<{ levels: unknown[]; codes: string[]; notice: boolean }> {
  return page.evaluate(async markdown => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const editor = probe.editor;
    if (!editor.setContent('<p></p>', false)) throw new Error('Could not seed the editor');
    editor.commands.focus('start');
    probe.clearObservations();
    const data = new DataTransfer();
    data.setData('text/plain', markdown);
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    editor.view.dom.dispatchEvent(event);
    for (let attempt = 0; attempt < 20 && probe.operations.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => requestAnimationFrame(resolve));
    const levels: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'heading') levels.push(node.attrs['level']); });
    const region = document.querySelector('[role="region"][aria-label="Paste notice"]');
    return {
      levels, codes: probe.operations.flatMap(operation => operation.diagnostics.map(diagnostic => diagnostic.code)),
      notice: region instanceof HTMLElement && !region.hidden && region.textContent.includes('heading'),
    };
  }, markdown);
}

for (const cleanup of [false, true]) {
  test(`Markdown paste ${cleanup ? 'with' : 'without'} PasteCleanup parses a heading that starts a list item as its text`, async ({ page }) => {
    await open(page, 'vanilla', { cleanup });
    expect(await pasteMarkdown(page, '- # Title\n- two\n\n# Kept')).toEqual({ levels: [1], codes: [], notice: false });
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML().replace(/ id="[^"]*"/g, '')))
      .toContain('<ul><li><p>Title</p></li><li><p>two</p></li></ul>');
  });

  for (const [levels, expected] of [[undefined, [1, 4, 4]], ['narrow', [2, 3, 3]]] as const) {
    test(`Markdown paste ${cleanup ? 'with' : 'without'} PasteCleanup lands headings at the nearest of levels ${levels === 'narrow' ? '2 and 3' : '1 to 4'}`, async ({ page }) => {
      await open(page, 'vanilla', { cleanup, ...(levels === undefined ? {} : { levels }) });
      expect(await pasteMarkdown(page, '# A\n\n##### B\n\n###### C')).toEqual({ levels: expected, codes: [], notice: false });
    });
  }
}
