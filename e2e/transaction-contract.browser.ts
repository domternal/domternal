/**
 * The transaction callback contract through real wrappers and real input: a keystroke or IME
 * composition that a plugin vetoes (CharacterCount's limit) changes neither the DOM nor the state
 * and reaches no callback, and a document change that only an appended transaction makes reaches
 * each wrapper's update callback exactly once. Keys are real; appended changes are dispatched.
 */
import { expect, type Page } from '@playwright/test';
import type { Editor } from '@domternal/core';
import { test } from './fixtures.js';

const BASE_URL = 'http://127.0.0.1:5895';
const FRAMEWORKS = ['vanilla', 'react', 'vue', 'angular'] as const;

interface ProbeWindow {
  __pasteCleanup: {
    ready: boolean;
    editor: Editor;
    transactions: { paste: boolean }[];
    hostUpdates: number;
    wrapperCalls: string[];
    angularForm: { dirty: boolean; value: string; signal: string | null } | null;
    clearObservations: () => void;
  };
}

interface Observed {
  state: string;
  dom: string;
  html: string;
  domHtml: string;
  transactions: number;
  updates: number;
  calls: string[];
  form: { dirty: boolean; value: string; signal: string | null } | null;
}

async function open(page: Page, framework: string, query: Record<string, string>): Promise<void> {
  const params = new URLSearchParams({
    framework, 'paste-cleanup': 'off', 'unique-id': 'off', ...(framework === 'angular' ? { 'angular-form': '1' } : {}), ...query,
  });
  await page.goto(`${BASE_URL}/?${params.toString()}`);
  await page.waitForFunction(() => (window as unknown as Partial<ProbeWindow>).__pasteCleanup?.ready);
  await expect(page.locator('.ProseMirror')).toBeVisible();
}

/** Loads content without an update, as a programmatic write, and clears every observation. */
async function seed(page: Page, html: string, caret: 'end' | number): Promise<void> {
  await page.evaluate(({ html, caret }) => {
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    if (!probe.editor.setContent(html, false)) throw new Error('Could not seed the editor');
    probe.editor.commands.focus(caret);
    probe.clearObservations();
  }, { html, caret });
}

function observe(page: Page): Promise<Observed> {
  return page.evaluate(async () => {
    // Angular renders the htmlContent output on its next change detection, scheduled for the next
    // frame; reading it before then sees the previous value.
    await new Promise<void>(resolve => { requestAnimationFrame(() => { setTimeout(resolve, 0); }); });
    const probe = (window as unknown as ProbeWindow).__pasteCleanup;
    const clean = (html: string): string => html.replace(/ class="[^"]*"/g, '').replace(/<br[^>]*>/g, '');
    return {
      state: probe.editor.state.doc.textContent,
      dom: probe.editor.view.dom.textContent,
      html: probe.editor.getHTML(),
      domHtml: clean(probe.editor.view.dom.innerHTML),
      transactions: probe.transactions.length,
      updates: probe.hostUpdates,
      calls: [...probe.wrapperCalls],
      form: probe.angularForm,
    };
  });
}

