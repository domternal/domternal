/**
 * E2E coverage for the SmartPaste extension.
 *
 * Bug: pasting block-level content (heading, codeBlock, blockquote, hr)
 * at an INLINE caret position (anywhere inside a textblock) made PM's
 * default content fitter strip the wrapper and paste only inline text.
 * Most visible trigger: copy a heading, click into a list item, press
 * Shift+Enter to create a hardBreak, paste - heading lost its level.
 *
 * SmartPaste detects this case (closed slice + non-paragraph block)
 * and either inserts before / after the parent textblock or splits
 * the textblock at the cursor and inserts the block(s) between the
 * two halves.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.app-notion-demo .ProseMirror';
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
 * it to handlePaste - exercising SmartPaste end-to-end.
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

interface ListItemChild { type: string; text: string; level?: number }

/**
 * Returns the children of the FIRST list item in the doc as
 * `{ type, text, level? }` records. Walks `doc.firstChild` (= the list
 * wrapper) → `firstChild` (= the list item) and unrolls its direct
 * children. Used heavily by the "paste in middle of list item" matrix.
 */
async function firstListItemChildren(page: Page): Promise<ListItemChild[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
      | undefined;
    const li = ed?.state.doc.firstChild?.firstChild;
    const out: ListItemChild[] = [];
    for (let i = 0; i < (li?.childCount ?? 0); i++) {
      const c = li?.child(i);
      if (!c) continue;
      const rec: ListItemChild = { type: c.type.name, text: c.textContent };
      if (c.type.name === 'heading') rec.level = c.attrs['level'] as number;
      out.push(rec);
    }
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
    // merge result is "Helloworld" (no auto-space - that's PM default).
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

    // listItem's content rule is `paragraph block*` - the first child must
    // remain a paragraph, but trailing children can be any block. Split-and-
    // insert at offset 5 yields [p"Hello", h1"SPLIT", p" world"] all inside
    // the same listItem; first child is still a paragraph so schema accepts.
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

  // ── Paste block content in MIDDLE of list-item paragraph ──
  // Comprehensive matrix locking down the user-reported scenario:
  // caret between chars of a list-item label paragraph, paste a non-paragraph
  // block. Expected for ALL cases: SmartPaste's middle-of-text branch splits
  // the label paragraph at the cursor and inserts the pasted block(s) BETWEEN
  // the two halves, ALL inside the same listItem. Schema (`paragraph block*`)
  // accepts: first child stays a paragraph, trailing children fit `block*`.

  test('user-reported: paste H1 between chars 4 and 5 of "123456789" inside bullet list item', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4); // between "4" and "5"
    await pasteHtml(page, '<h1>Naslov</h1>');

    // Doc invariant: still a single top-level block (the bulletList).
    expect(await topBlocks(page)).toEqual([
      { type: 'bulletList', text: '1234Naslov56789' },
    ]);
    // listItem invariant: 3 children, first is the paragraph "1234".
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'heading', text: 'Naslov', level: 1 },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('paste H1 between 4 and 5 of "123456789" inside ORDERED list item → same shape, listItem inside ol', async ({ page }) => {
    await setContent(page, '<ol><li><p>123456789</p></li></ol>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>Naslov</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'orderedList', text: '1234Naslov56789' },
    ]);
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'heading', text: 'Naslov', level: 1 },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('paste H1 between 4 and 5 of "123456789" inside TASK item → same shape, taskItem inside taskList', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem"><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>Naslov</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'taskList', text: '1234Naslov56789' },
    ]);
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'heading', text: 'Naslov', level: 1 },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('heading levels 2-4 each preserve attrs through middle-of-listItem split', async ({ page }) => {
    // Default Heading config exposes levels [1, 2, 3, 4]; levels 5/6 are
    // NOT registered so PM's parser would demote `<h5>`/`<h6>` to paragraph.
    for (const level of [2, 3, 4] as const) {
      await setContent(page, '<ul><li><p>123456789</p></li></ul>');
      await setCaretInParagraph(page, '123456789', 4);
      await pasteHtml(page, `<h${level}>L${level}</h${level}>`);
      expect(await firstListItemChildren(page)).toEqual([
        { type: 'paragraph', text: '1234' },
        { type: 'heading', text: `L${level}`, level },
        { type: 'paragraph', text: '56789' },
      ]);
    }
  });

  test('paste codeBlock in middle of listItem paragraph → split, codeBlock between halves, language preserved', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<pre><code class="language-typescript">const x = 1;</code></pre>');

    const result = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        count: li?.childCount,
        first: li?.child(0)?.type.name,
        firstText: li?.child(0)?.textContent,
        middle: li?.child(1)?.type.name,
        middleText: li?.child(1)?.textContent,
        middleLang: li?.child(1)?.attrs['language'],
        last: li?.child(2)?.type.name,
        lastText: li?.child(2)?.textContent,
      };
    });
    expect(result).toEqual({
      count: 3,
      first: 'paragraph',
      firstText: '1234',
      middle: 'codeBlock',
      middleText: 'const x = 1;',
      middleLang: 'typescript',
      last: 'paragraph',
      lastText: '56789',
    });
  });

  test('paste blockquote in middle of listItem paragraph → split, blockquote between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<blockquote><p>Quoted</p></blockquote>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'blockquote', text: 'Quoted' },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('paste hr (atom) in middle of listItem paragraph → split, hr between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<hr>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'horizontalRule', text: '' },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('paste mixed paragraph + heading in middle of listItem paragraph → both inserted between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<p>Mid</p><h2>Title</h2>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'paragraph', text: 'Mid' },
      { type: 'heading', text: 'Title', level: 2 },
      { type: 'paragraph', text: '56789' },
    ]);
  });

  test('caret at offset 1 of "123456789" → split at offset 1 (paragraphs "1" and "23456789")', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 1);
    await pasteHtml(page, '<h1>X</h1>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1' },
      { type: 'heading', text: 'X', level: 1 },
      { type: 'paragraph', text: '23456789' },
    ]);
  });

  test('caret at offset 8 of "123456789" → split at offset 8 (paragraphs "12345678" and "9")', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 8);
    await pasteHtml(page, '<h1>X</h1>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '12345678' },
      { type: 'heading', text: 'X', level: 1 },
      { type: 'paragraph', text: '9' },
    ]);
  });

  test('listItem with EXISTING nested heading + paste H1 in middle of label → label split, h1 inserted between halves, EXISTING heading preserved as trailing child', async ({ page }) => {
    // Initial: listItem has [p"123456789", h2"Existing"]
    await setContent(page, '<ul><li><p>123456789</p><h2>Existing</h2></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>Naslov</h1>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'heading', text: 'Naslov', level: 1 },
      { type: 'paragraph', text: '56789' },
      { type: 'heading', text: 'Existing', level: 2 },
    ]);
  });

  test('range selection over chars 3-6 of "123456789" + paste H1 → range deleted, split, h1 between halves', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setSelectionInParagraph(page, '123456789', 3, 6); // covers "456"
    await pasteHtml(page, '<h1>Naslov</h1>');

    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '123' },
      { type: 'heading', text: 'Naslov', level: 1 },
      { type: 'paragraph', text: '789' },
    ]);
  });

  test('paste H1 in middle of listItem with BOLD text → bold mark preserved on both halves', async ({ page }) => {
    await setContent(page, '<ul><li><p><strong>123456789</strong></p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>X</h1>');

    // Verify both paragraph halves still carry the bold mark.
    const marksByChild = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; firstChild: { marks: { type: { name: string } }[] } | null } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const out: { type: string; firstMark: string | null }[] = [];
      for (let i = 0; i < (li?.childCount ?? 0); i++) {
        const c = li?.child(i);
        if (!c) continue;
        out.push({ type: c.type.name, firstMark: c.firstChild?.marks?.[0]?.type.name ?? null });
      }
      return out;
    });
    expect(marksByChild).toEqual([
      { type: 'paragraph', firstMark: 'bold' },
      { type: 'heading', firstMark: null },
      { type: 'paragraph', firstMark: 'bold' },
    ]);
  });

  test('after paste in middle of listItem, undo restores original "123456789" paragraph', async ({ page }) => {
    await setContent(page, '<ul><li><p>123456789</p></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>Naslov</h1>');

    // Confirm split happened.
    expect((await firstListItemChildren(page)).length).toBe(3);

    // Mac uses Meta+z, others use Ctrl+z (matches existing undo tests in
    // this file).
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(80);

    // Original shape: single listItem with single paragraph child.
    expect(await firstListItemChildren(page)).toEqual([
      { type: 'paragraph', text: '123456789' },
    ]);
  });

  test('paste H1 between 4 and 5 in NESTED bullet listItem (depth-2) → only the inner item splits, outer item untouched', async ({ page }) => {
    // Outer list with one item; inside that item, a nested bullet list with
    // its own item containing "123456789". Paste H1 in the nested item's
    // middle. The nested listItem splits; the outer listItem keeps its
    // structure (label "Outer" + nested ul).
    await setContent(page, '<ul><li><p>Outer</p><ul><li><p>123456789</p></li></ul></li></ul>');
    await setCaretInParagraph(page, '123456789', 4);
    await pasteHtml(page, '<h1>Naslov</h1>');

    const result = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string; firstChild: { textContent: string } | null; childCount: number; child: (i: number) => unknown } | null } | null } | null } } }
        | undefined;
      const outerLi = ed?.state.doc.firstChild?.firstChild;
      const outerLabel = outerLi?.child(0)?.textContent;
      const nestedUl = outerLi?.child(1) as { childCount: number; child: (i: number) => { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; textContent: string; attrs: Record<string, unknown> } } } | undefined;
      const nestedLi = nestedUl?.child(0);
      const nestedChildren: { type: string; text: string }[] = [];
      for (let i = 0; i < (nestedLi?.childCount ?? 0); i++) {
        const c = nestedLi?.child(i);
        nestedChildren.push({ type: c?.type.name ?? '', text: c?.textContent ?? '' });
      }
      return { outerLabel, outerChildCount: outerLi?.childCount, nestedChildren };
    });
    expect(result.outerLabel).toBe('Outer');
    expect(result.outerChildCount).toBe(2); // [label, nested ul]
    expect(result.nestedChildren).toEqual([
      { type: 'paragraph', text: '1234' },
      { type: 'heading', text: 'Naslov' },
      { type: 'paragraph', text: '56789' },
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

  // ── Empty / hardBreak-only paragraph in list item ──
  // Bug: pasting a heading into an EMPTY paragraph inside a list item
  // used to insert the heading BEFORE the paragraph (per the offset===0
  // branch), leaving an empty trailing `<p>` that broke Enter handling.
  // Fix: replace the empty parent with the slice content so the listItem
  // ends up with exactly the inserted block(s) - no stray empty p.

  test('paste H1 in EMPTY paragraph inside list item → empty p replaced (no trailing paragraph)', async ({ page }) => {
    // Two-item list, second is empty. Caret in second (empty) item.
    await setContent(page, '<ul><li><p>Existing</p></li><li><p></p></li></ul>');
    // Caret in the empty paragraph (second list item).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; childCount: number }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      let count = 0;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph') { count += 1; if (count === 2) { pos = p; return false; } }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1)));
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>Big title</h1>');

    // Notion-strict: listItem requires paragraph as first child, so the
    // empty-replace branch can't fully replace the empty p with a heading.
    // PM's content fitter re-injects an empty paragraph as the label
    // slot; the heading lands as the second child.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; lastChild: { type: { name: string }; childCount: number; firstChild: { type: { name: string }; textContent: string } | null; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const secondLi = ul?.lastChild;
      return {
        ulChildCount: ul?.childCount,
        secondLiChildCount: secondLi?.childCount,
        secondLiLabelType: secondLi?.firstChild?.type.name,
        secondLiLabelText: secondLi?.firstChild?.textContent,
        secondLiContentType: secondLi?.lastChild?.type.name,
        secondLiContentText: secondLi?.lastChild?.textContent,
        secondLiContentLevel: secondLi?.lastChild?.attrs['level'],
      };
    });
    expect(tree).toEqual({
      ulChildCount: 2,
      secondLiChildCount: 2,
      secondLiLabelType: 'paragraph',
      secondLiLabelText: '',
      secondLiContentType: 'heading',
      secondLiContentText: 'Big title',
      secondLiContentLevel: 1,
    });
  });

  test('paste H1 in EMPTY top-level paragraph → empty p replaced by heading', async ({ page }) => {
    await setContent(page, '<p>Above</p><p></p>');
    // Caret in the empty trailing paragraph.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph' && n.textContent === '') { pos = p; return false; }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1)));
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>Title</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'heading', text: 'Title' },
    ]);
  });

  // ── Trailing hardBreak (Shift+Enter) ──
  // User model: Shift+Enter creates a NEW logical row where the cursor
  // sits, paste fills THAT row. The trailing hardBreak that produced
  // the visual empty row is consumed by the paste - no stray empty row
  // appears either above or below the inserted block.
  //
  // - `<p><br>|</p>` (empty + Shift+Enter) → `<p></p>` + `<heading>` -
  //   the empty first row remains, heading lands in the new row below.
  // - `<p>Text<br>|</p>` (text + Shift+Enter) → `<p>Text</p>` + `<heading>`
  //   - text and heading are adjacent, NO extra empty row in between.

  test('paste H1 in EMPTY paragraph + Shift+Enter inside list item → empty row PRESERVED, heading as sibling', async ({ page }) => {
    // Bug: previously the whole `<p><br></p>` was replaced by the heading,
    // so the empty row the user explicitly created with Shift+Enter was lost.
    await setContent(page, '<ul><li><p>Existing</p></li><li><p></p></li></ul>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      let count = 0;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph') { count += 1; if (count === 2) { pos = p; return false; } }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1)));
      ed.view.focus();
    });
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; lastChild: { childCount: number; firstChild: { type: { name: string }; textContent: string; childCount: number } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const secondLi = ul?.lastChild;
      return {
        ulChildCount: ul?.childCount,
        secondLiChildCount: secondLi?.childCount,
        secondLiFirstType: secondLi?.firstChild?.type.name,
        secondLiFirstText: secondLi?.firstChild?.textContent,
        secondLiFirstInlineChildren: secondLi?.firstChild?.childCount,
        secondLiLastType: secondLi?.lastChild?.type.name,
        secondLiLastText: secondLi?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      ulChildCount: 2,
      secondLiChildCount: 2,
      secondLiFirstType: 'paragraph',
      secondLiFirstText: '',
      secondLiFirstInlineChildren: 0, // hardBreak trimmed
      secondLiLastType: 'heading',
      secondLiLastText: 'Heading',
    });
  });

  test('paste H1 in TEXT paragraph + Shift+Enter inside list item → text PRESERVED, heading as sibling, no extra empty row', async ({ page }) => {
    // Bug #2: previously `<p>Existing<br></p><h1>Heading</h1>` left the
    // trailing hardBreak in the paragraph, rendering as 3 visual rows
    // (text / empty / heading). Fix: trim trailing hb so it's 2 rows
    // (text / heading) - the new logical row from Shift+Enter is filled
    // by the heading itself.
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await page.locator(`${editorSelector} li p`, { hasText: 'Existing' }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { type: { name: string }; textContent: string; childCount: number } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstType: li?.firstChild?.type.name,
        firstText: li?.firstChild?.textContent,
        firstInlineChildren: li?.firstChild?.childCount, // 1 = single text node, no trailing hardBreak
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstType: 'paragraph',
      firstText: 'Existing',
      firstInlineChildren: 1, // ONLY the text node - no trailing hardBreak
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  test('paste H1 in EMPTY top-level paragraph + Shift+Enter → empty row PRESERVED, heading as next sibling', async ({ page }) => {
    await setContent(page, '<p>Above</p><p></p>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph' && n.textContent === '') { pos = p; return false; }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1)));
      ed.view.focus();
    });
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Above' },
      { type: 'paragraph', text: '' }, // the explicit empty row is preserved
      { type: 'heading', text: 'Heading' },
    ]);
  });

  test('paste H1 in TEXT top-level paragraph + Shift+Enter → text PRESERVED, heading as sibling, no extra empty row', async ({ page }) => {
    await setContent(page, '<p>Hello</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    // No empty row in between: paragraph is "Hello" (one text node, no
    // trailing hardBreak), heading follows as sibling.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } } }
        | undefined;
      return {
        topCount: ed?.state.doc.childCount,
        firstType: ed?.state.doc.firstChild?.type.name,
        firstText: ed?.state.doc.firstChild?.textContent,
        firstInline: ed?.state.doc.firstChild?.childCount,
        lastType: ed?.state.doc.lastChild?.type.name,
        lastText: ed?.state.doc.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 2,
      firstType: 'paragraph',
      firstText: 'Hello',
      firstInline: 1, // ONLY the text node - no trailing hardBreak
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  // ── Cursor position after paste ──
  // After SmartPaste handles a block paste, the caret should land at the
  // END of the LAST inserted block (mirroring Notion / native browser
  // paste behaviour). Otherwise users have to re-position to keep typing.

  test('after paste, caret is at end of inserted heading (top-level paragraph case)', async ({ page }) => {
    await setContent(page, '<p>Hello world</p>');
    await setCaretInParagraph(page, 'Hello world', 5);
    await pasteHtml(page, '<h1>BREAK</h1>');

    // Type a marker char - should land INSIDE the inserted heading, at its end.
    await page.keyboard.type('!');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'BREAK!' },
      { type: 'paragraph', text: ' world' },
    ]);
  });

  test('after paste in empty list-item paragraph, caret is at end of inserted heading', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li><li><p></p></li></ul>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      let count = 0;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph') { count += 1; if (count === 2) { pos = p; return false; } }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1)));
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>Title</h1>');
    // Extra settle tick: when the empty parent is a list-item label,
    // SmartPaste's insert-after path nudges the caret a tick later than
    // the simple replace path. Without this, `keyboard.type` can race
    // ahead of the post-paste selection commit and land mid-text.
    await page.waitForTimeout(50);
    await page.keyboard.type('!');

    // Notion-strict: paste left an empty label paragraph as listItem
    // firstChild and the heading as lastChild; caret should be in the
    // heading so the typed `!` lands there.
    const headingText = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { lastChild: { lastChild: { textContent: string } | null } | null } | null } } }
        | undefined;
      return ed?.state.doc.firstChild?.lastChild?.lastChild?.textContent;
    });
    expect(headingText).toBe('Title!');
  });

  // ── Pasting list slice (bulletList / orderedList / taskList) ──
  // Bug: copying a list item produces a clipboard with a `<ul><li>...</li></ul>`
  // wrapper. SmartPaste's old logic treated `bulletList` as a "non-paragraph
  // block" and inserted it as a sibling INSIDE the current list item - creating
  // a nested list ("dupli bullet item" in user-speak). Fix: when the slice is
  // a single list and the target is inside a list item, merge the slice's
  // items as siblings of the current item.

  test('paste single-item bulletList slice INTO an item of the SAME list type → merged as sibling, no nested list', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    // Caret at end of "Existing"
    await page.locator(`${editorSelector} li p`, { hasText: 'Existing' }).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<ul><li><p>Pasted</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; firstChild: { type: { name: string }; textContent: string } | null; childCount: number } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const items: { type: string; text: string; childCount: number }[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) {
        const li = ul?.child(i);
        if (li) items.push({ type: li.type.name, text: li.firstChild?.textContent ?? '', childCount: li.childCount });
      }
      return {
        topLevelCount: ed?.state.doc.childCount,
        topLevelType: ul?.type.name,
        items,
      };
    });
    // Single bulletList at top level, two listItems, neither has nested list inside.
    expect(tree.topLevelCount).toBe(1);
    expect(tree.topLevelType).toBe('bulletList');
    expect(tree.items).toEqual([
      { type: 'listItem', text: 'Existing', childCount: 1 },
      { type: 'listItem', text: 'Pasted', childCount: 1 },
    ]);
  });

  test('paste single-item bulletList slice at START of a list item → merged as PREVIOUS sibling', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretInParagraph(page, 'Existing', 0);
    await pasteHtml(page, '<ul><li><p>Pasted</p></li></ul>');

    const items = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { firstChild: { textContent: string } | null } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const out: string[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) out.push(ul?.child(i).firstChild?.textContent ?? '');
      return out;
    });
    expect(items).toEqual(['Pasted', 'Existing']);
  });

  test('paste two-item bulletList slice into a list item → both items merged as siblings (no nested list)', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li></ul>');
    await page.locator(`${editorSelector} li p`, { hasText: 'One' }).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<ul><li><p>Two</p></li><li><p>Three</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; firstChild: { textContent: string } | null; childCount: number } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const items: { type: string; text: string; childCount: number }[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) {
        const li = ul?.child(i);
        if (li) items.push({ type: li.type.name, text: li.firstChild?.textContent ?? '', childCount: li.childCount });
      }
      return { topLevelCount: ed?.state.doc.childCount, items };
    });
    expect(tree.topLevelCount).toBe(1);
    expect(tree.items).toEqual([
      { type: 'listItem', text: 'One', childCount: 1 },
      { type: 'listItem', text: 'Two', childCount: 1 },
      { type: 'listItem', text: 'Three', childCount: 1 },
    ]);
  });

  test('paste bulletList slice into a TASK list item → items converted to taskItem siblings', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>');
    await page.locator(`${editorSelector} li p`, { hasText: 'Task' }).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<ul><li><p>Pasted</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; firstChild: { textContent: string } | null } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const items: { type: string; text: string }[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) {
        const li = ul?.child(i);
        if (li) items.push({ type: li.type.name, text: li.firstChild?.textContent ?? '' });
      }
      return { topLevelCount: ed?.state.doc.childCount, topLevelType: ul?.type.name, items };
    });
    expect(tree.topLevelCount).toBe(1);
    expect(tree.topLevelType).toBe('taskList');
    expect(tree.items).toEqual([
      { type: 'taskItem', text: 'Task' },
      { type: 'taskItem', text: 'Pasted' },
    ]);
  });

  test('paste bulletList slice in TOP-LEVEL paragraph context → still inserts a separate list (not absorbed)', async ({ page }) => {
    // When cursor is NOT inside a list, pasting a list slice should keep
    // it as a separate top-level list - NOT skip handling.
    await setContent(page, '<p>Above</p>');
    await page.locator(`${editorSelector} > p`).click();
    await page.keyboard.press('End');
    await pasteHtml(page, '<ul><li><p>Item</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; lastChild: { type: { name: string }; firstChild: { firstChild: { textContent: string } | null } | null } | null } } }
        | undefined;
      const last = ed?.state.doc.lastChild;
      return {
        topLevelCount: ed?.state.doc.childCount,
        lastType: last?.type.name,
        lastFirstItemText: last?.firstChild?.firstChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topLevelCount: 2,
      lastType: 'bulletList',
      lastFirstItemText: 'Item',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// Trailing-hardBreak (Shift+Enter) deep coverage
//
// Shift+Enter on the cursor's textblock leaves a trailing hardBreak in
// the parent paragraph and parks the cursor right after it. SmartPaste
// must trim that trailing break so the pasted block lands as a SIBLING
// after the parent (filling the "new logical row" the user just made),
// without leaving a phantom empty row in the DOM.
//
// This block sweeps the trim path across:
//  • multiple block types (H2/H3/H4, codeBlock, blockquote, hr, list)
//  • multiple list-item contexts (bulletList / orderedList / taskList /
//    nested list-in-list)
//  • content variations (text with marks, multiple hardBreaks)
//  • caret-position variations the trim path MUST NOT trigger on
//    (negative coverage)
//  • after-paste cursor landing (typing should append to the heading)
//  • undo behaviour (one step restores trailing hardBreak)
//  • DOM-level verification (`<br>` count post-paste)
//  • range selection ending exactly at the trailing hardBreak
// ─────────────────────────────────────────────────────────────────────

/**
 * Place the caret right after the trailing hardBreak inside the first
 * paragraph whose textContent matches `text` (or the first empty
 * paragraph if `text === ''`). Skips the click+keyboard dance that
 * occasionally races inside listItems / nested structures.
 */
async function setCaretAtEndOfParagraph(page: Page, text: string): Promise<void> {
  await page.evaluate(({ text }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: {
              descendants: (cb: (n: { type: { name: string }; textContent: string; nodeSize: number }, p: number) => boolean | void) => void;
            };
            tr: { setSelection: (s: unknown) => unknown };
          };
          view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let endPos = -1;
    ed.state.doc.descendants((node, p) => {
      if (endPos !== -1) return false;
      if (node.type.name === 'paragraph' && node.textContent === text) {
        endPos = p + node.nodeSize - 1;
        return false;
      }
      return true;
    });
    if (endPos === -1) return;
    const TS = ed.view.state.selection.constructor;
    ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), endPos)));
    ed.view.focus();
  }, { text });
  await page.waitForTimeout(50);
}

