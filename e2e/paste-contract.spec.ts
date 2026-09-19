/**
 * Paste transaction contracts across the four framework demos.
 *
 * These tests dispatch synthetic ClipboardEvents through the editor DOM. They
 * exercise ProseMirror parsing and paste handlers, not the operating system's
 * clipboard or clipboard payloads captured from an Office application.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import type { Editor, TransactionEventProps } from '@domternal/core';
import { demoTargets, type DemoTarget } from './targets.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const PNG_URL = `data:image/png;base64,${PNG_BASE64}`;

interface EditorSnapshot {
  doc: unknown;
  selection: unknown;
}

interface PasteTransaction {
  paste: unknown;
  uiEvent: unknown;
}

interface PastePayload {
  text: string;
  html?: string;
  imageBase64?: string;
}

type SeedSelection = 'all' | { text: string; offset: number };

async function openNotionDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    undefined,
    { timeout: 5000 },
  );
}

/** Seed outside history and place the selection without pointer hit testing. */
async function seed(page: Page, html: string, selection: SeedSelection): Promise<void> {
  await page.evaluate(({ markup, selection }) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | Editor
      | undefined;
    if (!editor) throw new Error('__DEMO_EDITOR__ not found');
    if (!editor.setContent(markup, false)) throw new Error('Could not seed the document');
    if (selection === 'all') {
      editor.commands.focus('all');
      return;
    }

    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.isTextblock && node.textContent === selection.text) {
        if (selection.offset < 0 || selection.offset > node.content.size) {
          throw new Error('The seed selection is outside its text block');
        }
        position = pos + 1 + selection.offset;
      }
    });
    if (position === undefined) throw new Error('The seed text block was not found');
    editor.commands.focus(position);
  }, { markup: html, selection });
}

function snapshot(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | Editor
      | undefined;
    if (!editor) throw new Error('__DEMO_EDITOR__ not found');
    return {
      doc: editor.getJSON(),
      selection: editor.state.selection.toJSON() as unknown,
    };
  });
}

/** Observe only the paste dispatch, excluding setup, focus and history commands. */
async function paste(page: Page, target: DemoTarget, payload: PastePayload): Promise<void> {
  const result = await page.evaluate(({ selector, payload }) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | Editor
      | undefined;
    const element = document.querySelector(selector);
    if (!editor || !element) throw new Error('The editor is not mounted');

    const data = new DataTransfer();
    data.setData('text/plain', payload.text);
    if (payload.html !== undefined) data.setData('text/html', payload.html);
    if (payload.imageBase64 !== undefined) {
      const bytes = Uint8Array.from(atob(payload.imageBase64), (character) => character.charCodeAt(0));
      data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    }

    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    // Firefox may replace constructor-supplied data with an empty clipboard.
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });

    const transactions: PasteTransaction[] = [];
    const record = ({ transaction }: TransactionEventProps): void => {
      if (transaction.docChanged) {
        transactions.push({
          paste: transaction.getMeta('paste') as unknown,
          uiEvent: transaction.getMeta('uiEvent') as unknown,
        });
      }
    };
    editor.on('transaction', record);
    try {
      element.dispatchEvent(event);
    } finally {
      editor.off('transaction', record);
    }
    return {
      isTrusted: event.isTrusted,
      prevented: event.defaultPrevented,
      transactions,
    };
  }, { selector: target.editorSelector, payload });

  expect(result.isTrusted, 'the fixture uses a synthetic clipboard event').toBe(false);
  expect(result.prevented, 'the editor handled the paste').toBe(true);
  expect(result.transactions, 'one content transaction carries both paste markers').toEqual([
    { paste: true, uiEvent: 'paste' },
  ]);
}

async function expectCaretAtEnd(page: Page, text: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | Editor
      | undefined;
    if (!editor) throw new Error('__DEMO_EDITOR__ not found');
    const { selection } = editor.state;
    return {
      empty: selection.empty,
      text: selection.$from.parent.textContent,
      offset: selection.$from.parentOffset,
    };
  })).toEqual({ empty: true, text, offset: text.length });
}

/** One keyboard Undo and Redo restore the entire document and selection. */
async function expectHistoryRoundTrip(page: Page, before: EditorSnapshot): Promise<void> {
  const after = await snapshot(page);
  expect(after.doc).not.toEqual(before.doc);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => snapshot(page)).toEqual(before);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => snapshot(page)).toEqual(after);
}