for (const framework of FRAMEWORKS) {
  test.describe(`transaction contract (${framework})`, () => {
    for (const where of ['end', 'middle'] as const) {
      test(`a vetoed keystroke at the ${where} changes nothing and reaches no callback`, async ({ page }) => {
        await open(page, framework, { limit: '5' });
        await seed(page, '<p>Start</p>', where === 'end' ? 'end' : 3);

        await page.keyboard.type('XY');
        let observed = await observe(page);
        expect(observed).toMatchObject({ state: 'Start', dom: 'Start', transactions: 0, updates: 0, calls: [] });
        if (framework === 'angular') expect(observed.form).toEqual({ dirty: false, value: '<p></p>', signal: '<p>Start</p>' });

        // Enter adds no character, so the limit accepts it: one update, and the DOM follows the state.
        await page.keyboard.press('Enter');
        observed = await observe(page);
        expect(observed.html).toBe(where === 'end' ? '<p>Start</p><p></p>' : '<p>St</p><p>art</p>');
        expect(observed.domHtml).toBe(observed.html);
        expect(observed).toMatchObject({ transactions: 1, updates: 1, calls: ['update'] });
        if (framework === 'angular') expect(observed.form).toMatchObject({ dirty: true, value: observed.html, signal: observed.html });

        // Backspace joins the blocks again; the next key is vetoed once more.
        await page.keyboard.press('Backspace');
        await page.keyboard.type('Z');
        observed = await observe(page);
        expect(observed).toMatchObject({ state: 'Start', dom: 'Start', transactions: 2, updates: 2, calls: ['update', 'update'] });
        expect(observed.domHtml).toBe(observed.html);
      });
    }

    test('a document change that only an appended transaction makes reaches the update callback once', async ({ page }) => {
      await open(page, framework, { lifecycle: 'append-doc' });
      await seed(page, '<p>Hello</p>', 'end');

      await page.evaluate(() => {
        const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
        // The caret is a TextSelection; its class moves it without importing ProseMirror here.
        const TextSelection = editor.state.selection.constructor as unknown as { create: (doc: unknown, pos: number) => never };
        const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)).setMeta('appendDoc', true);
        editor.view.dispatch(tr);
      });

      // The root only moved the selection, so it is not a document-changing transaction itself:
      // the wrapper reports the move, then the change the plugin appended.
      const observed = await observe(page);
      expect(observed).toMatchObject({ state: 'Hello!', dom: 'Hello!', transactions: 0, updates: 1, calls: ['selection', 'update'] });
      if (framework === 'angular') expect(observed.form).toEqual({ dirty: true, value: '<p>Hello!</p>', signal: '<p>Hello!</p>' });
    });

    test('a click that TrailingNode answers with a paragraph reaches the selection callback, then the update callback', async ({ page }) => {
      // The editor starts from this document: any earlier transaction would add the paragraph.
      await open(page, framework, { 'trailing-node': 'on', 'angular-form': '0' });
      expect(await page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.getHTML()))
        .toBe('<p>intro text</p><h2>Last</h2>');
      await page.evaluate(() => { (window as unknown as ProbeWindow).__pasteCleanup.clearObservations(); });

      await page.locator('.ProseMirror p').first().click();

      const observed = await observe(page);
      expect(observed.html).toBe('<p>intro text</p><h2>Last</h2><p></p>');
      expect(observed.calls.slice(0, 2)).toEqual(['selection', 'update']);
      expect(observed.calls.filter(call => call === 'update')).toHaveLength(1);
    });

    test('commands return true under a veto and leave editor.state the same object', async ({ page }) => {
      await open(page, framework, { limit: '5' });
      await seed(page, '<p>Start</p>', 'end');

      const result = await page.evaluate(() => {
        const { editor } = (window as unknown as ProbeWindow).__pasteCleanup;
        const before = editor.state;
        const returns = [
          editor.commands.insertContent('XYZ'),
          editor.chain().insertContent('XYZ').run(),
          editor.commands.setContent('<p>Too long text</p>'),
        ];
        return { returns, same: editor.state === before, text: editor.state.doc.textContent };
      });
      expect(result).toEqual({ returns: [true, true, true], same: true, text: 'Start' });
      expect(await observe(page)).toMatchObject({ transactions: 0, updates: 0, calls: [] });
    });

    test('a vetoed IME composition changes nothing and reaches no callback (Chromium)', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'IME input is automated only through the Chrome DevTools Protocol');
      await open(page, framework, { limit: '5' });
      await seed(page, '<p>Start</p>', 'end');

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: '漢' });
      // ProseMirror keeps view.composing set after a composition whose change was vetoed, in
      // plain ProseMirror as well, so settle on time instead of on that flag.
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 150)));

      let observed = await observe(page);
      expect(observed).toMatchObject({ state: 'Start', dom: 'Start', transactions: 0, updates: 0, calls: [] });
      if (framework === 'angular') expect(observed.form).toMatchObject({ dirty: false });

      // Editing goes on: a deletion and the key it makes room for are accepted, the DOM follows.
      await page.keyboard.press('Backspace');
      await page.keyboard.type('Z');
      observed = await observe(page);
      expect(observed).toMatchObject({ state: 'StarZ', dom: 'StarZ', transactions: 2, updates: 2, calls: ['update', 'update'] });
    });

    test('an accepted IME composition updates once per accepted transaction (Chromium)', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'IME input is automated only through the Chrome DevTools Protocol');
      await open(page, framework, { limit: '100' });
      await seed(page, '<p>Start</p>', 'end');

      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
      await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: '漢' });
      await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__pasteCleanup.editor.state.doc.textContent)).toBe('Start漢');

      const observed = await observe(page);
      expect(observed.dom).toBe('Start漢');
      expect(observed.updates).toBe(observed.transactions);
      expect(observed.calls).toEqual(Array.from({ length: observed.updates }, () => 'update'));
    });
  });
}
