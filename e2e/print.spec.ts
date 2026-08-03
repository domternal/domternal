/**
 * What the document looks like on paper.
 *
 * Two layers are under test and they are deliberately independent:
 *
 *   1. The stylesheet, which applies to the reader's own Ctrl/Cmd+P with no
 *      code involved. Its job is that chrome disappears and that nothing
 *      which is clipped or collapsed on screen goes MISSING, which is the
 *      failure nobody notices until a customer prints a contract and the
 *      closed accordion's clauses are not on it.
 *   2. The isolation the `printDocument` command adds on top, which hides the
 *      host application around the editor without this package ever knowing
 *      one of the host's class names.
 *
 * Assertions come from three sources. Computed styles and geometry are read
 * under `emulateMedia({ media: 'print' })`, so they are the print cascade
 * itself rather than a guess about it. Where the question is "does this
 * content occupy paper", the answer comes from `page.pdf()`: Chromium
 * embeds subset fonts, so the text layer is not readable without a full PDF
 * parser, but the page tree's `/Count` is, and a document that grew by a
 * page is a document whose content was really laid out.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const EDITOR = '.dm-editor .ProseMirror';
const PRINT_BUTTON = '.dm-toolbar [aria-label="Print"]';

interface DemoEditor {
  setContent: (html: string, emit: boolean) => void;
  setEditable: (value: boolean) => void;
  commands: Record<string, (...args: unknown[]) => boolean>;
}

async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(EDITOR);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((content) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    editor?.setContent(content, false);
  }, html);
  // Node views for details and tables mount on the next frame.
  await page.waitForTimeout(150);
}

/** Sheets a real Chromium print produces, from the PDF page tree. */
async function printedPageCount(page: Page): Promise<number> {
  const bytes = await page.pdf({ printBackground: true });
  const raw = bytes.toString('latin1');
  expect(raw.slice(0, 5)).toBe('%PDF-');
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  expect(counts.length).toBeGreaterThan(0);
  return Math.max(...counts);
}

async function styleOf(
  page: Page,
  selector: string,
  property: string,
): Promise<string | null> {
  return page.evaluate(
    ([sel, prop]) => {
      const el = document.querySelector(sel as string);
      if (!el) return null;
      return getComputedStyle(el).getPropertyValue(prop as string);
    },
    [selector, property],
  );
}