for (const target of demoTargets) {
  test.describe(`${target.name} synthetic paste contract`, () => {
    test.beforeEach(async ({ page }) => {
      await openNotionDemo(page, target);
    });

    test('same-kind list paste keeps siblings, caret and history', async ({ page }) => {
      await seed(page, '<ul><li><p>before</p></li><li><p>after</p></li></ul>', {
        text: 'before', offset: 6,
      });
      const before = await snapshot(page);
      await paste(page, target, {
        text: 'alpha\nbeta',
        html: '<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>',
      });

      const editor = page.locator(target.editorSelector);
      await expect(editor.locator(':scope > ul')).toHaveCount(1);
      await expect(editor.locator('li')).toHaveText(['before', 'alpha', 'beta', 'after']);
      await expectCaretAtEnd(page, 'beta');
      await expectHistoryRoundTrip(page, before);
    });

    test('different-kind list paste preserves the ordered start and splits its host', async ({ page }) => {
      await seed(page, '<ul><li><p>before</p></li><li><p>after</p></li></ul>', {
        text: 'before', offset: 6,
      });
      const before = await snapshot(page);
      await paste(page, target, {
        text: 'alpha\nbeta',
        html: '<ol start="7"><li><p>alpha</p></li><li><p>beta</p></li></ol>',
      });

      const editor = page.locator(target.editorSelector);
      await expect(editor.locator(':scope > ul')).toHaveText(['before', 'after']);
      await expect(editor.locator(':scope > ol')).toHaveAttribute('start', '7');
      await expect(editor.locator(':scope > ol li')).toHaveText(['alpha', 'beta']);
      await expect(editor.locator(':scope > *')).toHaveText(['before', 'alphabeta', 'after']);
      await expectCaretAtEnd(page, 'beta');
      await expectHistoryRoundTrip(page, before);
    });

    test('a list whose first item starts with a nested list pastes as one list under an empty item', async ({ page }) => {
      await seed(page, '<p></p>', { text: '', offset: 0 });
      const before = await snapshot(page);
      // A browser copies this when a selection starts inside a nested item and ends in the next one.
      await paste(page, target, {
        text: 'nested item\ntop item',
        html: '<ul><li><ul><li>nested item</li></ul></li><li>top item</li></ul>',
      });

      expect(await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as Editor | undefined;
        if (!editor) throw new Error('__DEMO_EDITOR__ not found');
        editor.state.doc.check();
        return editor.state.doc.toString();
      })).toBe('doc(bulletList(listItem(paragraph, bulletList(listItem(paragraph("nested item")))), listItem(paragraph("top item"))))');
      await expectCaretAtEnd(page, 'top item');
      await expectHistoryRoundTrip(page, before);
    });

    test('heading paste splits the destination paragraph and restores its original caret', async ({ page }) => {
      await seed(page, '<p>beforeafter</p>', { text: 'beforeafter', offset: 6 });
      const before = await snapshot(page);
      await paste(page, target, { text: 'Pasted heading', html: '<h2>Pasted heading</h2>' });

      const editor = page.locator(target.editorSelector);
      await expect(editor.locator(':scope > p')).toHaveText(['before', 'after']);
      await expect(editor.locator(':scope > h2')).toHaveText('Pasted heading');
      await expect(editor.locator(':scope > *')).toHaveText(['before', 'Pasted heading', 'after']);
      await expectCaretAtEnd(page, 'Pasted heading');
      await expectHistoryRoundTrip(page, before);
    });

    test('Markdown paste replaces a selection and restores it with one undo', async ({ page }) => {
      await seed(page, '<p>Replace this paragraph</p>', 'all');
      const before = await snapshot(page);
      await paste(page, target, { text: '# Contract title\n\n- alpha\n- beta' });

      const editor = page.locator(target.editorSelector);
      await expect(editor.locator(':scope > h1')).toHaveText('Contract title');
      await expect(editor.locator(':scope > ul li')).toHaveText(['alpha', 'beta']);
      await expect(editor).not.toContainText('Replace this paragraph');
      await expectCaretAtEnd(page, 'beta');
      await expectHistoryRoundTrip(page, before);
    });

    test('rich HTML with an image File keeps text and inserts the image once', async ({ page }) => {
      await seed(page, '<p></p>', { text: '', offset: 0 });
      const before = await snapshot(page);
      await paste(page, target, {
        text: 'Rich clipboard text',
        html: `<p>Rich <strong>clipboard</strong> text</p><img src="${PNG_URL}" alt="Clipboard image">`,
        imageBase64: PNG_BASE64,
      });

      const editor = page.locator(target.editorSelector);
      await expect(editor.locator('p')).toHaveText('Rich clipboard text');
      await expect(editor.locator('strong')).toHaveText('clipboard');
      await expect(editor.locator('img')).toHaveCount(1);
      await expect(editor.locator('img')).toHaveAttribute('src', PNG_URL);
      await expect(editor.locator('img')).toHaveAttribute('alt', 'Clipboard image');
      await expectHistoryRoundTrip(page, before);
    });
  });
}
