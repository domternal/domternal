/**
 * E2E coverage for the SmartPaste extension.
 *
 * Bug: pasting block-level content (heading, codeBlock, blockquote, hr)
 * at an INLINE caret position (anywhere inside a textblock) made PM's
 * default content fitter strip the wrapper and paste only inline text.
 * Most visible trigger: copy a heading, click into a list item, press
 * Shift+Enter to create a hardBreak, paste — heading lost its level.
 *
 * SmartPaste detects this case (closed slice + non-paragraph block)
 * and either inserts before / after the parent textblock or splits
 * the textblock at the cursor and inserts the block(s) between the
 * two halves.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await page.waitForTimeout(150);
}

/**
 * Dispatch a synthetic `paste` event on `view.dom` carrying `html` in
 * the DataTransfer. PM's pipeline parses the html into a Slice and feeds
 * it to handlePaste — exercising SmartPaste end-to-end.
 */
async function pasteHtml(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { view: { dom: HTMLElement } }
      | undefined;
    if (!ed) return;
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ed.view.dom.dispatchEvent(ev);
  }, html);
  await page.waitForTimeout(120);
}

interface TopBlock { type: string; text: string }

/**
 * Place the caret at an EXACT (paragraph text content) offset inside the
 * first paragraph whose textContent matches `text`. Avoids cross-browser
 * flakiness from `click + Home + ArrowRight*N` (in list items, list
 * bullet labels can intercept clicks).
 */
async function setCaretInParagraph(page: Page, text: string, offset: number): Promise<void> {
  await page.evaluate(({ text, offset }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void };
            tr: { setSelection: (s: unknown) => unknown };
          };
          view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, anchor: number, head?: number) => unknown } } }; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === text) { pos = p; return false; }
      return true;
    });
    if (pos === -1) return;
    const TextSelectionCls = ed.view.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(
      TextSelectionCls.create(
        (ed.state.doc as unknown),
        pos + 1 + offset,
      ),
    );
    ed.view.dispatch(tr);
    ed.view.focus();
  }, { text, offset });
  await page.waitForTimeout(50);
}

/**
 * Place the caret at an exact range selection inside a paragraph.
 */
async function setSelectionInParagraph(page: Page, text: string, from: number, to: number): Promise<void> {
  await page.evaluate(({ text, from, to }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } };
          view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number, h?: number) => unknown } } }; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === text) { pos = p; return false; }
      return true;
    });
    if (pos === -1) return;
    const TextSelectionCls = ed.view.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(
      TextSelectionCls.create((ed.state.doc as unknown), pos + 1 + from, pos + 1 + to),
    );
    ed.view.dispatch(tr);
    ed.view.focus();
  }, { text, from, to });
  await page.waitForTimeout(50);
}

async function topBlocks(page: Page): Promise<TopBlock[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
      | undefined;
    const out: TopBlock[] = [];
    ed?.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
    return out;
  });
}