for (const target of demoTargets) {
  test(`${target.name}: the toolbar keeps a print button that stays live in a read-only editor`, async ({
    page,
  }) => {
    await openDemo(page, target);
    const button = page.locator(PRINT_BUTTON);
    await expect(button).toBeVisible();
    // A tooltip and an accessible name, since the glyph alone says nothing.
    await expect(button).toHaveAttribute('title', /Print/);

    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | DemoEditor
        | undefined;
      editor?.setEditable(false);
    });
    await page.waitForTimeout(200);
    // Reading a document out to paper is not editing it.
    await expect(button).toBeEnabled();
  });

  test(`${target.name}: chrome disappears from the printed page`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(page, '<p>Body text that must survive.</p>');
    await page.locator(EDITOR).click();
    await page.emulateMedia({ media: 'print' });

    // The toolbar is the visible half of the old defect: it printed. Asserted
    // unconditionally, since every demo has one, so a renamed selector reads
    // as a gap rather than a pass.
    expect(await styleOf(page, '.dm-toolbar', 'display')).toBe('none');

    for (const selector of ['.dm-block-handle', '.dm-toc-outline-shell']) {
      const display = await styleOf(page, selector, 'display');
      // These two only exist once their extension has drawn something, so
      // absent is legitimately as good as hidden.
      if (display !== null) expect(display).toBe('none');
    }

    // The document itself is still laid out, which is the other half.
    const body = await page.evaluate(() => {
      const paragraph = document.querySelector('.dm-editor .ProseMirror p');
      const rect = paragraph?.getBoundingClientRect();
      return rect ? { width: rect.width, height: rect.height } : null;
    });
    expect(body?.height ?? 0).toBeGreaterThan(0);
    expect(body?.width ?? 0).toBeGreaterThan(0);

    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a closed accordion prints its body`, async ({ page }) => {
    // The failure that loses content silently: the node view sets [hidden]
    // on the body, so a closed accordion's clauses are simply not on paper.
    await openDemo(page, target);
    const clauses = Array.from(
      { length: 60 },
      (_, i) => `<p>Clause ${String(i + 1)} that is hidden while the accordion is closed.</p>`,
    ).join('');
    await setContent(page, `<details><summary>Terms</summary>${clauses}</details>`);

    const hiddenOnScreen = await page.evaluate(() => {
      const body = document.querySelector('.dm-editor [data-details-content]');
      return body ? getComputedStyle(body).display : null;
    });
    expect(hiddenOnScreen).toBe('none');
    const withClauses = await printedPageCount(page);

    // Same document, same summary, no body. If the closed body were still
    // dropped on paper, both would print identically.
    await setContent(page, '<details><summary>Terms</summary><p></p></details>');
    const withoutClauses = await printedPageCount(page);

    expect(withClauses).toBeGreaterThan(withoutClauses);

    await page.emulateMedia({ media: 'print' });
    const revealed = await styleOf(page, '.dm-editor [data-details-content]', 'display');
    expect(revealed).not.toBe('none');
    // The chevron is a control; it has no meaning on paper.
    const chevron = await styleOf(page, '.dm-editor div[data-type="details"] > button', 'display');
    if (chevron !== null) expect(chevron).toBe('none');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a long code line prints in full instead of being cut`, async ({ page }) => {
    await openDemo(page, target);
    const long = `const identifier = "${'x'.repeat(400)}";`;
    await setContent(page, `<pre><code>${long}</code></pre>`);

    await page.emulateMedia({ media: 'print' });
    const overflow = await styleOf(page, '.dm-editor .ProseMirror pre', 'overflow-x');
    expect(overflow).not.toBe('auto');
    expect(overflow).not.toBe('scroll');

    // Measured, not inferred: nothing may stick out of its own box.
    const spill = await page.evaluate(() => {
      const pre = document.querySelector('.dm-editor .ProseMirror pre');
      return pre ? pre.scrollWidth - pre.clientWidth : null;
    });
    expect(spill).not.toBeNull();
    expect(spill ?? 0).toBeLessThanOrEqual(1);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a wide table is not clipped by its scroll wrapper`, async ({ page }) => {
    await openDemo(page, target);
    const cells = Array.from(
      { length: 9 },
      (_, i) => `<td><p>Column ${String(i + 1)}</p></td>`,
    ).join('');
    await setContent(page, `<table><tbody><tr>${cells}</tr></tbody></table>`);

    const measure = (): Promise<{ overhang: number; lastCellWidth: number } | null> =>
      page.evaluate(() => {
        const wrapper = document.querySelector('.dm-editor .tableWrapper');
        const table = document.querySelector('.dm-editor .ProseMirror table');
        const lastCell = document.querySelector('.dm-editor .ProseMirror tr > td:last-child');
        if (!wrapper || !table || !lastCell) return null;
        return {
          overhang: Math.round(
            table.getBoundingClientRect().right - wrapper.getBoundingClientRect().right,
          ),
          lastCellWidth: Math.round(lastCell.getBoundingClientRect().width),
        };
      });

    // On screen the table runs well past its wrapper, which is fine because
    // the wrapper scrolls. Paper cannot scroll: the same overhang is content
    // cut off the sheet.
    const onScreen = await measure();
    expect(onScreen).not.toBeNull();
    expect(onScreen?.overhang ?? 0).toBeGreaterThan(20);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-editor .tableWrapper', 'overflow-x')).toBe('visible');

    const onPaper = await measure();
    expect(onPaper).not.toBeNull();
    // Down to the table's own border, not a column's worth of content. The
    // last column is the one a clipped wrapper drops, so it must be inside
    // the printable box and still have a real width.
    expect(onPaper?.overhang ?? 999).toBeLessThanOrEqual(3);
    expect(onPaper?.lastCellWidth ?? 0).toBeGreaterThan(0);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a table with stored column widths still fits the sheet`, async ({
    page,
  }) => {
    // A different code path from the test above: when every column carries a
    // colwidth the node view writes an absolute `width` on the table instead
    // of a `min-width`, and an inline style beats any rule without
    // `!important`. Dragged-resize documents are the common case here.
    await openDemo(page, target);
    const cells = Array.from(
      { length: 6 },
      (_, i) => `<td colwidth="220"><p>Wide column ${String(i + 1)}</p></td>`,
    ).join('');
    await setContent(page, `<table><tbody><tr>${cells}</tr></tbody></table>`);

    await page.emulateMedia({ media: 'print' });
    const fit = await page.evaluate(() => {
      const wrapper = document.querySelector('.dm-editor .tableWrapper');
      const table = document.querySelector('.dm-editor .ProseMirror table');
      if (!wrapper || !table) return null;
      return {
        overhang: Math.round(
          table.getBoundingClientRect().right - wrapper.getBoundingClientRect().right,
        ),
        // The inline attribute is still on the element; the print rule has to
        // win over it rather than expect it to be gone.
        hasInlineWidth: (table as HTMLElement).style.width !== '' ||
          (table as HTMLElement).style.minWidth !== '',
      };
    });
    expect(fit).not.toBeNull();
    // The point of this case is the inline style; without one it is a
    // duplicate of the test above and proves nothing new.
    expect(fit?.hasInlineWidth).toBe(true);
    expect(fit?.overhang ?? 999).toBeLessThanOrEqual(3);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: editing decorations do not print`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(page, '<p>Visible sentence.</p>');
    await page.locator(EDITOR).click();
    // Invisible characters are the clearest case: pilcrows are pure editing
    // furniture that would print as literal marks in the text.
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | DemoEditor
        | undefined;
      editor?.commands['showInvisibleChars']?.();
    });
    await page.waitForTimeout(200);
    const shownOnScreen = await page.locator('.dm-editor .ProseMirror .invisible-char').count();
    expect(shownOnScreen).toBeGreaterThan(0);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-editor .ProseMirror .invisible-char', 'display')).toBe('none');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the editor frame does not print as a box`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(page, '<p>Framed on screen only.</p>');

    await page.emulateMedia({ media: 'print' });
    const frame = await page.evaluate(() => {
      const el = document.querySelector('.dm-editor');
      const inner = document.querySelector('.dm-editor .ProseMirror');
      if (!el || !inner) return null;
      const style = getComputedStyle(el);
      return {
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        // The block-handle gutter reserves ~48px on every printed page.
        paddingLeft: getComputedStyle(inner).paddingLeft,
        minHeight: getComputedStyle(inner).minHeight,
      };
    });
    expect(frame?.borderTopWidth).toBe('0px');
    expect(frame?.boxShadow).toBe('none');
    expect(frame?.paddingLeft).toBe('0px');
    expect(frame?.minHeight).toBe('0px');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: printDocument marks the editor and its ancestors, then cleans up`, async ({
    page,
  }) => {
    await openDemo(page, target);
    // window.print() blocks on a real dialog, so it is replaced by a probe
    // that reads the DOM at exactly the moment the browser would render.
    const marks = await page.evaluate(() => {
      const captured: Record<string, boolean>[] = [];
      const original = window.print;
      window.print = (): void => {
        const root = document.querySelector('.dm-editor');
        const parent = root?.parentElement ?? null;
        const sibling = parent
          ? Array.from(parent.children).find((child) => child !== root)
          : undefined;
        captured.push({
          root: root?.classList.contains('dm-print-root') ?? false,
          bodyPrinting: document.body.classList.contains('dm-printing'),
          bodyAncestor: document.body.classList.contains('dm-print-ancestor'),
          htmlAncestor: document.documentElement.classList.contains('dm-print-ancestor'),
          unmarkedSibling:
            sibling === undefined ||
            (!sibling.classList.contains('dm-print-ancestor') &&
              !sibling.classList.contains('dm-print-root')),
        });
      };
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | DemoEditor
        | undefined;
      const ran = editor?.commands['printDocument']?.() ?? false;
      window.print = original;
      return {
        ran,
        captured: captured[0] ?? null,
        leftBehind: document.querySelectorAll('.dm-print-root, .dm-print-ancestor').length,
        stillPrinting: document.body.classList.contains('dm-printing'),
      };
    });

    expect(marks.ran).toBe(true);
    expect(marks.captured).toEqual({
      root: true,
      bodyPrinting: true,
      bodyAncestor: true,
      htmlAncestor: true,
      unmarkedSibling: true,
    });
    // Nothing may outlive the dialog: a leftover mark hides the whole app.
    expect(marks.leftBehind).toBe(0);
    expect(marks.stillPrinting).toBe(false);
  });

  test(`${target.name}: printDocument leaves the document unchanged`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(page, '<p>Untouched by printing.</p>');
    const before = await page.locator(EDITOR).innerHTML();

    await page.evaluate(() => {
      const original = window.print;
      window.print = (): void => undefined;
      const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | DemoEditor
        | undefined;
      editor?.commands['printDocument']?.();
      window.print = original;
    });
    await page.waitForTimeout(150);

    expect(await page.locator(EDITOR).innerHTML()).toBe(before);
  });

  test(`${target.name}: the print button opens the dialog exactly once`, async ({ page }) => {
    await openDemo(page, target);
    await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      store['__PRINT_CALLS__'] = 0;
      window.print = (): void => {
        store['__PRINT_CALLS__'] = (store['__PRINT_CALLS__'] as number) + 1;
      };
    });

    await page.locator(PRINT_BUTTON).click();
    await page.waitForTimeout(200);

    const calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['__PRINT_CALLS__'],
    );
    expect(calls).toBe(1);
  });

  test(`${target.name}: isolation hides the host application around the editor`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await setContent(page, '<p>The document itself.</p>');

    // A sibling of the editor's ancestor chain: the shape every host app has
    // around an embedded editor.
    await page.evaluate(() => {
      const chrome = document.createElement('aside');
      chrome.id = 'host-chrome';
      chrome.style.height = '400px';
      chrome.textContent = 'Host application sidebar';
      document.body.appendChild(chrome);
      const root = document.querySelector('.dm-editor');
      root?.classList.add('dm-print-root');
      let node = root?.parentElement ?? null;
      while (node) {
        node.classList.add('dm-print-ancestor');
        node = node.parentElement;
      }
      document.body.classList.add('dm-printing');
    });

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '#host-chrome', 'display')).toBe('none');
    // And the document is still there, which is the other half of the claim.
    expect(await styleOf(page, '.dm-editor', 'display')).not.toBe('none');
    const stillLaidOut = await page.evaluate(() => {
      const rect = document.querySelector('.dm-editor .ProseMirror p')?.getBoundingClientRect();
      return rect ? rect.height : 0;
    });
    expect(stillLaidOut).toBeGreaterThan(0);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: Ctrl/Cmd+P in the editor prints the document`, async ({ page }) => {
    // The shortcut is bound only while the caret is in the editor, which is
    // exactly when the reader means "print this document" rather than "print
    // this page". It also has to beat the browser's own dialog to the key.
    await openDemo(page, target);
    await setContent(page, '<p>Printed by keyboard.</p>');
    await page.locator(EDITOR).click();
    await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      store['__PRINT_CALLS__'] = 0;
      store['__PRINT_ISOLATED__'] = false;
      window.print = (): void => {
        store['__PRINT_CALLS__'] = (store['__PRINT_CALLS__'] as number) + 1;
        store['__PRINT_ISOLATED__'] = document.body.classList.contains('dm-printing');
      };
    });

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p');
    await page.waitForTimeout(250);

    const result = await page.evaluate(() => {
      const store = window as unknown as Record<string, unknown>;
      return { calls: store['__PRINT_CALLS__'], isolated: store['__PRINT_ISOLATED__'] };
    });
    expect(result.calls).toBe(1);
    expect(result.isolated).toBe(true);
  });

  test(`${target.name}: notion mode does not print 60vh of blank paper`, async ({ page }) => {
    // The notion preset gives the page room to breathe on screen. On paper
    // that is more than half a blank sheet before the first line, plus a
    // centred column that wastes both margins.
    await openDemo(page, target);
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);

    const onScreen = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).minHeight : null;
    }, target.editorSelector);
    expect(onScreen).not.toBe('0px');

    await page.emulateMedia({ media: 'print' });
    const onPaper = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      return { minHeight: style.minHeight, maxWidth: style.maxWidth };
    }, target.editorSelector);
    expect(onPaper?.minHeight).toBe('0px');
    expect(onPaper?.maxWidth).toBe('none');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: floated images keep their side and do not straddle a break`, async ({
    page,
  }) => {
    // Float is the one layout the PDF backend cannot reproduce, so the
    // browser path has to be the one that gets it right.
    await openDemo(page, target);
    await setContent(
      page,
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAhklEQVR4nO3QQQkAIADAQHvZztC+baEwDxZg3Jhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K0OrqfNIotgRa0AAAAASUVORK5CYII=" style="float: left" width="120" />' +
        '<p>Text that wraps around the picture in the browser, which is the layout a file backend without float cannot reproduce.</p>',
    );

    await page.emulateMedia({ media: 'print' });
    const layout = await page.evaluate(() => {
      const picture =
        document.querySelector('.dm-editor .ProseMirror .dm-image-resizable') ??
        document.querySelector('.dm-editor .ProseMirror img');
      const paragraph = document.querySelector('.dm-editor .ProseMirror p');
      if (!picture || !paragraph) return null;
      const pictureRect = picture.getBoundingClientRect();
      const paragraphRect = paragraph.getBoundingClientRect();
      return {
        breakInside: getComputedStyle(picture).breakInside,
        // Beside, not under: the paragraph's top is level with the picture.
        beside: paragraphRect.top < pictureRect.bottom,
        toTheRight: paragraphRect.right > pictureRect.right,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout?.beside).toBe(true);
    expect(layout?.toTheRight).toBe(true);
    expect(layout?.breakInside).toBe('avoid');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: coloured content keeps its fill on paper`, async ({ page }) => {
    // Browsers strip backgrounds when printing unless the page asks for them,
    // and for a code block or a highlight the fill IS the meaning.
    await openDemo(page, target);
    await setContent(page, '<pre><code>const highlighted = true;</code></pre>');

    await page.emulateMedia({ media: 'print' });
    const adjust = await page.evaluate(() => {
      const pre = document.querySelector('.dm-editor .ProseMirror pre');
      if (!pre) return null;
      const style = getComputedStyle(pre);
      return style.getPropertyValue('print-color-adjust') || style.getPropertyValue('-webkit-print-color-adjust');
    });
    expect(adjust).toBe('exact');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a dark-themed document prints in ink, not in its screen colours`, async ({
    page,
  }) => {
    // The failure is silent and total: dropping the dark panel behind the
    // text without dropping the text colour leaves near-white glyphs on
    // white paper. The page is not wrong, it is BLANK.
    await openDemo(page, target);
    await setContent(page, '<p>Legible on paper.</p>');
    await page.evaluate(() => document.body.classList.add('dm-theme-dark'));
    await page.waitForTimeout(150);

    const onScreen = await page.evaluate(() => {
      const el = document.querySelector('.dm-editor .ProseMirror p');
      return el ? getComputedStyle(el).color : null;
    });
    // Light text on screen is the precondition; without it the test is moot.
    const channels = (value: string | null): number[] =>
      (value ?? '').match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    expect(Math.min(...channels(onScreen))).toBeGreaterThan(150);

    await page.emulateMedia({ media: 'print' });
    const onPaper = await page.evaluate(() => {
      const el = document.querySelector('.dm-editor .ProseMirror p');
      const frame = document.querySelector('.dm-editor');
      if (!el || !frame) return null;
      return {
        color: getComputedStyle(el).color,
        background: getComputedStyle(frame).backgroundColor,
      };
    });
    await page.emulateMedia({ media: null });
    await page.evaluate(() => document.body.classList.remove('dm-theme-dark'));

    // Dark ink, and no panel behind it to pay for.
    expect(Math.max(...channels(onPaper?.color ?? null))).toBeLessThan(80);
    expect(onPaper?.background).toBe('rgba(0, 0, 0, 0)');
  });

  test(`${target.name}: table handles lose to the print sheet even though JS writes their display`, async ({
    page,
  }) => {
    // The one place in the sheet where a rule fights an INLINE style: the
    // table node view writes `display: flex` on its handles as the pointer
    // moves, so a plain rule loses and the handles print as grey bars down
    // the side of the table. This is why those selectors carry `!important`,
    // and nothing else checks that they still win.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>',
    );
    await page.locator(`${EDITOR} td p`).first().click();
    await page.locator(`${EDITOR} table`).first().hover();
    await page.waitForTimeout(250);

    const inline = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.dm-table-col-handle, .dm-table-row-handle'))
        .map((el) => el.style.display)
        .filter(Boolean),
    );
    // The precondition: at least one handle really carries an inline display.
    expect(inline.length, 'no handle carried an inline display to fight').toBeGreaterThan(0);

    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '.dm-table-col-handle, .dm-table-row-handle, .dm-table-cell-handle, .dm-table-cell-toolbar',
        ),
      ).map((el) => getComputedStyle(el).display),
    );
    await page.emulateMedia({ media: null });

    expect(printed.length).toBeGreaterThan(0);
    expect(printed.every((value) => value === 'none')).toBe(true);
  });

  test(`${target.name}: open menus and popovers never reach the paper`, async ({ page }) => {
    // The chrome test earlier only sees what is on screen at rest. These are
    // raised deliberately, because a menu that happens to be open when the
    // reader prints is exactly when the rule matters.
    await openDemo(page, target);
    await setContent(page, '<p>Select this sentence.</p>');

    // Bubble menu: a real DOM selection raises it.
    await page.evaluate((selector) => {
      const paragraph = document.querySelector(`${selector} p`);
      if (!paragraph?.firstChild) throw new Error('no paragraph');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 6);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const editor = document.querySelector(selector);
      if (editor instanceof HTMLElement) editor.focus();
    }, EDITOR);
    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-bubble-menu', 'display')).toBe('none');
    await page.emulateMedia({ media: null });

    // The slash menu lives in the Notion demo, which is where that extension
    // is registered; raising it means switching modes rather than typing in
    // the classic editor.
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    await page.locator(target.editorSelector).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(page.locator('.dm-slash-command-menu')).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-slash-command-menu', 'display')).toBe('none');
    // The floating menu shares the empty line with it and is chrome too.
    const floating = await styleOf(page, '.dm-floating-menu', 'display');
    if (floating !== null) expect(floating).toBe('none');
    await page.emulateMedia({ media: null });
    await page.keyboard.press('Escape');
  });

  test(`${target.name}: an open toolbar dropdown and its colour palette do not print`, async ({
    page,
  }) => {
    // The panel is the one piece of chrome the reader is most likely to have
    // open at the moment they reach for print, since opening it is what they
    // were doing a second earlier.
    //
    // What delivers this today is the toolbar's own rule, since the panel is
    // a descendant: removing the panel's line from the sheet does not break
    // this test, and it is not meant to. The claim under test is the user's,
    // that an open dropdown is not on the paper, and it fails the moment
    // either rule stops covering it.
    await openDemo(page, target);
    await setContent(page, '<p>Colour me.</p>');
    await page.locator('.dm-toolbar [aria-label="Text Color"]').click();
    const panel = page.locator('.dm-toolbar-dropdown-panel');
    await expect(panel).toBeVisible();
    // The same panel carries the palette class, so both rules are in play.
    await expect(page.locator('.dm-toolbar-dropdown-panel.dm-color-palette')).toHaveCount(1);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-toolbar-dropdown-panel', 'display')).toBe('none');
    expect(await styleOf(page, '.dm-color-palette', 'display')).toBe('none');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the block context menu and its tint do not print`, async ({ page }) => {
    // Opened from the drag handle, and it tints the block it belongs to, so
    // two rules land at once: the menu itself and the decoration it leaves on
    // the document.
    await openDemo(page, target);
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    const block = page.locator(`${target.editorSelector} p`).first();
    await block.hover();
    const handle = page.locator('.dm-block-handle');
    await expect(handle).toHaveAttribute('data-show', '');
    await page.locator('.dm-block-handle-drag').click();
    await expect(page.locator('.dm-block-context-menu')).toBeVisible();
    await expect(page.locator('.dm-block-context-active')).toHaveCount(1);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-block-context-menu', 'display')).toBe('none');
    // The tint is a decoration INSIDE the document, so it is stripped rather
    // than hidden: the block keeps its text.
    const tinted = await page.evaluate(() => {
      const el = document.querySelector('.dm-block-context-active');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { display: style.display, background: style.backgroundColor };
    });
    await page.emulateMedia({ media: null });
    await page.keyboard.press('Escape');

    expect(tinted?.display).not.toBe('none');
    expect(tinted?.background).toBe('rgba(0, 0, 0, 0)');
  });

  test(`${target.name}: mention and emoji suggestions do not print, nor does the query behind them`, async ({
    page,
  }) => {
    // Both are caret-anchored popups, and the slash one also underlines the
    // text still being typed. That decoration is inside the document, so if
    // it survived it would print as an underline under a half-typed word.
    await openDemo(page, target);
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    await page.locator(target.editorSelector).click();
    await page.keyboard.press('End');

    await page.keyboard.press('Enter');
    await page.keyboard.type('@');
    await expect(page.locator('.dm-mention-suggestion')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-mention-suggestion', 'display')).toBe('none');
    await page.emulateMedia({ media: null });
    await page.keyboard.press('Escape');

    await page.keyboard.press('Enter');
    await page.keyboard.type(':sm');
    await expect(page.locator('.dm-emoji-suggestion')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-emoji-suggestion', 'display')).toBe('none');
    await page.emulateMedia({ media: null });
    await page.keyboard.press('Escape');

    // The slash menu's own inline decoration on the live query.
    await page.keyboard.press('Enter');
    await page.keyboard.type('/head');
    await expect(page.locator('.dm-slash-command-query')).toHaveCount(1);
    await page.emulateMedia({ media: 'print' });
    const query = await page.evaluate(() => {
      const el = document.querySelector('.dm-slash-command-query');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, decoration: style.textDecorationLine };
    });
    await page.emulateMedia({ media: null });
    await page.keyboard.press('Escape');

    expect(query?.background).toBe('rgba(0, 0, 0, 0)');
    expect(query?.decoration).toBe('none');
  });

  test(`${target.name}: table cell focus and its dropdowns do not print`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr><th><p>Head</p></th><th><p>Two</p></th></tr><tr><td><p>Cell</p></td><td><p>Other</p></td></tr></tbody></table>',
    );
    await page.locator(`${EDITOR} td p`).first().click();
    const focused = page.locator(`${EDITOR} .dm-cell-focused`);
    await expect(focused).toHaveCount(1);

    await page.emulateMedia({ media: 'print' });
    // The focus ring is an editing affordance on a real cell: the cell keeps
    // its border, it just stops being the selected one.
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe('none');

    // The cell toolbar's dropdowns are written into the DOM by the node view
    // and carry inline display, the same fight as the handles.
    for (const selector of [
      '.dm-table-controls-dropdown',
      '.dm-table-cell-dropdown',
      '.dm-table-cell-align-dropdown',
    ]) {
      const display = await styleOf(page, selector, 'display');
      if (display !== null) expect(display).toBe('none');
    }
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: an image's resize handles do not print`, async ({ page }) => {
    await openDemo(page, target);
    await setContent(
      page,
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAhklEQVR4nO3QQQkAIADAQHvZztC+baEwDxZg3Jhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K0OrqfNIotgRa0AAAAASUVORK5CYII=" width="120" />',
    );
    await page.locator(`${EDITOR} img`).first().click();
    await page.waitForTimeout(200);

    await page.emulateMedia({ media: 'print' });
    const handles = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.dm-image-handle')).map(
        (el) => getComputedStyle(el).display,
      ),
    );
    await page.emulateMedia({ media: null });

    // Absent is as good as hidden, but if they exist they must be gone.
    for (const display of handles) expect(display).toBe('none');
  });

  test(`${target.name}: chrome that only exists mid-gesture is hidden too`, async ({ page }) => {
    // A drop indicator lives for the length of a drag, a live region for the
    // length of an announcement, a pending link for the length of a popover.
    // None can be held open while the media switches, so each is measured on
    // a stand-in carrying the production class.
    await openDemo(page, target);
    const chrome = [
      'dm-block-drop-indicator',
      'dm-live-region',
      'dm-notion-color-picker',
      'dm-emoji-picker-host',
    ];
    await page.evaluate((classes) => {
      for (const name of classes) {
        const el = document.createElement('div');
        el.className = name;
        el.id = `gesture-${name}`;
        el.setAttribute('data-show', '');
        el.textContent = 'x';
        document.body.appendChild(el);
      }
      // The pending-link decoration lives INSIDE the document, so it needs
      // the editor's scoping. It goes in a stand-in shell rather than the
      // live editor: ProseMirror's DOM observer reverts foreign nodes put
      // into its contenteditable before they can be measured.
      const shell = document.createElement('div');
      shell.className = 'dm-editor';
      shell.id = 'gesture-shell';
      const content = document.createElement('div');
      content.className = 'ProseMirror';
      content.innerHTML = '<span class="dm-link-pending" id="gesture-pending">linking</span>';
      shell.appendChild(content);
      document.body.appendChild(shell);
    }, chrome);

    await page.emulateMedia({ media: 'print' });
    const hidden = await page.evaluate(
      (classes) =>
        classes.map((name) => {
          const el = document.getElementById(`gesture-${name}`);
          return el ? getComputedStyle(el).display : 'missing';
        }),
      chrome,
    );
    const pending = await page.evaluate(() => {
      const el = document.getElementById('gesture-pending');
      if (!el) return null;
      const style = getComputedStyle(el);
      return { display: style.display, decoration: style.textDecorationLine };
    });
    await page.emulateMedia({ media: null });
    await page.evaluate((classes) => {
      for (const name of classes) document.getElementById(`gesture-${name}`)?.remove();
      document.getElementById('gesture-shell')?.remove();
    }, chrome);

    expect(hidden).toEqual(chrome.map(() => 'none'));
    // The words being linked stay; only the in-progress underline goes.
    expect(pending?.display).not.toBe('none');
    expect(pending?.decoration).toBe('none');
  });

  test(`${target.name}: body-mounted popovers are hidden on paper`, async ({ page }) => {
    // The link, image and math popovers mount on `document.body`, outside the
    // editor entirely, so the isolation rules would not reach them: they need
    // their own line in the sheet. Measured on stand-ins, since raising all
    // three for real means driving three unrelated flows to read one computed
    // value each.
    await openDemo(page, target);
    const selectors = ['dm-link-popover', 'dm-image-popover', 'dm-math-popover', 'dm-emoji-picker'];
    await page.evaluate((classes) => {
      for (const name of classes) {
        const el = document.createElement('div');
        el.className = name;
        el.setAttribute('data-show', '');
        el.id = `probe-${name}`;
        el.textContent = 'chrome';
        document.body.appendChild(el);
      }
    }, selectors);

    await page.emulateMedia({ media: 'print' });
    const printed = await page.evaluate(
      (classes) =>
        classes.map((name) => {
          const el = document.getElementById(`probe-${name}`);
          return el ? getComputedStyle(el).display : 'missing';
        }),
      selectors,
    );
    await page.emulateMedia({ media: null });
    await page.evaluate((classes) => {
      for (const name of classes) document.getElementById(`probe-${name}`)?.remove();
    }, selectors);

    expect(printed).toEqual(selectors.map(() => 'none'));
  });

  test(`${target.name}: a wide formula is not clipped off the sheet`, async ({ page }) => {
    // The math block scrolls on BOTH axes on screen, so a long equation is
    // cut at the frame edge on paper: the same silent loss as the accordion,
    // in a place nobody thinks to check.
    await openDemo(page, target);
    await setContent(
      page,
      `<div data-type="math-block" data-latex="${'x + '.repeat(60)}x"></div>`,
    );
    const block = page.locator(`${EDITOR} .dm-math-block`);
    await expect(block).toHaveCount(1);

    const clipped = await block.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      spill: el.scrollWidth - el.clientWidth,
    }));
    // Precondition: it really does overflow on screen.
    expect(clipped.spill).toBeGreaterThan(0);

    await page.emulateMedia({ media: 'print' });
    const onPaper = await block.evaluate((el) => getComputedStyle(el).overflowX);
    await page.emulateMedia({ media: null });
    expect(onPaper).toBe('visible');
  });

  test(`${target.name}: the inline table of contents stays as content, minus its panel`, async ({
    page,
  }) => {
    // A rule that keeps something rather than hiding it, and the only rule in
    // the sheet that MOVED here from another partial, which makes it the
    // easiest one to lose by accident.
    //
    // A ticked task item deliberately has no assertion beside it: Chromium
    // computes `print-color-adjust: exact` for form controls on its own, so
    // the sheet's checkbox rule changes nothing that can be measured here.
    // The rule stays as insurance for other engines and says so.
    await openDemo(page, target);
    await setContent(page, '<p>A document with an outline.</p>');

    await page.emulateMedia({ media: 'print' });
    const toc = await page.evaluate(() => {
      const editor = document.querySelector('.dm-editor .ProseMirror');
      if (!editor) return null;
      const probe = document.createElement('div');
      probe.className = 'dm-toc-block';
      probe.id = 'toc-probe';
      editor.appendChild(probe);
      const style = getComputedStyle(probe);
      const result = { display: style.display, background: style.backgroundColor };
      probe.remove();
      return result;
    });
    await page.emulateMedia({ media: null });

    expect(toc?.display).not.toBe('none');
    expect(toc?.background).toBe('rgba(0, 0, 0, 0)');
  });

  test(`${target.name}: without isolation the host page still prints`, async ({ page }) => {
    // The default has to stay conservative: an editor embedded in an article
    // may not erase the article when the reader prints the page.
    await openDemo(page, target);
    await page.evaluate(() => {
      const chrome = document.createElement('aside');
      chrome.id = 'host-chrome';
      chrome.textContent = 'Host application sidebar';
      document.body.appendChild(chrome);
    });

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '#host-chrome', 'display')).not.toBe('none');
    await page.emulateMedia({ media: null });
  });
}