test.describe('SmartPaste - trailing hardBreak (Shift+Enter)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  // ── Block-type matrix in list-item context ──
  // Verifies the trim+sibling path preserves attributes for every
  // non-paragraph block type SmartPaste handles.

  for (const level of [2, 3, 4]) {
    test(`H${level} after Shift+Enter in TEXT list item → text + heading siblings (no extra empty row), level preserved`, async ({ page }) => {
      await setContent(page, '<ul><li><p>Existing</p></li></ul>');
      await setCaretAtEndOfParagraph(page, 'Existing');
      await page.keyboard.press('Shift+Enter');
      await page.waitForTimeout(50);
      await pasteHtml(page, `<h${level}>Heading${level}</h${level}>`);

      const tree = await page.evaluate(() => {
        const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { type: { name: string }; childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
          | undefined;
        const li = ed?.state.doc.firstChild?.firstChild;
        return {
          liChildCount: li?.childCount,
          firstType: li?.firstChild?.type.name,
          firstText: li?.firstChild?.textContent,
          firstInline: li?.firstChild?.childCount,
          lastType: li?.lastChild?.type.name,
          lastText: li?.lastChild?.textContent,
          lastLevel: li?.lastChild?.attrs['level'],
        };
      });
      expect(tree).toEqual({
        liChildCount: 2,
        firstType: 'paragraph',
        firstText: 'Existing',
        firstInline: 1, // text only - no trailing <br>
        lastType: 'heading',
        lastText: `Heading${level}`,
        lastLevel: level,
      });
    });
  }

  test('codeBlock after Shift+Enter in TEXT list item → text + codeBlock siblings, language preserved', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<pre><code class="language-typescript">const x = 1;</code></pre>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string; attrs: Record<string, unknown> } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
        lastLanguage: li?.lastChild?.attrs['language'],
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstText: 'Existing',
      firstInline: 1,
      lastType: 'codeBlock',
      lastText: 'const x = 1;',
      lastLanguage: 'typescript',
    });
  });

  test('blockquote after Shift+Enter in TEXT list item → text + blockquote siblings', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<blockquote><p>Quote text</p></blockquote>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstText: 'Existing',
      firstInline: 1,
      lastType: 'blockquote',
      lastText: 'Quote text',
    });
  });

  test('hr (atom) after Shift+Enter in TEXT list item → text + horizontalRule siblings', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<hr>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string } } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstText: 'Existing',
      firstInline: 1,
      lastType: 'horizontalRule',
    });
  });

  // ── List-context matrix (bulletList / orderedList / taskList / nested) ──

  test('H1 after Shift+Enter in ORDERED list item → text + heading inside same listItem of OL', async ({ page }) => {
    await setContent(page, '<ol><li><p>One</p></li></ol>');
    await setCaretAtEndOfParagraph(page, 'One');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { type: { name: string }; firstChild: { type: { name: string }; childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const ol = ed?.state.doc.firstChild;
      const li = ol?.firstChild;
      return {
        topType: ol?.type.name,
        liType: li?.type.name,
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topType: 'orderedList',
      liType: 'listItem',
      liChildCount: 2,
      firstText: 'One',
      firstInline: 1,
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  test('H1 after Shift+Enter in TASK item → text + heading inside same taskItem', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Task');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { type: { name: string }; firstChild: { type: { name: string }; childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const tl = ed?.state.doc.firstChild;
      const ti = tl?.firstChild;
      return {
        topType: tl?.type.name,
        itemType: ti?.type.name,
        itemChildCount: ti?.childCount,
        firstText: ti?.firstChild?.textContent,
        firstInline: ti?.firstChild?.childCount,
        lastType: ti?.lastChild?.type.name,
        lastText: ti?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topType: 'taskList',
      itemType: 'taskItem',
      itemChildCount: 2,
      firstText: 'Task',
      firstInline: 1,
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  test('H1 after Shift+Enter inside NESTED list item (depth-2) → text + heading siblings inside the inner item', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>',
    );
    await setCaretAtEndOfParagraph(page, 'Inner');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string; childCount: number; firstChild: { type: { name: string }; childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null }, p: number) => boolean | void) => void } } }
        | undefined;
      let inner: { childCount: number; firstType: string; firstText: string; firstInline: number; lastType: string; lastText: string } | null = null;
      ed?.state.doc.descendants((n) => {
        if (inner) return false;
        if (n.type.name === 'listItem' && n.textContent === 'InnerHeading') {
          inner = {
            childCount: n.childCount,
            firstType: n.firstChild?.type.name ?? '',
            firstText: n.firstChild?.textContent ?? '',
            firstInline: n.firstChild?.childCount ?? -1,
            lastType: n.lastChild?.type.name ?? '',
            lastText: n.lastChild?.textContent ?? '',
          };
          return false;
        }
        return true;
      });
      return inner;
    });
    expect(tree).toEqual({
      childCount: 2,
      firstType: 'paragraph',
      firstText: 'Inner',
      firstInline: 1,
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  // ── Marks preservation ──
  // The text-before-the-trailing-hb survives intact, including any
  // formatting marks (bold, italic, etc.) that were applied to it.

  test('Shift+Enter after BOLD text + paste H1 → bold preserved on first row, heading sibling', async ({ page }) => {
    await setContent(page, '<ul><li><p><strong>Bold</strong></p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Bold');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; firstChild: { type: { name: string }; text: string; marks: { type: { name: string } }[] } | null; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const p = li?.firstChild;
      const text = p?.firstChild;
      return {
        liChildCount: li?.childCount,
        pInline: p?.childCount,
        textType: text?.type.name,
        textValue: text?.text,
        textMarks: text?.marks?.map((m) => m.type.name),
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      pInline: 1, // single text node - no trailing hardBreak
      textType: 'text',
      textValue: 'Bold',
      textMarks: ['bold'],
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  // ── Multiple hardBreaks ──
  // Only the LAST hardBreak (the one immediately before the cursor) is
  // trimmed. A hardBreak in the MIDDLE of the paragraph stays put.

  test('two hardBreaks (`A<br>B<br>|`) + paste H1 → middle <br> preserved, only trailing one trimmed', async ({ page }) => {
    await setContent(page, '<p>A</p>');
    await setCaretAtEndOfParagraph(page, 'A');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('B');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    // First top-level node: <p>A<br>B</p> - one middle hardBreak survives.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; text?: string } } | null; lastChild: { type: { name: string }; textContent: string } | null } } }
        | undefined;
      const p = ed?.state.doc.firstChild;
      const inline: { type: string; text?: string }[] = [];
      for (let i = 0; i < (p?.childCount ?? 0); i++) {
        const c = p?.child(i);
        if (c) inline.push({ type: c.type.name, text: c.text });
      }
      return {
        topCount: ed?.state.doc.childCount,
        firstType: p?.type.name,
        inline,
        lastType: ed?.state.doc.lastChild?.type.name,
        lastText: ed?.state.doc.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      topCount: 2,
      firstType: 'paragraph',
      inline: [
        { type: 'text', text: 'A' },
        { type: 'hardBreak', text: undefined },
        { type: 'text', text: 'B' },
      ],
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  // ── Negative coverage: caret NOT after a trailing hardBreak ──

  test('caret in MIDDLE of paragraph (no trailing hardBreak) → split branch fires, NOT trim path', async ({ page }) => {
    // Paragraph "Hello world", caret after "Hello", no shift+enter.
    // SmartPaste splits + inserts; nothing to trim.
    await setContent(page, '<ul><li><p>Hello world</p></li></ul>');
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === 'paragraph' && n.textContent === 'Hello world') { pos = p; return false; }
        return true;
      });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1 + 'Hello'.length)));
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>BREAK</h1>');

    // listItem now has [p"Hello", h1"BREAK", p" world"] - split + insert.
    const items = await page.evaluate(() => {
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
    expect(items).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'BREAK' },
      { type: 'paragraph', text: ' world' },
    ]);
  });

  test('caret BEFORE trailing hardBreak (`A|<br>`) → standard end-insert; trailing <br> stays', async ({ page }) => {
    // Build `<p>A<br></p>` then move caret BEFORE the hardBreak (offset=1).
    // offset !== parentSize, so trim path doesn't fire - heading is
    // appended after the paragraph by the regular split logic and the
    // trailing hardBreak survives.
    await setContent(page, '<p>A</p>');
    await setCaretAtEndOfParagraph(page, 'A');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    // Now paragraph is <p>A<br></p>, caret offset=2. Move caret to offset=1 (between A and br).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string } }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph') { pos = p; return false; } return true; });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1 + 1))); // offset=1, between 'A' and br
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>Heading</h1>');

    // Caret was in MIDDLE (offset=1, parentSize=2) - split path. Result:
    // <p>A</p><h1>Heading</h1><p><br></p>. The trailing <br> survives
    // intact in the second-half paragraph.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; child: (i: number) => { type: { name: string }; textContent: string; childCount: number; firstChild: { type: { name: string } } | null } } } }
        | undefined;
      const out: { type: string; text: string; childCount: number; firstChildType: string | undefined }[] = [];
      for (let i = 0; i < (ed?.state.doc.childCount ?? 0); i++) {
        const c = ed?.state.doc.child(i);
        if (c) out.push({ type: c.type.name, text: c.textContent, childCount: c.childCount, firstChildType: c.firstChild?.type.name });
      }
      return out;
    });
    expect(tree).toEqual([
      { type: 'paragraph', text: 'A', childCount: 1, firstChildType: 'text' },
      { type: 'heading', text: 'Heading', childCount: 1, firstChildType: 'text' },
      { type: 'paragraph', text: '', childCount: 1, firstChildType: 'hardBreak' },
    ]);
  });

  test('caret at end of TEXT paragraph (no Shift+Enter) → end-insert branch, heading sibling, source paragraph unchanged', async ({ page }) => {
    // No trailing hardBreak in the parent → trim path must not fire.
    await setContent(page, '<ul><li><p>Hello</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Hello');
    await pasteHtml(page, '<h1>Heading</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstText: 'Hello',
      firstInline: 1, // single text node - same as in trim case (no hb to trim either)
      lastType: 'heading',
      lastText: 'Heading',
    });
  });

  // ── After-paste cursor lands at end of inserted heading ──

  test('after Shift+Enter trim+paste in list item, typing appends to inserted heading', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');
    await page.keyboard.type('!');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { firstChild: { textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        firstText: li?.firstChild?.textContent,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      firstText: 'Existing',
      lastType: 'heading',
      lastText: 'Heading!',
    });
  });

  test('after Shift+Enter trim+paste at top level, typing appends to inserted heading', async ({ page }) => {
    await setContent(page, '<p>Hello</p>');
    await setCaretAtEndOfParagraph(page, 'Hello');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');
    await page.keyboard.type('!');

    expect(await topBlocks(page)).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'Heading!' },
    ]);
  });

  // ── Undo restores trailing hardBreak ──
  // The trim+insert happens in ONE transaction (same `tr` dispatched once),
  // so a single Ctrl+Z reverts both the trim and the heading insertion.
  // We wait long enough between the Shift+Enter and the paste so PM's
  // history plugin doesn't merge them into a single group (default
  // `newGroupDelay` is 500 ms) - otherwise one undo would also revert
  // the Shift+Enter, defeating the point of the assertion.

  test('Ctrl+Z after trim+paste reverts the paste only - trailing <br> back in place', async ({ page }) => {
    await setContent(page, '<p>Existing</p>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(700); // exceed PM history newGroupDelay (500ms)
    await pasteHtml(page, '<h1>Heading</h1>');
    // Sanity: trim+sibling produced 2 top-level nodes.
    expect((await topBlocks(page)).length).toBe(2);

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(80);

    // Single top-level paragraph again, with a TRAILING hardBreak inside.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; text?: string } } | null } } }
        | undefined;
      const p = ed?.state.doc.firstChild;
      const inline: { type: string; text?: string }[] = [];
      for (let i = 0; i < (p?.childCount ?? 0); i++) {
        const c = p?.child(i);
        if (c) inline.push({ type: c.type.name, text: c.text });
      }
      return { topCount: ed?.state.doc.childCount, firstType: p?.type.name, inline };
    });
    expect(tree).toEqual({
      topCount: 1,
      firstType: 'paragraph',
      inline: [
        { type: 'text', text: 'Existing' },
        { type: 'hardBreak', text: undefined },
      ],
    });
  });

  // ── List-slice + Shift+Enter ──
  // List-slice path also routes through the trim branch when the parent
  // paragraph has a trailing hardBreak. Items become siblings of the
  // current list item (not nested).

  test('paste bulletList slice after Shift+Enter in TEXT list item → text item + pasted item siblings, no nested list, no extra empty row', async ({ page }) => {
    await setContent(page, '<ul><li><p>One</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'One');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<ul><li><p>Two</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { childCount: number; firstChild: { type: { name: string }; childCount: number; child: (i: number) => { type: { name: string }; childCount: number; firstChild: { type: { name: string }; childCount: number; textContent: string } | null } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const items: { type: string; childCount: number; firstText: string; firstInline: number; firstType: string }[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) {
        const li = ul?.child(i);
        if (li) items.push({
          type: li.type.name,
          childCount: li.childCount,
          firstText: li.firstChild?.textContent ?? '',
          firstInline: li.firstChild?.childCount ?? -1,
          firstType: li.firstChild?.type.name ?? '',
        });
      }
      return { topCount: ed?.state.doc.childCount, ulChildCount: ul?.childCount, items };
    });
    expect(tree).toEqual({
      topCount: 1,
      ulChildCount: 2,
      items: [
        { type: 'listItem', childCount: 1, firstText: 'One', firstInline: 1, firstType: 'paragraph' }, // hardBreak trimmed
        { type: 'listItem', childCount: 1, firstText: 'Two', firstInline: 1, firstType: 'paragraph' },
      ],
    });
  });

  test('paste bulletList slice after Shift+Enter in EMPTY list item → empty li + pasted li siblings (empty row preserved)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li><li><p></p></li></ul>');
    await setCaretAtEndOfParagraph(page, '');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<ul><li><p>Pasted</p></li></ul>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { childCount: number; child: (i: number) => { childCount: number; firstChild: { childCount: number; textContent: string } | null } } | null } } }
        | undefined;
      const ul = ed?.state.doc.firstChild;
      const items: { childCount: number; firstText: string; firstInline: number }[] = [];
      for (let i = 0; i < (ul?.childCount ?? 0); i++) {
        const li = ul?.child(i);
        if (li) items.push({ childCount: li.childCount, firstText: li.firstChild?.textContent ?? '', firstInline: li.firstChild?.childCount ?? -1 });
      }
      return { ulChildCount: ul?.childCount, items };
    });
    expect(tree).toEqual({
      ulChildCount: 3,
      items: [
        { childCount: 1, firstText: 'Existing', firstInline: 1 },
        { childCount: 1, firstText: '', firstInline: 0 },        // empty row preserved (hb trimmed)
        { childCount: 1, firstText: 'Pasted', firstInline: 1 },
      ],
    });
  });

  // ── Mixed slice (paragraph + heading) after Shift+Enter ──

  test('paste paragraph + heading after Shift+Enter in TEXT list item → all three blocks siblings inside same listItem', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<p>Mid</p><h1>End</h1>');

    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; child: (i: number) => { type: { name: string }; childCount: number; textContent: string } } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      const out: { type: string; childCount: number; text: string }[] = [];
      for (let i = 0; i < (li?.childCount ?? 0); i++) {
        const c = li?.child(i);
        if (c) out.push({ type: c.type.name, childCount: c.childCount, text: c.textContent });
      }
      return out;
    });
    expect(tree).toEqual([
      { type: 'paragraph', childCount: 1, text: 'Existing' }, // hardBreak trimmed
      { type: 'paragraph', childCount: 1, text: 'Mid' },
      { type: 'heading', childCount: 1, text: 'End' },
    ]);
  });

  // ── DOM-level verification: <br> count ──
  // A regression of the fix would leave a stray trailing `<br>` element
  // in the rendered DOM. Assert the count is zero after the trim path.

  test('rendered DOM has NO trailing <br> after trim+paste (text + heading list item)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    await pasteHtml(page, '<h1>Heading</h1>');

    // The first paragraph inside the listItem must contain ZERO <br>
    // elements. (PM may render an empty paragraph with a placeholder
    // `<br>` for caret positioning, but that's only inside fully-empty
    // paragraphs - our paragraph has the text "Existing".)
    const brCount = await page.locator(`${editorSelector} li p:nth-of-type(1) br`).count();
    expect(brCount).toBe(0);
  });

  // ── Range selection ending exactly at trailing hardBreak ──
  // After deleteSelection, the caret should still resolve correctly
  // (either as truly-empty parent → replace, or trailing-hb gone → end
  // insert) and the result must still be the user-expected 2 rows.

  test('range selection covering trailing hardBreak + paste H1 → range deleted, heading sibling, no stray <br>', async ({ page }) => {
    await setContent(page, '<ul><li><p>Existing</p></li></ul>');
    await setCaretAtEndOfParagraph(page, 'Existing');
    await page.keyboard.press('Shift+Enter');
    await page.waitForTimeout(50);
    // Now paragraph: `<p>Existing<br>|</p>`, caret offset=9 (after hb).
    // Select range [4..9] (covers "ting" + hardBreak).
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { descendants: (cb: (n: { type: { name: string } }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown } }; view: { dispatch: (tr: unknown) => void; state: { selection: { constructor: { create: (doc: unknown, a: number, h?: number) => unknown } } }; focus: () => void } }
        | undefined;
      if (!ed) return;
      let pos = -1;
      ed.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph') { pos = p; return false; } return true; });
      const TS = ed.view.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create((ed.state.doc as unknown), pos + 1 + 4, pos + 1 + 9)));
      ed.view.focus();
    });
    await pasteHtml(page, '<h1>Heading</h1>');

    // After range delete, paragraph is "Exis" (no trailing hardBreak -
    // the selection swallowed it). Then heading inserted as sibling.
    const tree = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild: { firstChild: { childCount: number; firstChild: { childCount: number; textContent: string } | null; lastChild: { type: { name: string }; textContent: string } | null } | null } | null } } }
        | undefined;
      const li = ed?.state.doc.firstChild?.firstChild;
      return {
        liChildCount: li?.childCount,
        firstText: li?.firstChild?.textContent,
        firstInline: li?.firstChild?.childCount,
        lastType: li?.lastChild?.type.name,
        lastText: li?.lastChild?.textContent,
      };
    });
    expect(tree).toEqual({
      liChildCount: 2,
      firstText: 'Exis',
      firstInline: 1, // no trailing <br>
      lastType: 'heading',
      lastText: 'Heading',
    });
  });
});