test.describe('SmartPaste', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // ── Original user-reported scenario ──

  test('paste H1 in list item AFTER Shift+Enter → heading preserved as new block in same list item', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await page.locator(`${editorSelector} li p`, { hasText: 'Existing' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);

    await pasteHtml(page, '<h1>Big title</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { type: { name: string }; textContent: string } | null; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstType: li?.firstChild?.type.name,
        firstText: li?.firstChild?.textContent,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
        lastLevel: li?.lastChild?.attrs['level'],
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstType: 'paragraph',
      firstText: 'Existing',
      lastType: 'heading',
      lastText: 'Big title',
      lastLevel: 1,
    });
  });

  // ── Cursor position branches ──

  test('paste H1 at END of paragraph → heading inserted as next top-level block', async ({ page }) => {
    await setContent(page, '<p>Above</p>');
    await setCaretInParagraph(page, 'Above', 'Above'.length);
    await pasteHtml(page, '<h1>Title</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'heading', text: 'Title' },
    ]);
  });

  test('paste H1 at START of paragraph → heading inserted as previous top-level block', async ({ page }) => {
    await setContent(page, '<p>Below</p>');
    await setCaretInParagraph(page, 'Below', 0);
    await pasteHtml(page, '<h1>Title</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'heading', text: 'Title' },
      { type: 'paragraph', text: 'Below' },
    ]);
  });

  test('paste H1 in MIDDLE of paragraph text → splits paragraph, heading between halves', async ({ page }) => {
    await setContent(page, '<p>Hello world</p>');
    await setCaretInParagraph(page, 'Hello world', 5); // after "Hello"
    await pasteHtml(page, '<h1>BREAK</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'BREAK' },
      { type: 'paragraph', text: ' world' },
    ]);
  });

  // ── Different block types ──

  test('paste codeBlock at end of paragraph → preserved with content', async ({ page }) => {
    await setContent(page, '<p>Above</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<pre><code>const x = 1;</code></pre>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'codeBlock', text: 'const x = 1;' },
    ]);
  });

  test('paste blockquote at end of paragraph → preserved', async ({ page }) => {
    await setContent(page, '<p>Above</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<blockquote><p>Quoted</p></blockquote>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'blockquote', text: 'Quoted' },
    ]);
  });

  test('paste hr at middle of paragraph → splits, hr inserted', async ({ page }) => {
    await setContent(page, '<p>Hello world</p>');
    await setCaretInParagraph(page, 'Hello world', 5);
    await pasteHtml(page, '<hr>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'horizontalRule', text: '' },
      { type: 'paragraph', text: ' world' },
    ]);
  });

  // ── Default-paste preservation (regression) ──

  test('paste paragraph-only content at end of paragraph → text MERGED via PM default (no smart split)', async ({ page }) => {
    // PM normalises trailing whitespace in setContent, so we use HOME +
    // 0 right-arrows to land at start, then test merge by typing.
    // Cleaner: pre-existing text is "Hello"; pasted is "world"; expected
    // merge result is "Helloworld" (no auto-space — that's PM default).
    await setContent(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<p>world</p>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Helloworld' },
    ]);
  });

  test('paste plain text → merged inline (no smart split)', async ({ page }) => {
    await setContent(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, 'world');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Helloworld' },
    ]);
  });

  test('paste paragraph + heading mix at end of paragraph → smart split fires (non-paragraph block present)', async ({ page }) => {
    await setContent(page, '<p>Above</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<p>Mid</p><h2>Heading</h2>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'paragraph', text: 'Mid' },
      { type: 'heading', text: 'Heading' },
    ]);
  });

  // ── List item context ──

  test('paste H2 at end of paragraph in list item → heading appended as second child of same list item', async ({ page }) => {
    await setContent(page, '<ul><li><p>Item</p></li></ul>');
    await page.locator(`${editorSelector} li p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<h2>Sub heading</h2>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        lastType: li?.lastChild?.type.name,
        lastLevel: li?.lastChild?.attrs['level'],
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      lastType: 'heading',
      lastLevel: 2,
      lastText: 'Sub heading',
    });
  });

  test('paste H1 in middle of text in list item → splits paragraph inside listItem, heading between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>Hello world</p></li></ul>');
    await setCaretInParagraph(page, 'Hello world', 5);
    await pasteHtml(page, '<h1>SPLIT</h1>');

    // listItem's content rule is `block+`, so split-and-insert here yields
    // [p"Hello", h1"SPLIT", p" world"] all inside the same listItem.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const out: { type: string; text: string }[] = [];
      for (let i = 0; i < (li?.childCount ?? 0); i++) {
        const c = li?.child(i);
        if (c) out.push({ type: c.type.name, text: c.textContent });
      }
      return out;
    });
    expect(tree).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'SPLIT' },
      { type: 'paragraph', text: ' world' },
    ]);
  });

  // ── Range selection ──

  test('paste H1 over a non-empty selection range → range deleted, then split + insert', async ({ page }) => {
    await setContent(page, '<p>HelloXXXworld</p>');
    // Select "XXX" (offsets 5..8 inside "HelloXXXworld").
    await setSelectionInParagraph(page, 'HelloXXXworld', 5, 8);
    await pasteHtml(page, '<h1>BREAK</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'BREAK' },
      { type: 'paragraph', text: 'world' },
    ]);
  });

  // ── Heading attrs preservation ──

  test('paste H3 → heading level 3 preserved (not demoted to plain paragraph)', async ({ page }) => {
    await setContent(page, '<p>Above</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<h3>Section</h3>');

    const heading = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { lastChild: { type: { name: string }; attrs: Record<string, unknown>; textContent: string } | null } } }
        | undefined;
      const last = ed?.state.doc.lastChild;
      return { type: last?.type.name, level: last?.attrs['level'], text: last?.textContent };
    });
    expect(heading).toEqual({ type: 'heading', level: 3, text: 'Section' });
  });
});
