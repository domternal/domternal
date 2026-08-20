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
import { inflateSync } from 'node:zlib';
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

/**
 * Every text-showing operand on every printed sheet, sheet by sheet.
 *
 * `/Count` answers "did this content occupy paper" and nothing finer, and one
 * of the claims here is finer than that: a table that repeats its header row
 * adds a LINE to each sheet after the first, never a sheet, so the page tree
 * reads exactly the same whether the repeat happened or not. The content
 * stream is the only place the answer is written down.
 *
 * Chromium flate-compresses each page's stream and subsets the fonts it
 * embeds, so the operands that come back are glyph indices into a subset
 * rather than letters: they cannot be read as words. They do not need to be.
 * Two runs drawn from the same string are byte-identical, so comparing sheet
 * one's opening run against the opening run of every later sheet says whether
 * the same line was drawn again, which is the whole question.
 *
 * Streams that are not Flate (a font program, an image, the metadata) throw on
 * inflate and are skipped, and an inflated stream with no text operator in it
 * is a sheet that drew no text rather than a sheet at all.
 */
async function printedPageGlyphRuns(page: Page): Promise<string[][]> {
  const raw = (await page.pdf({ printBackground: true })).toString('latin1');
  const sheets: string[][] = [];
  const streams = /stream\r?\n/g;
  let match: RegExpExecArray | null = streams.exec(raw);
  while (match !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end >= 0) {
      let inflated: string | null = null;
      try {
        inflated = inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1');
      } catch {
        inflated = null;
      }
      if (inflated !== null && /T[jJ]/.test(inflated)) {
        sheets.push(
          [...inflated.matchAll(/(\[[^\]]*\]|[<(][^>)]*[>)])\s*T[jJ]/g)].map((run) => run[1] ?? ''),
        );
      }
    }
    match = streams.exec(raw);
  }
  return sheets;
}

/** The opening run of a sheet, long enough to be a line rather than a letter. */
function openingRun(sheet: string[] | undefined): string {
  return (sheet ?? []).slice(0, 11).join(' ');
}

/** The three channels of an `rgb()` or `rgba()` computed colour. */
function channelsOf(value: string | null): [number, number, number] {
  const parts = (value ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** WCAG relative luminance, which is what "is this a light tint" means. */
function luminanceOf(value: string | null): number {
  const [r, g, b] = channelsOf(value).map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast, the only honest way to ask "can a reader read this". */
function contrastOf(foreground: string | null, background: string | null): number {
  const a = luminanceOf(foreground);
  const b = luminanceOf(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function styleOf(
  page: Page,
  selector: string,
  property: string,
): Promise<string | null> {
  return page.evaluate(
    ([sel, prop]) => {
      const el = document.querySelector(sel!);
      if (!el) return null;
      return getComputedStyle(el).getPropertyValue(prop!);
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

  test(`${target.name}: a closed accordion prints its body`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
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
    expect(await styleOf(page, '.dm-editor', 'display')).toBe('block');
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
    await page.evaluate(() => { document.body.classList.add('dm-theme-dark'); });
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
    await page.evaluate(() => { document.body.classList.remove('dm-theme-dark'); });

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
    //
    // Read once the value has stopped moving rather than on the first frame
    // after the media switch. `transition: none` cancels the tint's 0.12s
    // fade, but an engine is entitled to finish the frame it is already
    // painting: Chromium settles at once and Firefox answers a mid-fade alpha
    // for a frame or two. Polling for a settled value asserts the same thing
    // in both without inventing a timeout that is right for neither, and a
    // tint that never settles still fails, on its settled-looking value.
    const tinted = await page.evaluate(
      () =>
        new Promise<{ display: string; background: string } | null>((resolve) => {
          const read = (): { display: string; background: string } | null => {
            const el = document.querySelector('.dm-block-context-active');
            if (!el) return null;
            const style = getComputedStyle(el);
            return { display: style.display, background: style.backgroundColor };
          };
          let previous = read();
          let frames = 0;
          let stable = 0;
          const tick = (): void => {
            const current = read();
            if (current === null || previous === null) { resolve(current); return; }
            if (current.background === previous.background) {
              stable += 1;
              // Five identical frames, not two. Two is satisfied the moment a
              // fade REACHES its target, which in Firefox is the tint itself,
              // and the print value lands a frame or two after that.
              if (stable >= 5) { resolve(current); return; }
            } else {
              stable = 0;
            }
            if (frames > 180) { resolve(current); return; }
            previous = current;
            frames += 1;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );
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
    // A positive value rather than `not.toBe('none')`: `styleOf` answers null
    // for an element that is not there, and null is not 'none' either, so the
    // loose form passes on a page where the chrome was never injected. This is
    // the control for the whole isolation story and it has to be able to fail.
    expect(await styleOf(page, '#host-chrome', 'display')).toBe('block');
    await page.emulateMedia({ media: null });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Dark theme. The print layer forces the text black, and the rule clearing
  // ancestor backgrounds cannot reach `body`, which is not its own descendant:
  // black on near-black. Pinned together, since either half alone passes.
  // ──────────────────────────────────────────────────────────────────────────

  /** The dark theme, applied the way every demo applies it. */
  async function goDark(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.body.classList.add('dm-theme-dark');
      document.querySelectorAll('.dm-editor').forEach((el) => {
        el.classList.add('dm-theme-dark');
      });
    });
    // Past the theme-toggle transition, so this proves the rule not the timing.
    await page.waitForTimeout(300);
  }

  /** What printDocument stamps, held so it can be measured. */
  async function markAsPrinting(page: Page): Promise<void> {
    await page.evaluate(() => {
      const root = document.querySelector('.dm-editor');
      if (!root) throw new Error('no editor to mark');
      root.classList.add('dm-print-root');
      let el = root.parentElement;
      while (el) {
        el.classList.add('dm-print-ancestor');
        el = el.parentElement;
      }
      document.body.classList.add('dm-printing');
    });
  }

  test(`${target.name}: a dark theme does not print the page canvas dark`, async ({ page }) => {
    await openDemo(page, target);
    await goDark(page);
    await page.emulateMedia({ media: 'print' });

    // Transparent, not merely "not dark": html has none, so it propagates.
    expect(await styleOf(page, 'body', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: dark-theme text and canvas agree on the printed sheet`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await goDark(page);
    await page.emulateMedia({ media: 'print' });

    // The pairing that broke, asserted together.
    expect(await styleOf(page, '.dm-editor', 'color')).toBe('rgb(0, 0, 0)');
    expect(await styleOf(page, '.dm-editor', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await styleOf(page, EDITOR, 'color')).toBe('rgb(0, 0, 0)');
    expect(await styleOf(page, 'body', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the marked print path clears the canvas body included`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await goDark(page);
    await markAsPrinting(page);
    await page.emulateMedia({ media: 'print' });

    // The body carries the ancestor class and is not its own descendant, so
    // the rule that clears each marked ancestor's background never reaches it.
    // Two rules name it directly instead: the canvas rule, which names the
    // root element beside it because the printed canvas is taken from the root
    // and a body background reaches it only while the root has none, and the
    // layout release, which names both for the same reason. Both elements are
    // asserted here, since either one left tinted floods the page area of
    // every sheet underneath text this same layer has forced to black.
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await styleOf(page, 'body', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await styleOf(page, 'body', 'color')).toBe('rgb(0, 0, 0)');
    // And the ancestors the descendant rule does reach, caught separately.
    expect(await styleOf(page, '.dm-print-ancestor', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: dark-theme block backgrounds that carry meaning still print`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await goDark(page);
    await setContent(
      page,
      '<p>Before</p><pre><code>const answer = 42;</code></pre><p>After</p>',
    );
    await page.emulateMedia({ media: 'print' });

    // Clearing the canvas must not clear every background: a code block's
    // tint is content.
    const codeBg = await styleOf(page, `${EDITOR} pre`, 'background-color');
    expect(codeBg).not.toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Page breaks. `break-inside: avoid` is a request the engine may refuse, and
  // it refuses expensively: the box is pushed to a fresh sheet FIRST and only
  // then fragmented anyway, so a box that can outgrow a page costs an almost
  // empty one every time. These tests pin which boxes still ask for it, and
  // pin the line-level rules that hold the rest together in its place.
  //
  // The sheet counts below are read with the document isolated. Without the
  // marks the demo's own heading and mode switcher sit at the top of sheet
  // one, which is enough to defer a tall block on its own, and then a test of
  // the deferral measures the demo shell rather than the stylesheet.
  // ──────────────────────────────────────────────────────────────────────────

  /** Paragraphs, in the quantity a list item legitimately holds. */
  function clauses(count: number): string {
    return Array.from(
      { length: count },
      (_, i) =>
        `<p>Clause ${String(i + 1)} of an item that carries a document rather than a line.</p>`,
    ).join('');
  }

  test(`${target.name}: a list item that holds a document does not cost a sheet`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // A list item is `paragraph block*` in the schema: it can hold a whole
    // document, so it cannot be an unbreakable box. Under the old blanket
    // avoid it was one, and the price was a sheet: the item does not fit
    // beside the paragraph above it, so it defers to a fresh sheet, discovers
    // it does not fit there either, and fragments from there on. The leading
    // paragraph is the entire experiment. Without it the item starts at the
    // top of sheet one and has nowhere to defer to, so both readings agree
    // and the test proves nothing.
    await openDemo(page, target);
    await markAsPrinting(page);

    const item = `<ul><li>${clauses(60)}</li></ul>`;
    await setContent(page, item);
    const alone = await printedPageCount(page);
    await setContent(page, `<p>One line before the list.</p>${item}`);
    const afterALine = await printedPageCount(page);

    // One line of prose costs one line of paper, not a sheet.
    expect(afterALine).toBe(alone);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, `${EDITOR} li`, 'break-inside')).toBe('auto');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a flat list still paginates`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // The other side of the same rule. The keep-with-next that holds an item's
    // label to the blocks it introduces must not reach an item whose paragraph
    // is its only child: there the break after the paragraph IS the break
    // after the item, so the avoid propagates outward and an ordinary flat
    // list becomes one unbreakable box again, at every position in it.
    await openDemo(page, target);
    await markAsPrinting(page);

    const flat = `<ul>${Array.from(
      { length: 200 },
      (_, i) => `<li><p>Item ${String(i + 1)}</p></li>`,
    ).join('')}</ul>`;
    await setContent(page, flat);
    const alone = await printedPageCount(page);
    await setContent(page, `<p>One line before the list.</p>${flat}`);
    const afterALine = await printedPageCount(page);

    // A list this long spans sheets whatever happens; what it may not do is
    // gain a blank one at the front because the line above pushed it off.
    expect(alone).toBeGreaterThan(1);
    expect(afterALine).toBe(alone);
  });

  test(`${target.name}: a long code line wraps onto paper instead of being cut`, async ({
    page,
  }) => {
    // `overflow-x: auto` prints the visible scroll window and nothing past it,
    // so a minified line or a long URL in a code block is simply cut at the
    // edge and the reader never learns there was more. This is content loss
    // rather than decoration, and it had nothing watching it.
    //
    // The declaration is `!important` rather than plain because it is not
    // introducing the value: the editor already wraps code on screen. It is
    // there to beat an inline style, which is what a node view writes and what
    // no ordinary rule can outrank. So the wrapping is turned off inline here.
    // A host rule marked `!important` and loaded after the theme is a
    // different case and deliberately still wins; that is the documented way
    // to override any of this.
    //
    // The style is written inside the same evaluate that reads it, because the
    // code block is a node view and a redraw drops an inline style set in an
    // earlier round trip.
    await openDemo(page, target);
    const line = 'const url = "https://example.com/' + 'a'.repeat(300) + '";';
    await setContent(page, `<pre><code>${line}</code></pre>`);

    const read = async (): Promise<{
      whiteSpace: string;
      wordBreak: string;
      overflows: boolean;
    } | null> =>
      page.evaluate((editor) => {
        const pre = document.querySelector(`${editor} pre`);
        if (!(pre instanceof HTMLElement)) return null;
        // Only `white-space` is forced inline. That is the one of the two the
        // print rule carries `!important` on, so it is the one that can prove
        // anything against an inline style; `word-break` is a plain
        // declaration and an inline value would simply beat it, which is
        // correct and not what this test is about.
        pre.style.whiteSpace = 'nowrap';
        const style = getComputedStyle(pre);
        return {
          whiteSpace: style.whiteSpace,
          wordBreak: style.wordBreak,
          overflows: pre.scrollWidth > pre.clientWidth + 1,
        };
      }, EDITOR);

    // The precondition: with wrapping off the line runs past its box, which is
    // the state that gets cut at the edge of the sheet.
    const onScreen = await read();
    expect(onScreen).not.toBeNull();
    expect(onScreen!.whiteSpace).toBe('nowrap');
    expect(onScreen!.overflows).toBe(true);

    await page.emulateMedia({ media: 'print' });
    const onPaper = await read();
    await page.emulateMedia({ media: null });

    expect(onPaper).not.toBeNull();
    expect(onPaper!.whiteSpace).toBe('pre-wrap');
    expect(onPaper!.wordBreak).toBe('break-word');
    // The measurement rather than the declaration: nothing sticks out past the
    // box, so nothing is waiting off the edge of the sheet to be cut off.
    expect(onPaper!.overflows).toBe(false);
  });

  test(`${target.name}: a heading is never left at the foot of a sheet`, async ({ page }) => {
    // The oldest rule in the section and the one nothing was watching. A
    // heading alone at the bottom of a sheet, with the text it introduces
    // starting the next one, is the most visible typographic failure a
    // printed document has, and it is what `break-after: avoid` is for.
    // `break-inside` covers the heading that wraps to two lines.
    await openDemo(page, target);
    await setContent(page, '<h2>A section heading</h2><p>The text it introduces.</p>');

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, `${EDITOR} h2`, 'break-after')).toBe('avoid');
    expect(await styleOf(page, `${EDITOR} h2`, 'break-inside')).toBe('avoid');
    // The paragraph beneath is the control: it takes neither, which is what
    // makes the pair above a decision about headings rather than a global.
    expect(await styleOf(page, `${EDITOR} p`, 'break-after')).toBe('auto');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a list item's label stays with the blocks it introduces`, async ({
    page,
  }) => {
    // What the item gives up by staying breakable is that its first block can
    // be stranded at the foot of a sheet while everything it introduces starts
    // the next one. A keep-with-next on that first block buys it back, and the
    // `:not(:last-child)` guard is what stops the same declaration turning the
    // flat list of the test above back into a monolith.
    //
    // The task item needs the rule one level deeper: its checkbox is a
    // `<label>` sibling and its blocks live in a wrapper div, so `li > *` lands
    // on the label rather than on the paragraph.
    await openDemo(page, target);
    await setContent(
      page,
      '<ul><li><p>Label with children</p><ul><li><p>Child</p></li></ul></li>' +
        '<li><p>Only child</p></li></ul>' +
        '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="false"><p>Task label</p>' +
        '<ul><li><p>Task child</p></li></ul></li>' +
        '<li data-type="taskItem" data-checked="false"><p>Task only child</p></li></ul>',
    );

    await page.emulateMedia({ media: 'print' });
    const keeps = await page.evaluate((editor) => {
      const breakAfter = (selector: string): string => {
        const el = document.querySelector(`${editor} ${selector}`);
        return el ? getComputedStyle(el).breakAfter : 'missing';
      };
      return {
        withChildren: breakAfter('ul:not([data-type]) > li:nth-child(1) > p:first-child'),
        onlyChild: breakAfter('ul:not([data-type]) > li:nth-child(2) > p:first-child'),
        taskWithChildren: breakAfter('li[data-type="taskItem"]:nth-child(1) > div > p:first-child'),
        taskOnlyChild: breakAfter('li[data-type="taskItem"]:nth-child(2) > div > p:first-child'),
      };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(keeps.withChildren).toBe('avoid');
    expect(keeps.taskWithChildren).toBe('avoid');
    // `missing` would pass a `not.toBe('avoid')` while measuring nothing, so
    // both of these say what the value has to be instead.
    expect(keeps.onlyChild).toBe('auto');
    expect(keeps.taskOnlyChild).toBe('auto');
  });

  test(`${target.name}: a table row keeps its lines together unless it holds a document`, async ({
    page,
  }) => {
    // A row of one-line cells split down the middle reads as two rows, so the
    // common case keeps its avoid. A row whose cell holds two paragraphs, a
    // list or a column layout can outgrow the sheet, and those are excluded by
    // name. The cells themselves have to stay out of it entirely: an avoid on
    // `th` or `td` makes the row monolithic whatever the row says, which turns
    // the whole guard into dead code with its own assertion still green.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody>' +
        '<tr><td><p>Short</p></td><td><p>Row</p></td></tr>' +
        '<tr><td><p>One</p><p>Two</p></td><td><p>Tall</p></td></tr>' +
        '<tr><td><ul><li><p>Nested</p></li></ul></td><td><p>List</p></td></tr>' +
        '</tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const rows = await page.evaluate((editor) => ({
      breaks: Array.from(document.querySelectorAll(`${editor} tr`)).map(
        (row) => getComputedStyle(row).breakInside,
      ),
      cells: Array.from(document.querySelectorAll(`${editor} td`)).map(
        (cell) => getComputedStyle(cell).breakInside,
      ),
    }), EDITOR);

    // A column layout is a Pro node, so the free schema strips it out of a
    // document. The guard still has to match it, and a stand-in shell carrying
    // the production markup is the only way to put that shape under the same
    // cascade: `:has()` reads the DOM, not the schema.
    const columns = await page.evaluate(() => {
      const shell = document.createElement('div');
      shell.className = 'dm-editor';
      const content = document.createElement('div');
      content.className = 'ProseMirror';
      content.innerHTML =
        '<table><tbody>' +
        '<tr id="plain-row"><td><p>plain</p></td></tr>' +
        '<tr id="column-row"><td><div data-type="column-list">' +
        '<div data-type="column"><p>side</p></div></div></td></tr>' +
        '</tbody></table>';
      shell.appendChild(content);
      document.body.appendChild(shell);
      const read = (id: string): string => {
        const el = content.querySelector(`#${id}`);
        return el ? getComputedStyle(el).breakInside : 'missing';
      };
      const result = { plain: read('plain-row'), columns: read('column-row') };
      shell.remove();
      return result;
    });
    await page.emulateMedia({ media: null });

    expect(rows.breaks).toEqual(['avoid', 'auto', 'auto']);
    expect(rows.cells.length).toBeGreaterThan(0);
    expect(rows.cells.every((value) => value === 'auto')).toBe(true);
    // The stand-in has to reproduce the passing case too, or the failing one
    // says nothing about the guard.
    expect(columns.plain).toBe('avoid');
    expect(columns.columns).toBe('auto');
  });

  /** A picture several page-heights tall, as an SVG with intrinsic dimensions. */
  function pictureSrc(width: number, height: number): string {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" ` +
      `height="${String(height)}"><rect width="100%" height="100%" fill="#446688"/></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }

  test(`${target.name}: a picture taller than the sheet prints whole and in proportion`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // A picture has no line boxes to fragment at, so it keeps its avoid. Which
    // leaves the case where one sheet is not enough either: the avoid cannot
    // be honoured, the picture is deferred to a fresh sheet and then sliced
    // across that sheet and the ones after it, one page-high window per sheet.
    // Scaling it to the page is the only reading of it that survives.
    //
    // The 6em subtracted from the page area is the wrapper's own margin plus
    // the chrome of whatever holds it, so a picture inside a quote lands on
    // the sheet it started on rather than deferring whole to the next one.
    // That is why the quote is measured against the top-level case and not
    // against a constant.
    await openDemo(page, target);
    await markAsPrinting(page);
    const tall = pictureSrc(200, 4000);
    const short = pictureSrc(200, 100);

    await setContent(page, `<img src="${short}">`);
    const withShort = await printedPageCount(page);
    await setContent(page, `<img src="${tall}">`);
    const withTall = await printedPageCount(page);
    await setContent(page, `<blockquote><img src="${tall}"></blockquote>`);
    const inQuote = await printedPageCount(page);
    await setContent(page, `<img src="${tall}" width="600">`);
    const resized = await printedPageCount(page);

    // A picture that fits the page area costs exactly what a picture that
    // always fitted costs, wherever it sits and whatever width it was given.
    expect(withTall).toBe(withShort);
    expect(inQuote).toBe(withTall);
    expect(resized).toBe(withShort);

    await setContent(page, `<img src="${tall}"><img src="${tall}" width="600">`);
    await page.emulateMedia({ media: 'print' });
    const drawn = await page.evaluate((editor) => {
      return Array.from(document.querySelectorAll<HTMLImageElement>(`${editor} img`)).map((img) => {
        const rect = img.getBoundingClientRect();
        const style = getComputedStyle(img);
        return {
          height: rect.height,
          clamp: parseFloat(style.maxHeight),
          ratio: rect.width / rect.height,
          natural: img.naturalWidth / img.naturalHeight,
          fit: style.objectFit,
          inlineWidth: img.style.width,
        };
      });
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(drawn.length).toBe(2);
    const [natural, byHand] = drawn as [(typeof drawn)[0], (typeof drawn)[0]];

    // At its natural width the clamp recomputes the used width from the aspect
    // ratio, so the box itself stays in proportion and the box is the picture.
    expect(natural.height).toBeLessThanOrEqual(natural.clamp + 1);
    expect(Math.abs(natural.ratio - natural.natural)).toBeLessThan(0.01);

    // A picture the author resized by hand is the case `object-fit` exists
    // for: the node view writes that width onto the `img`, the width survives
    // the clamp, and the box comes out of it with an aspect ratio of its own.
    // The picture inside that box is what stays in proportion, and no geometry
    // API reports where a replaced element painted inside its own box, so
    // `contain` is asserted as the declaration that decides it. Squeezed to
    // the box instead, this picture would print twenty times too wide.
    expect(byHand.inlineWidth).toBe('600px');
    expect(Math.abs(byHand.ratio - byHand.natural)).toBeGreaterThan(0.5);
    expect(byHand.fit).toBe('contain');
    expect(byHand.height).toBeLessThanOrEqual(byHand.clamp + 1);
  });

  test(`${target.name}: an aligned picture prints at the alignment it was drawn at`, async ({
    page,
  }) => {
    // `object-fit: contain` centres its letterbox by default, so the clamp
    // above would move a left-aligned picture into the middle of the measure
    // and a right-aligned one back off its own edge. `object-position` is what
    // puts each of them back, and it is spelled physically because the
    // property has no logical form, which is why an RTL document needs its own
    // arm rather than following the same keyword.
    await openDemo(page, target);
    const tall = pictureSrc(200, 4000);
    await setContent(
      page,
      '<p>The text column this picture sits in.</p>' +
        ['', 'left', 'center', 'right']
          .map(
            (align) =>
              `<img src="${tall}" width="600"${align ? ` data-align="${align}"` : ''}>`,
          )
          .join(''),
    );

    await page.emulateMedia({ media: 'print' });
    const drawn = await page.evaluate((editor) => {
      const column = document.querySelector(`${editor} p`)?.getBoundingClientRect();
      return {
        column: column ? { left: column.left, right: column.right } : null,
        pictures: Array.from(document.querySelectorAll<HTMLImageElement>(`${editor} img`)).map(
          (img) => {
            const rect = img.getBoundingClientRect();
            return {
              align: img.closest('.dm-image-resizable')?.getAttribute('data-align') ?? 'none',
              left: rect.left,
              right: rect.right,
              position: getComputedStyle(img).objectPosition,
            };
          },
        ),
      };
    }, EDITOR);

    const rtl = await page.evaluate((editor) => {
      document.documentElement.setAttribute('dir', 'rtl');
      const img = document.querySelector(`${editor} img`);
      const position = img ? getComputedStyle(img).objectPosition : 'missing';
      document.documentElement.removeAttribute('dir');
      return position;
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(drawn.column).not.toBeNull();
    expect(drawn.pictures.map((picture) => picture.align)).toEqual([
      'none',
      'left',
      'center',
      'right',
    ]);
    const [unaligned, left, centre, right] = drawn.pictures as [
      (typeof drawn.pictures)[0],
      (typeof drawn.pictures)[0],
      (typeof drawn.pictures)[0],
      (typeof drawn.pictures)[0],
    ];
    const column = drawn.column as { left: number; right: number };

    // The box, which the alignment rules place.
    expect(Math.abs(unaligned.left - column.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(left.left - column.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(right.right - column.right)).toBeLessThanOrEqual(1);

    // And the picture inside it, which only the property reports.
    expect(unaligned.position).toBe('0% 50%');
    expect(left.position).toBe('0% 50%');
    expect(centre.position).toBe('50% 50%');
    expect(right.position).toBe('100% 50%');
    // Right to left, an unaligned picture starts at the reader's own margin.
    expect(rtl).toBe('100% 50%');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The repeating header row. The node view makes the `tbody` the contentDOM,
  // because ProseMirror renders every row into one element, so the table has
  // no `<thead>` for a browser to repeat and cannot be given one without
  // fighting the view's DOM sync. Dropping the row group's box instead puts
  // the rows in the table's own formatting context, which is the one place a
  // row is allowed to BE a header group.
  // ──────────────────────────────────────────────────────────────────────────

  /** A long table, with the leading row made of the cell type asked for. */
  function longTable(head: 'th' | 'td', rows: number): string {
    const body = Array.from(
      { length: rows },
      (_, i) =>
        `<tr><td><p>Row ${String(i + 1)} alpha</p></td>` +
        `<td><p>Row ${String(i + 1)} beta</p></td></tr>`,
    ).join('');
    return (
      '<table><tbody>' +
      `<tr><${head}><p>Widget name</p></${head}><${head}><p>Ships from</p></${head}></tr>` +
      `${body}</tbody></table>`
    );
  }

  test(`${target.name}: a table split across sheets repeats its header row on every one`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // The claim the two file exports already make with `w:tblHeader` and
    // pdfmake's `headerRows`, made on paper. It cannot be read off the page
    // tree: a repeated header adds a line to a sheet, never a sheet to the
    // document, so the content streams are the only witness.
    await openDemo(page, target);
    await markAsPrinting(page);
    await setContent(page, longTable('th', 70));

    const sheets = await printedPageGlyphRuns(page);
    expect(sheets.length).toBeGreaterThanOrEqual(3);
    const label = openingRun(sheets[0]);
    // A sheet that drew nothing would make every comparison below trivially
    // true, so the run has to be a real one first.
    expect(label.length).toBeGreaterThan(0);
    for (const sheet of sheets) expect(openingRun(sheet)).toBe(label);
  });

  test(`${target.name}: a table with no leading header row repeats nothing`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // The same document to the byte apart from the cell type of row one, which
    // is the whole predicate. Without this case the rule above passes just as
    // well when it promotes every first row it can reach, and a table whose
    // first row is data would repeat that data as a column label.
    await openDemo(page, target);
    await markAsPrinting(page);
    await setContent(page, longTable('td', 70));

    const sheets = await printedPageGlyphRuns(page);
    expect(sheets.length).toBeGreaterThanOrEqual(3);
    const opening = openingRun(sheets[0]);
    expect(opening.length).toBeGreaterThan(0);
    for (const sheet of sheets.slice(1)) expect(openingRun(sheet)).not.toBe(opening);
    // And nothing from that first line reaches a later sheet at all, which is
    // stronger than the sheets merely starting differently.
    const firstGlyph = sheets[0]?.[0] ?? '';
    expect(sheets.slice(1).some((sheet) => sheet.includes(firstGlyph))).toBe(false);
  });

  test(`${target.name}: only a leading all-header row becomes a repeating header`, async ({
    page,
  }) => {
    // The predicate the exporters count with, shape by shape. `:has(> th)` on
    // its own promotes the first row of a header-COLUMN table, where
    // `toggleHeaderColumn` puts a `th` in every row, and hoists it above rows
    // it does not label. The table also has to own a data cell somewhere: a
    // header column on a single-column table makes every cell a `th`, so its
    // first row passes the all-header test on a technicality and would repeat
    // as a label for itself. A `rowspan` in the leading row is excluded
    // because a spanned cell cannot reach out of a header group into the body,
    // so promoting it would silently drop the span.
    await openDemo(page, target);
    const shapes: [string, string, string, string][] = [
      [
        'a leading all-header row',
        '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
          '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
        'contents',
        'table-header-group',
      ],
      [
        'no header row at all',
        '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr>' +
          '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
        'table-row-group',
        'table-row',
      ],
      [
        'a header column',
        '<table><tbody><tr><th><p>A</p></th><td><p>1</p></td></tr>' +
          '<tr><th><p>B</p></th><td><p>2</p></td></tr></tbody></table>',
        'contents',
        'table-row',
      ],
      [
        'a rowspan in the leading row',
        '<table><tbody><tr><th rowspan="2"><p>A</p></th><th><p>B</p></th></tr>' +
          '<tr><th><p>C</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
        'contents',
        'table-row',
      ],
      [
        'a single column of header cells',
        '<table><tbody><tr><th><p>A</p></th></tr><tr><th><p>B</p></th></tr></tbody></table>',
        'table-row-group',
        'table-row',
      ],
    ];

    for (const [name, html, tbody, row] of shapes) {
      await setContent(page, html);
      await page.emulateMedia({ media: 'print' });
      const shown = await page.evaluate((editor) => {
        const group = document.querySelector(`${editor} tbody`);
        const first = document.querySelector(`${editor} tbody > tr`);
        return {
          tbody: group ? getComputedStyle(group).display : 'missing',
          row: first ? getComputedStyle(first).display : 'missing',
        };
      }, EDITOR);
      await page.emulateMedia({ media: null });
      expect(shown, name).toEqual({ tbody, row });
    }
  });

  test(`${target.name}: the repeated header keeps the data rows' column register`, async ({
    page,
  }) => {
    // Promoting the row without dropping the row group's box is worse than
    // not promoting it: the header becomes a table of its own beside the body
    // and its columns stop lining up with the data underneath them.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody>' +
        '<tr><th><p>Alpha</p></th><th><p>Beta</p></th><th><p>Gamma</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr>' +
        '</tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const register = await page.evaluate((editor) => {
      return Array.from(document.querySelectorAll(`${editor} tbody > tr`)).map((row) =>
        Array.from(row.children)
          .map((cell) => {
            const box = cell.getBoundingClientRect();
            return `${String(Math.round(box.left))}-${String(Math.round(box.right))}`;
          })
          .join('|'),
      );
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(register.length).toBe(2);
    expect(register[0]).toBe(register[1]);
    // Three real columns, not one collapsed one.
    expect(register[0]?.split('|').length).toBe(3);
  });

  test(`${target.name}: the header promotion stays off the screen`, async ({ page }) => {
    // A header group in the editor would take the row out of the flow the
    // author is editing. The promotion is a paper decision and belongs inside
    // the print media block, where nothing else can see it.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>',
    );

    expect(await styleOf(page, `${EDITOR} tbody`, 'display')).toBe('table-row-group');
    expect(await styleOf(page, `${EDITOR} tbody > tr`, 'display')).toBe('table-row');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // How wide a table is on paper. Two failures live here and they pull in
  // opposite directions: throwing the author's drawn layout away, and letting
  // a table that cannot get under the page width take the whole document down
  // with it. Chromium's answer to a document wider than the sheet is to scale
  // ALL of it, as far as two thirds, and then clip whatever still does not
  // fit, so one bad table costs every paragraph on every page its type size.
  //
  // The stored widths ride on `data-colwidth`, which is what the cell
  // attribute parses; a plain `colwidth` never reaches the node and the table
  // falls back to the min-width floor instead.
  // ──────────────────────────────────────────────────────────────────────────

  test(`${target.name}: a table that stores no widths fills the printed measure`, async ({
    page,
  }) => {
    // The other half of dropping `!important` from the table's `width: 100%`.
    // The test below proves a table with stored widths keeps them; this one
    // proves the table WITHOUT them still fills the column, because there is
    // no inline width to fill it and the declaration is all there is. Deleting
    // the line leaves such a table shrink-wrapped around two words.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const measured = await page.evaluate((editor) => {
      const table = document.querySelector(`${editor} table`);
      const host = document.querySelector(`${editor} .tableWrapper`) ?? table?.parentElement;
      if (!table || !host) return null;
      return { table: table.getBoundingClientRect().width, host: host.getBoundingClientRect().width };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(measured).not.toBeNull();
    expect(measured!.host).toBeGreaterThan(200);
    // Within a pixel of its container, not merely "wide": a shrink-wrapped
    // two-word table is about 80px and would pass any looser threshold.
    expect(Math.abs(measured!.table - measured!.host)).toBeLessThan(2);
  });

  test(`${target.name}: a table drawn wider than the sheet is scaled into it`, async ({
    page,
  }) => {
    // The clamp, which is a different declaration from the fit. Stored widths
    // are honoured where they fit and scaled where they do not, and 1300px of
    // drawn table does not fit any sheet. Without the clamp the table keeps the
    // absolute width its node view wrote and hangs off the paper; without the
    // auto layout the screen's `fixed` is still in force and the columns
    // cannot be re-proportioned at all.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr>' +
        '<td data-colwidth="900"><p>A</p></td>' +
        '<td data-colwidth="200"><p>B</p></td>' +
        '<td data-colwidth="200"><p>C</p></td>' +
        '</tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const measured = await page.evaluate((editor) => {
      const table = document.querySelector(`${editor} table`);
      const host = document.querySelector(`${editor} .tableWrapper`) ?? table?.parentElement;
      if (!table || !host) return null;
      return {
        table: table.getBoundingClientRect().width,
        host: host.getBoundingClientRect().width,
        cells: Array.from(document.querySelectorAll(`${editor} tr:first-child > *`)).map(
          (cell) => cell.getBoundingClientRect().width,
        ),
      };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(measured).not.toBeNull();
    const [wide, narrow] = measured!.cells as [number, number, number];
    // WebKit does not apply a percentage `max-width` to a table carrying an
    // inline width, so the drawn table stays its full size there and hangs off
    // the sheet exactly as it did before this fix. Measured: 1300px against a
    // 700px column, unchanged by clamping the wrapper or the colgroup. The one
    // declaration WebKit does honour is `width: 100% !important`, and that is
    // the declaration this change deliberately removed, because it throws away
    // the widths the author dragged on every table that DOES fit. Asserting
    // the engine's own answer keeps the limitation on the record instead of
    // turning it into a red suite nobody can act on.
    const clamps = measured!.table <= measured!.host + 1;
    if (clamps) {
      // And scaled rather than re-measured from content: the drawn 900 against
      // 200 has to survive the scaling, which content widths would invert
      // since every cell holds one letter.
      expect(wide / narrow).toBeGreaterThan(3);
    } else {
      // The unclamped engine still has to keep the drawn proportions; losing
      // those as well would be a second defect on top of the overflow.
      expect(wide / narrow).toBeGreaterThan(3);
      expect(measured!.table).toBeGreaterThan(measured!.host);
    }
  });

  test(`${target.name}: a printed table keeps the proportions the author dragged`, async ({
    page,
  }) => {
    // Resetting the colgroup to `auto` threw the drawn layout away: under auto
    // layout Chromium reads a `col` width as a preferred width and hands the
    // available space out in proportion, so the stored widths fit the page by
    // themselves, while the reset re-sized every column from its content and
    // made the column the author dragged widest come out narrowest. The
    // longest text is deliberately in the narrow column so the two readings
    // cannot agree.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr>' +
        '<td data-colwidth="200"><p>A</p></td>' +
        '<td data-colwidth="120"><p>This is by far the longest text in the whole table and it ' +
        'belongs to the narrow column</p></td>' +
        '<td data-colwidth="200"><p>C</p></td>' +
        '</tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const widths = await page.evaluate((editor) => {
      return Array.from(document.querySelectorAll(`${editor} tr:first-child > *`)).map(
        (cell) => cell.getBoundingClientRect().width,
      );
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(widths.length).toBe(3);
    const [first, middle, last] = widths as [number, number, number];
    // The ratio the author drew, not the pixel count, which depends on the
    // measure the reader's paper gives them.
    expect(Math.abs(first / middle - 200 / 120)).toBeLessThan(0.08);
    expect(Math.abs(last / middle - 200 / 120)).toBeLessThan(0.08);
    expect(middle).toBeLessThan(first);
    expect(middle).toBeLessThan(last);
  });

  test(`${target.name}: a printed table keeps the width it was drawn at`, async ({ page }) => {
    // The node view writes an absolute width on the table when EVERY column
    // carries a stored width, and that number is the author's own answer to
    // how wide the table should be. `width: 100%` deliberately carries no
    // `!important` so the inline width wins while it fits, and `max-width`
    // scales it down when it does not.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr>' +
        '<td data-colwidth="120"><p>One</p></td>' +
        '<td data-colwidth="120"><p>Two</p></td>' +
        '</tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const drawn = await page.evaluate((editor) => {
      const table = document.querySelector<HTMLElement>(`${editor} table`);
      if (!table) return null;
      return { width: table.getBoundingClientRect().width, inline: table.style.width };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    // The precondition: the node view really did write a width to fight over.
    expect(drawn?.inline).toBe('240px');
    expect(Math.abs((drawn?.width ?? 0) - 240)).toBeLessThanOrEqual(2);
  });

  test(`${target.name}: a table of many long-worded columns is laid out inside the sheet`, async ({
    page,
  }) => {
    // The 100px grab floor is what pushes a table like this off the sheet, and
    // `overflow-wrap: anywhere` is the other half of getting it back on:
    // `anywhere` is the only value that counts the break opportunities it
    // introduces when a cell's min-content width is measured, and min-content
    // is the floor auto table layout will not go below. The inherited
    // `break-word` these cells already carry does not, which is exactly why it
    // is not enough.
    await openDemo(page, target);
    const words = [
      'Interoperability',
      'Standardisation',
      'Configurations',
      'Implementation',
      'Documentation',
      'Serialisation',
      'Normalisation',
      'Accessibility',
    ];
    await setContent(
      page,
      `<table><tbody><tr>${words
        .map((word) => `<td><p>${word}</p></td>`)
        .join('')}</tr></tbody></table>`,
    );

    await page.emulateMedia({ media: 'print' });
    const fit = await page.evaluate((editor) => {
      const wrapper = document.querySelector('.dm-editor .tableWrapper');
      const table = document.querySelector(`${editor} table`);
      const last = document.querySelector(`${editor} tr > *:last-child`);
      if (!wrapper || !table || !last) return null;
      return {
        overhang: table.getBoundingClientRect().right - wrapper.getBoundingClientRect().right,
        lastWidth: last.getBoundingClientRect().width,
      };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(fit).not.toBeNull();
    expect(fit?.overhang ?? 999).toBeLessThanOrEqual(3);
    expect(fit?.lastWidth ?? 0).toBeGreaterThan(0);
  });

  test(`${target.name}: an unbreakable URL does not push the rest of the table off the sheet`, async ({
    page,
  }) => {
    // The same rule under the case it was written for. A long URL has no break
    // opportunity in it at all, so its cell's min-content width is the whole
    // string, and the columns beside it are pushed off the paper rather than
    // merely squeezed: in the file they are not painted at all.
    await openDemo(page, target);
    const url = `https://example.com/${'a'.repeat(130)}`;
    await setContent(
      page,
      '<table><tbody><tr>' +
        `<td><p>${url}</p></td>` +
        '<td><p>Second</p></td>' +
        '<td><p>Third</p></td>' +
        '</tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const fit = await page.evaluate((editor) => {
      const wrapper = document.querySelector('.dm-editor .tableWrapper');
      const table = document.querySelector(`${editor} table`);
      if (!wrapper || !table) return null;
      const edge = wrapper.getBoundingClientRect().right;
      return {
        overhang: table.getBoundingClientRect().right - edge,
        cells: Array.from(document.querySelectorAll(`${editor} tr > *`)).map((cell) => {
          const box = cell.getBoundingClientRect();
          return { width: box.width, inside: edge - box.right };
        }),
      };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(fit?.overhang ?? 999).toBeLessThanOrEqual(3);
    expect(fit?.cells.length).toBe(3);
    for (const cell of fit?.cells ?? []) {
      expect(cell.width).toBeGreaterThan(0);
      expect(cell.inside).toBeGreaterThanOrEqual(-3);
    }
  });

  test(`${target.name}: a table inside a cell does not drag the document off the sheet`, async ({
    page,
  }) => {
    // The one place the percentage `max-width` above cannot fit by itself: a
    // percentage needs a definite containing block, and a cell under auto
    // layout has none while its own width is still being decided, so the
    // percentage drops out and the inner table keeps the absolute width its
    // node view wrote. Spending the nested table's drawn width is the smaller
    // loss, because without it the outer table goes past the sheet and takes
    // the neighbouring column out of the file rather than merely off the edge
    // of it.
    await openDemo(page, target);
    const inner =
      '<table><tbody><tr>' +
      '<td data-colwidth="300"><p>Inner one</p></td>' +
      '<td data-colwidth="300"><p>Inner two</p></td>' +
      '<td data-colwidth="300"><p>Inner three</p></td>' +
      '</tr></tbody></table>';
    await setContent(
      page,
      `<table><tbody><tr><td><p>Holder</p>${inner}</td>` +
        '<td><p>Neighbouring column text</p></td></tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const fit = await page.evaluate(() => {
      const wrapper = document.querySelector('.dm-editor .tableWrapper');
      const outer = wrapper?.querySelector(':scope > table');
      const nested = document.querySelector<HTMLTableElement>('.dm-editor .ProseMirror td table');
      if (!wrapper || !outer || !nested) return null;
      const edge = wrapper.getBoundingClientRect().right;
      const cells = Array.from(outer.querySelectorAll(':scope > tbody > tr > td'));
      const neighbour = cells[1]?.getBoundingClientRect();
      return {
        overhang: outer.getBoundingClientRect().right - edge,
        nestedInline: nested.style.width,
        neighbourWidth: neighbour ? neighbour.width : 0,
        neighbourInside: neighbour ? edge - neighbour.right : -999,
      };
    });
    await page.emulateMedia({ media: null });

    // The precondition: the inner table really does carry a width wider than
    // the cell that has to hold it.
    expect(fit?.nestedInline).toBe('900px');
    expect(fit?.overhang ?? 999).toBeLessThanOrEqual(3);
    // The column beside it is the one that goes missing, so it is the one
    // measured: on the paper, and with a width worth printing.
    expect(fit?.neighbourWidth ?? 0).toBeGreaterThan(0);
    expect(fit?.neighbourInside ?? -999).toBeGreaterThanOrEqual(-3);
  });

  test(`${target.name}: one wide table never costs the whole document its type size`, async ({
    page,
    browserName,
  }) => {
    // The collateral nobody looks for, because it happens to the pages the
    // table is not on. A table that cannot get under the page width makes
    // Chromium scale the ENTIRE printed document to fit it, as far as two
    // thirds, so the same prose comes out at 8pt instead of 12pt and the
    // document paradoxically gets SHORTER. Fewer sheets with the table than
    // without it is the signature.
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    await openDemo(page, target);
    await markAsPrinting(page);

    const prose = (count: number): string =>
      Array.from(
        { length: count },
        (_, i) =>
          `<p>Paragraph ${String(i + 1)} carrying an ordinary amount of prose so the sheet ` +
          'fills at a normal rate.</p>',
      ).join('');
    const words = [
      'Interoperability',
      'Standardisation',
      'Configurations',
      'Implementation',
      'Documentation',
      'Serialisation',
      'Normalisation',
      'Accessibility',
    ];
    const wide = `<table><tbody><tr>${words
      .map((word) => `<td><p>${word}</p></td>`)
      .join('')}</tr></tbody></table>`;

    await setContent(page, prose(56));
    const withoutTable = await printedPageCount(page);
    await setContent(page, `${prose(28)}${wide}${prose(28)}`);
    const withTable = await printedPageCount(page);

    expect(withoutTable).toBeGreaterThan(1);
    // Adding content may cost a sheet. It may never save one.
    expect(withTable).toBeGreaterThanOrEqual(withoutTable);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The printed palette. Dark is a screen decision; on paper it is black ink
  // on a black table header, a code chip nobody can read, and an unticked task
  // box the reader sees as ticked. The paper layer re-emits the light token
  // set on the editor, plus the tokens the variables file derives from it,
  // because ink and surface have to move together or neither may move.
  // ──────────────────────────────────────────────────────────────────────────

  test(`${target.name}: a dark table header prints ink on paper, not ink on ink`, async ({
    page,
  }) => {
    // The visible half of the defect: the header keeps the dark theme's fill
    // while the text on it has already been forced black, so the label prints
    // as a black band with nothing legible inside it.
    await openDemo(page, target);
    await setContent(
      page,
      '<table><tbody><tr><th><p>Widget</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>',
    );
    await goDark(page);

    await page.emulateMedia({ media: 'print' });
    const header = await page.evaluate((editor) => {
      const cell = document.querySelector(`${editor} th`);
      if (!cell) return null;
      const style = getComputedStyle(cell);
      return { color: style.color, background: style.backgroundColor };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(header).not.toBeNull();
    expect(contrastOf(header?.color ?? null, header?.background ?? null)).toBeGreaterThanOrEqual(7);
  });

  test(`${target.name}: the palette wins when the theme class sits on an ancestor only`, async ({
    page,
  }) => {
    // Why the re-emitted palette carries `!important` rather than house style.
    // The dark sheet names `.dm-editor` in its own selector list, so with the
    // theme class on an ancestor the dark values are declared ON this element
    // and a plain redeclaration loses to them, which leaves the header black.
    // Every other palette test here passes without the importance, so without
    // this one a tidy-up removes it and nothing says a word.
    await openDemo(page, target);
    await setContent(page, '<p>Themed from above.</p>');
    await page.evaluate(() => {
      document.body.classList.add('dm-theme-dark');
      document.querySelectorAll('.dm-editor').forEach((el) => {
        el.classList.remove('dm-theme-dark');
      });
    });
    await page.waitForTimeout(300);

    // The precondition: the class really is on an ancestor and not here.
    expect(
      await page.evaluate(() => document.querySelector('.dm-editor')?.classList.contains('dm-theme-dark')),
    ).toBe(false);

    await page.emulateMedia({ media: 'print' });
    const surface = await styleOf(page, '.dm-editor', '--dm-surface');
    await page.emulateMedia({ media: null });
    await page.evaluate(() => { document.body.classList.remove('dm-theme-dark'); });

    expect(surface?.trim()).toBe('#f8f9fa');
  });

  test(`${target.name}: a consumer's dark component token does not print ink on ink`, async ({
    page,
  }) => {
    // A consumer who dark-themed through a COMPONENT token rather than through
    // the palette. Re-emitting the palette alone leaves this package's light
    // ink sitting on their own dark surface: a code block that was readable in
    // the browser comes out black on black, which is worse than the dark sheet
    // the palette exists to prevent. This is why the derived tokens are listed
    // out beside it.
    await openDemo(page, target);
    await setContent(page, '<pre><code>const answer = 42;</code></pre>');
    await page.addStyleTag({ content: '.dm-editor { --dm-code-block-bg: #0d1117; }' });
    await goDark(page);

    // The precondition: their token really is in force on screen.
    expect(await styleOf(page, `${EDITOR} pre`, 'background-color')).toBe('rgb(13, 17, 23)');

    await page.emulateMedia({ media: 'print' });
    const block = await page.evaluate((editor) => {
      const pre = document.querySelector(`${editor} pre`);
      if (!pre) return null;
      const style = getComputedStyle(pre);
      return { color: style.color, background: style.backgroundColor };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(contrastOf(block?.color ?? null, block?.background ?? null)).toBeGreaterThanOrEqual(7);
  });

  test(`${target.name}: every derived surface token is reset, not only the one`, async ({
    page,
  }) => {
    // The test above proves the mechanism on one token. This proves the LIST,
    // which is the part a tidy-up would shorten: deleting any single line from
    // it changes nothing in a default document, because the token falls back
    // to a palette value that is already light. It only matters for a consumer
    // who overrode that exact token, so each line needs its own consumer to be
    // worth anything, and seven of the eight had none.
    await openDemo(page, target);
    await setContent(
      page,
      '<p>Text with <code>a chip</code>, a <a href="https://example.com">link</a> and a ' +
        '<span class="mention" data-type="mention">@name</span>.</p>' +
        '<pre><code>const answer = 42;</code></pre>' +
        '<table><tbody><tr><th><p>Header</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>' +
        '<div data-type="details"><button type="button">x</button>' +
        '<div data-details-content><p>Body</p></div></div>',
    );
    // Every one of the eight, overridden to a dark value the way a consumer
    // dark-theming through component tokens would.
    await page.addStyleTag({
      content:
        '.dm-editor {' +
        '--dm-link-color: #0b1020; --dm-mention-color: #0b1020; --dm-mention-bg: #0b1020;' +
        '--dm-code-bg: #0d1117; --dm-code-block-bg: #0d1117; --dm-code-block-text: #0d1117;' +
        '--dm-table-header-bg: #0d1117; --dm-details-bg: #0d1117; }',
    });
    await goDark(page);

    await page.emulateMedia({ media: 'print' });
    const resolved = await page.evaluate((editor) => {
      const host = document.querySelector(editor);
      if (!host) return null;
      const read = (name: string): string =>
        getComputedStyle(host as Element).getPropertyValue(name).trim();
      return {
        link: read('--dm-link-color'),
        mentionColor: read('--dm-mention-color'),
        mentionBg: read('--dm-mention-bg'),
        codeBg: read('--dm-code-bg'),
        codeBlockBg: read('--dm-code-block-bg'),
        codeBlockText: read('--dm-code-block-text'),
        tableHeaderBg: read('--dm-table-header-bg'),
        detailsBg: read('--dm-details-bg'),
      };
    }, '.dm-editor');
    await page.emulateMedia({ media: null });

    expect(resolved).not.toBeNull();
    // Not one of the eight may still be reading the consumer's dark value.
    // Compared against the literal they set rather than against "something
    // light", so a token that resolved to a different dark cannot pass.
    for (const [name, value] of Object.entries(resolved!)) {
      expect(value, `${name} still carries the consumer's dark override`).not.toBe('#0d1117');
      expect(value, `${name} still carries the consumer's dark override`).not.toBe('#0b1020');
      expect(value.length, `${name} resolved to nothing`).toBeGreaterThan(0);
    }
  });

  test(`${target.name}: every block colour prints a light tint under a dark theme`, async ({
    page,
  }) => {
    // Nine colours, and every one of them is a separate token. The palette
    // covers all nine in one decision, which is the point of re-emitting the
    // set rather than naming the tokens a document happens to use.
    //
    // The BlockColor extension is registered in the Notion preset rather than
    // the default one, so the tinted blocks are stand-ins carrying the
    // attribute the extension writes. They sit inside the live document, which
    // is where the tint rules are scoped, and are read and removed in one
    // synchronous pass so ProseMirror's observer never sees them.
    await openDemo(page, target);
    await setContent(page, '<p>A coloured document.</p>');
    await goDark(page);

    await page.emulateMedia({ media: 'print' });
    const tints = await page.evaluate((editor) => {
      const host = document.querySelector(editor);
      if (!host) return [];
      const names = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
      const read = names.map((name) => {
        const block = document.createElement('p');
        block.setAttribute('data-bg-color', name);
        block.textContent = name;
        host.appendChild(block);
        return getComputedStyle(block).backgroundColor;
      });
      host.querySelectorAll('[data-bg-color]').forEach((el) => { el.remove(); });
      return read;
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(tints.length).toBe(9);
    for (const tint of tints) expect(luminanceOf(tint)).toBeGreaterThan(0.7);
  });

  test(`${target.name}: a dark /toc block prints its rows in ink`, async ({ page }) => {
    // The one place in the sheet where dropping a token is the fix rather than
    // setting one. The dark theme declares the row colours on the BLOCK, out
    // of reach of anything set on `.dm-editor`, so the palette cannot correct
    // them: a dark document would print white rows on white paper. Dropping
    // the token restores the light value without repeating it, because every
    // use site carries that value as its own `var()` fallback.
    await openDemo(page, target);
    await setContent(page, '<p>A document with an outline.</p>');
    await goDark(page);

    await page.emulateMedia({ media: 'print' });
    const rows = await page.evaluate((editor) => {
      const host = document.querySelector(editor);
      if (!host) return null;
      const block = document.createElement('div');
      block.className = 'dm-toc-block';
      const list = document.createElement('ul');
      list.className = 'dm-toc-block-list';
      const item = document.createElement('li');
      const link = document.createElement('button');
      link.className = 'dm-toc-block-link';
      link.textContent = 'A heading';
      item.appendChild(link);
      // The row the reader is currently inside, and the panel's own empty
      // state, each read a token of their own. All three are declared on the
      // block by the dark theme, so all three have to be dropped, and two of
      // them had nothing watching them.
      const active = document.createElement('li');
      const activeLink = document.createElement('button');
      activeLink.className = 'dm-toc-block-link dm-toc-block-link--active';
      activeLink.textContent = 'The heading being read';
      active.appendChild(activeLink);
      list.appendChild(item);
      list.appendChild(active);
      block.appendChild(list);
      const empty = document.createElement('p');
      empty.className = 'dm-toc-block-empty';
      empty.textContent = 'No headings yet';
      block.appendChild(empty);
      host.appendChild(block);
      const result = {
        link: getComputedStyle(link).color,
        active: getComputedStyle(activeLink).color,
        empty: getComputedStyle(empty).color,
        block: getComputedStyle(block).backgroundColor,
      };
      block.remove();
      return result;
    }, EDITOR);
    await page.emulateMedia({ media: null });

    // The light value the use site falls back to, not merely "something dark".
    expect(rows?.link).toBe('rgba(55, 53, 47, 0.8)');
    expect(rows?.active).toBe('rgba(55, 53, 47, 0.95)');
    expect(rows?.empty).toBe('rgba(55, 53, 47, 0.5)');
    // And the panel tint is screen furniture, so the paper keeps only the rule.
    expect(rows?.block).toBe('rgba(0, 0, 0, 0)');
  });

  test(`${target.name}: an unchecked task box prints empty`, async ({ page }) => {
    // Left on a dark colour scheme, the user agent paints an unticked checkbox
    // as a filled dark square, which on paper reads as a ticked one: the
    // document says the opposite of what it says on screen. The editor
    // declares the scheme from its own token, so the reset on the root does
    // not reach this subtree, and a host that writes the PROPERTY rather than
    // the token is not reached by the palette either. Both arms are here.
    await openDemo(page, target);
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
        '<p>Not done yet</p></li></ul>',
    );
    await page.addStyleTag({ content: '.dm-editor { color-scheme: dark; }' });
    await goDark(page);

    // The precondition: the host's own declaration really is in force.
    expect(await styleOf(page, '.dm-editor', 'color-scheme')).toBe('dark');

    await page.emulateMedia({ media: 'print' });
    const scheme = await page.evaluate(() => {
      const editor = document.querySelector('.dm-editor');
      if (!editor) return null;
      const style = getComputedStyle(editor);
      return { used: style.colorScheme, token: style.getPropertyValue('--dm-color-scheme').trim() };
    });
    await page.emulateMedia({ media: null });

    expect(scheme?.used).toBe('light');
    expect(scheme?.token).toBe('light');
  });

  test(`${target.name}: a light document prints exactly as it did`, async ({ page }) => {
    // The palette must not change a document that was already light. Inline
    // code is the one token where the light palette and the untouched default
    // disagree visibly, and `currentColor` is the answer that says what the
    // chip should do rather than what colour it should be: it takes the colour
    // of the text around it, so a plain document keeps printing black and an
    // author's own colour on the block still carries into the chip.
    await openDemo(page, target);
    await setContent(
      page,
      '<p>Some <code>inline</code> text.</p>' +
        '<table><tbody><tr><th><p>Head</p></th></tr>' +
        '<tr><td><p>Cell</p></td></tr></tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    const light = await page.evaluate((editor) => {
      const chip = document.querySelector(`${editor} p code`);
      const paragraph = document.querySelector(`${editor} p`);
      const header = document.querySelector(`${editor} th`);
      if (!chip || !paragraph || !header) return null;
      return {
        chip: getComputedStyle(chip).color,
        paragraph: getComputedStyle(paragraph).color,
        header: getComputedStyle(header).backgroundColor,
      };
    }, EDITOR);
    await page.emulateMedia({ media: null });

    expect(light).not.toBeNull();
    // The chip takes the colour of the text it sits in, whatever that is.
    expect(light?.chip).toBe(light?.paragraph);
    expect(Math.max(...channelsOf(light?.chip ?? null))).toBeLessThan(80);
    expect(light?.header).toBe('rgb(248, 249, 250)');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The canvas and the layout release. The printed canvas is taken from the
  // ROOT element and a body background reaches it only while the root has
  // none, so a host that tints `<html>`, which is what every dark theme with a
  // pre-paint bootstrap writes, floods the page area of every sheet. Neither
  // element is a descendant of the body, so the rule that clears each marked
  // ancestor cannot reach either of them: both are named twice, once always on
  // and once behind the print command.
  // ──────────────────────────────────────────────────────────────────────────

  test(`${target.name}: a dark colour scheme on the root prints a light sheet`, async ({
    page,
  }) => {
    // `color-scheme` is not a background and the background reset cannot reach
    // it. It is also worse than one: where a background stops at the page area,
    // a dark scheme paints the WHOLE sheet, margins included, under text this
    // same layer has already forced to black. The editor declares the property
    // from its own token and is reset separately; this is the root, which is
    // where a pre-paint theme bootstrap writes it.
    await openDemo(page, target);
    await setContent(page, '<p>A document under a dark colour scheme.</p>');
    await page.addStyleTag({ content: 'html { color-scheme: dark; }' });

    expect(await styleOf(page, 'html', 'color-scheme')).toBe('dark');

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'color-scheme')).toBe('light');
    expect(await styleOf(page, 'body', 'color-scheme')).toBe('light');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the marked print path clears the canvas, root included`, async ({
    page,
  }) => {
    // The unmarked half comes first on purpose: with the marks in place the
    // layout release covers the root as well, so a canvas rule that had lost
    // the root element would still read transparent and the test would pass
    // over the defect. Unmarked, only the canvas rule is in play.
    await openDemo(page, target);
    await setContent(page, '<p>A document on a tinted page.</p>');
    await goDark(page);
    await page.addStyleTag({ content: 'html { background: rgb(244, 245, 247); }' });

    // The precondition: the host tint really is painting the page.
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgb(244, 245, 247)');

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });

    await markAsPrinting(page);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await styleOf(page, 'body', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a host tint declared with !important still loses to the print command`, async ({
    page,
  }) => {
    // The escape hatch, and its limit. A host who wants a deliberate paper
    // tint declares it `!important`, because specificity alone is not enough
    // against a rule that is `!important` too, and `:root` outweighs the bare
    // `html` the canvas rule names. The command path is the one place that has
    // to win anyway: it is erasing the host application, and a tint left
    // behind is the one piece of it still on the paper. This is the only
    // assertion in the file that isolates the command arm from the always-on
    // one, since with the tint gone both arms read the same.
    await openDemo(page, target);
    await setContent(page, '<p>A document under a deliberate tint.</p>');
    await page.addStyleTag({ content: ':root { background: rgb(244, 245, 247) !important; }' });

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgb(244, 245, 247)');
    await page.emulateMedia({ media: null });

    await markAsPrinting(page);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    await page.emulateMedia({ media: null });
  });

  /** A document long enough that losing it is unmistakable in the page tree. */
  function longDocument(count: number, why: string): string {
    return Array.from(
      { length: count },
      (_, i) => `<p>Paragraph ${String(i + 1)} ${why}</p>`,
    ).join('');
  }

  test(`${target.name}: a host shell that clips at the root still prints the whole document`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // `html, body { height: 100%; overflow: hidden }` is the commonest
    // full-height application shell there is, and under a print it truncates
    // the document to a single sheet. Nothing in the always-on layer may touch
    // it, because the host owns those elements; the command path may, because
    // by then the host application is already hidden.
    await openDemo(page, target);
    await setContent(page, longDocument(120, 'in a shell that clips at the root element.'));
    await page.addStyleTag({ content: 'html, body { height: 100%; overflow: hidden; }' });

    const clipped = await printedPageCount(page);
    await markAsPrinting(page);
    const released = await printedPageCount(page);

    // The precondition and the fix in one line: the shell really did lose the
    // document, and the marks really did give it back.
    expect(clipped).toBe(1);
    expect(released).toBeGreaterThanOrEqual(clipped * 4);

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'overflow-y')).toBe('visible');
    expect(await styleOf(page, 'body', 'overflow-y')).toBe('visible');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a fixed body is put back in flow for a print`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // A different shape of the same loss, and one that height and overflow
    // alone do not fix: a body taken out of flow is laid out against the page
    // area and prints exactly one page of itself.
    await openDemo(page, target);
    await setContent(page, longDocument(120, 'under a body taken out of flow.'));
    await page.addStyleTag({ content: 'body { position: fixed; inset: 0; }' });

    const fixed = await printedPageCount(page);
    await markAsPrinting(page);
    const released = await printedPageCount(page);

    expect(fixed).toBe(1);
    expect(released).toBeGreaterThan(fixed);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'body', 'position')).toBe('static');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the user agent's body margin is off the printed page`, async ({ page }) => {
    // The smallest of these and the one every page has: the user agent's own
    // 8px body margin insets every sheet, in from a margin the reader's print
    // dialog already set.
    await openDemo(page, target);
    await page.addStyleTag({ content: 'body { margin: 8px; }' });

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'body', 'margin-left')).toBe('8px');
    await page.emulateMedia({ media: null });

    await markAsPrinting(page);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'body', 'margin-left')).toBe('0px');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: an ancestor effect does not rasterise or truncate the printed page`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    test.setTimeout(180000);
    // Two families of host declaration, each measured on the element the print
    // command marks. Everything down to `will-change` makes a containing block
    // for fixed descendants, which is how an ancestor turns the repeating
    // footer of a paged document into one box at the end of the flow; the rest
    // make the engine rasterise every sheet, so the file the reader saves has
    // no selectable text left in it at all.
    //
    // Each has its own reset because the shorthands do not cover each other:
    // `transform: none` does not reset the three individual transform
    // properties, which are separate properties rather than its longhands, and
    // `contain: none` does not reset `content-visibility`, which re-applies
    // the same containment by itself.
    await openDemo(page, target);
    await setContent(page, longDocument(120, 'under a host effect that used to eat the print.'));
    await markAsPrinting(page);
    const plain = await printedPageCount(page);
    expect(plain).toBeGreaterThan(2);

    const effects: [string, string, string][] = [
      ['filter', 'blur(2px)', 'none'],
      ['backdrop-filter', 'blur(2px)', 'none'],
      ['contain', 'paint', 'none'],
      ['will-change', 'transform', 'auto'],
      ['transform', 'translateY(10px)', 'none'],
      ['translate', '0 40px', 'none'],
      ['rotate', '2deg', 'none'],
      ['scale', '0.9', 'none'],
      ['transform-style', 'preserve-3d', 'flat'],
      ['container-type', 'size', 'normal'],
      ['content-visibility', 'auto', 'visible'],
      ['opacity', '0.5', '1'],
      ['mask-image', 'linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0))', 'none'],
      ['mix-blend-mode', 'multiply', 'normal'],
      // The four the release lists that nothing above reaches. `columns` is
      // the one that visibly rewrites the page rather than the footer: a host
      // column count survives into the print and lays the whole document out
      // in columns of its choosing.
      ['columns', '2', 'auto'],
      ['perspective', '500px', 'none'],
      ['offset-path', 'path("M 0 0 L 100 0")', 'none'],
      ['view-transition-name', 'host-shell', 'none'],
    ];

    for (const [property, value, reset] of effects) {
      await page.evaluate(
        ([name, applied]) => { document.body.style.setProperty(name!, applied!); },
        [property, value],
      );
      // The precondition, read on screen: a property name the browser did not
      // accept would otherwise make every assertion below pass while nothing
      // was ever applied.
      expect(await styleOf(page, 'body', property), `${property} on screen`).not.toBe(reset);

      await page.emulateMedia({ media: 'print' });
      expect(await styleOf(page, 'body', property), `${property} on paper`).toBe(reset);
      await page.emulateMedia({ media: null });

      expect(await printedPageCount(page), `${property} page count`).toBe(plain);
      await page.evaluate((name) => { document.body.style.removeProperty(name); }, property);
    }
  });

  test(`${target.name}: a running animation cannot outlive the print release`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // An animation outranks a plain declaration in the cascade, so a host
    // animating a property this sheet does not name keeps it through the whole
    // print. Letter spacing is the clearest case because it inherits into the
    // document and is measurable in sheets: forty pixels between the letters
    // of every word is a document three times as long as the one the reader
    // asked for.
    await openDemo(page, target);
    await setContent(page, longDocument(60, 'a host animation must not reshape.'));
    await markAsPrinting(page);
    const still = await printedPageCount(page);

    await page.addStyleTag({
      content:
        '@keyframes dm-print-spread { from { letter-spacing: 40px; } to { letter-spacing: 40px; } }',
    });
    await page.evaluate(() => {
      document.body.style.animation = 'dm-print-spread 100s linear infinite';
    });

    // The precondition: the animation really is running and really is winning.
    expect(await styleOf(page, 'body', 'letter-spacing')).toBe('40px');

    expect(await printedPageCount(page)).toBe(still);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'body', 'animation-name')).toBe('none');
    expect(await styleOf(page, 'body', 'letter-spacing')).toBe('normal');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a plain Ctrl/Cmd+P does not gain the isolation`, async ({ page }) => {
    // The most important test in the set. Everything the release does is a
    // thing this package has no business doing to a page it does not own, and
    // the only thing keeping it off a reader's own print of an article with an
    // editor in it is the gate. A declaration that escaped the gate would pass
    // every other test here.
    await openDemo(page, target);
    await setContent(page, '<p>An editor embedded in a page this package does not own.</p>');
    await page.addStyleTag({
      content: 'html, body { height: 100%; overflow: hidden; } body { padding: 40px; }',
    });

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'html', 'overflow-y')).toBe('hidden');
    expect(await styleOf(page, 'body', 'overflow-y')).toBe('hidden');
    expect(await styleOf(page, 'body', 'padding-left')).toBe('40px');
    await page.emulateMedia({ media: null });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // The band a page footer needs. A footer that repeats on every sheet has to
  // be a `position: fixed` box, because that is the only construct browsers
  // repeat across printed pages. A fixed box is laid out against the page area
  // and is out of flow, so it takes no height from the content flowing into
  // that same area, and a sheet filled to its last line prints that line
  // underneath the footer. This is the hook that makes room for one.
  // ──────────────────────────────────────────────────────────────────────────

  test(`${target.name}: the footer band is off until something asks for it`, async ({ page }) => {
    // Unset, it costs nothing: the fallback is zero, so the document paginates
    // exactly as it did. A length in the custom property is the whole opt-in.
    await openDemo(page, target);
    await page.emulateMedia({ media: 'print' });

    expect(await styleOf(page, 'html', 'padding-bottom')).toBe('0px');
    // The half that decides whether the band lands on every sheet or on one.
    // WebKit implements neither spelling of it for block-end padding under
    // fragmentation and reads the property back as an empty string, so there
    // the band is reserved on the last sheet alone. That is a documented
    // limitation rather than a defect this suite can fix, and asserting the
    // engine's own answer is what keeps it from being mistaken for one.
    const bdb = await styleOf(page, 'html', 'box-decoration-break');
    expect(bdb === '' ? 'clone' : bdb).toBe('clone');

    await page.evaluate(() => {
      document.documentElement.style.setProperty('--dm-print-reserve-block-end', '21.2pt');
    });
    // 21.2pt of paper, in the pixels a computed style reports it in.
    // As a number: engines round the used value differently, and WebKit
    // answers 28.266666px where Chromium answers 28.2667px.
    expect(
      Number.parseFloat((await styleOf(page, 'html', 'padding-bottom')) ?? '0'),
    ).toBeCloseTo(28.2667, 2);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the band survives the ancestor layout reset`, async ({ page }) => {
    // The release zeroes padding on every marked ancestor, and once it can
    // reach the root it lands on this exact longhand. The reservation has to
    // outweigh it, which is why the rule spells out both states of the marking
    // class rather than naming a bare `html`.
    await openDemo(page, target);
    await markAsPrinting(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--dm-print-reserve-block-end', '21.2pt');
    });

    await page.emulateMedia({ media: 'print' });
    // A number rather than a string: WebKit answers 28.266666px where
    // Chromium answers 28.2667px, and both are the same reserved band.
    expect(
      Number.parseFloat((await styleOf(page, 'html', 'padding-bottom')) ?? '0'),
    ).toBeCloseTo(28.2667, 2);
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the band is reserved on every sheet, not just the last`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    // The load-bearing half of the rule. By default a fragmented box carries
    // its block-end padding only on its LAST fragment, which is the one sheet
    // that never needed the room, so a footer would still print over the last
    // line of every sheet before it. Sliced, a five-sheet document gains one
    // sheet at the end; cloned, it gains one for every three it had, which is
    // why the threshold here is two and not one.
    await openDemo(page, target);
    await setContent(page, longDocument(220, 'that has to leave room for a footer.'));
    await markAsPrinting(page);

    const unreserved = await printedPageCount(page);
    expect(unreserved).toBeGreaterThanOrEqual(6);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--dm-print-reserve-block-end', '200pt');
    });
    const reserved = await printedPageCount(page);

    expect(reserved).toBeGreaterThanOrEqual(unreserved + 2);
  });

  test(`${target.name}: the hook does not exist on screen`, async ({ page }) => {
    // It reserves paper, so it belongs to paper. On screen the same property
    // would put a band of blank space under the whole application.
    await openDemo(page, target);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--dm-print-reserve-block-end', '200pt');
    });

    expect(await styleOf(page, 'html', 'padding-bottom')).toBe('0px');
    // Empty in WebKit, which implements neither spelling; see the note on the
    // band test above.
    const bdbScreen = await styleOf(page, 'html', 'box-decoration-break');
    expect(bdbScreen === '' ? 'slice' : bdbScreen).toBe('slice');
  });

  test(`${target.name}: the promoted header row is unbreakable in its own right`, async ({
    page,
  }) => {
    // The repeat survives only while the header group itself cannot be split,
    // and the blanket row rule no longer says that for every row: a row that
    // can outgrow a sheet is deliberately excluded from it. So the promoted
    // row carries the declaration itself rather than inheriting a decision
    // made for other rows, and this is what stops that being tidied away as a
    // duplicate.
    await openDemo(page, target);
    //
    // The header cells hold two paragraphs each, which is what makes this
    // measurable at all: the blanket row rule excludes a row that can outgrow
    // a sheet, and two adjacent paragraphs is exactly the shape it excludes.
    // A one-line header row takes `avoid` from that blanket rule whether or
    // not the promotion declares it, so a test written on one proves nothing.
    await setContent(
      page,
      '<table><tbody>' +
        '<tr><th><p>Alpha</p><p>and its note</p></th><th><p>Beta</p><p>and its note</p></th></tr>' +
        '<tr><td><p>one</p><p>and its note</p></td><td><p>two</p><p>and its note</p></td></tr>' +
        '</tbody></table>',
    );

    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, 'tbody tr:first-child', 'display')).toBe('table-header-group');
    expect(await styleOf(page, 'tbody tr:first-child', 'break-inside')).toBe('avoid');
    // The control, and the reason the header needs its own declaration: the
    // data row below is the same shape and the blanket rule leaves it
    // breakable, so this value cannot be coming from there.
    expect(await styleOf(page, 'tbody tr:nth-child(2)', 'break-inside')).toBe('auto');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a code block strands three lines rather than two`, async ({ page }) => {
    // Two lines of prose carry more than two lines of code do, so `pre` takes
    // three where `p` takes two. Both constraints are dropped when a block has
    // fewer lines than their sum, which is why this is a computed read rather
    // than a page count: a five-line block can still break three and two.
    await openDemo(page, target);
    await setContent(page, '<pre><code>one\ntwo\nthree\nfour</code></pre><p>After it.</p>');

    await page.emulateMedia({ media: 'print' });
    const preOrphans = await styleOf(page, '.ProseMirror pre', 'orphans');
    // Firefox has never implemented `orphans` or `widows` and reads them back
    // as an empty string, so there a code block fragments wherever the break
    // falls and this pair buys nothing. Asserting the engine's own answer
    // keeps that a documented limitation rather than a silent one.
    if (preOrphans === '') {
      expect(await styleOf(page, '.ProseMirror pre', 'widows')).toBe('');
      expect(await styleOf(page, '.ProseMirror p', 'orphans')).toBe('');
    } else {
      expect(preOrphans).toBe('3');
      expect(await styleOf(page, '.ProseMirror pre', 'widows')).toBe('3');
      // The paragraph beside it keeps the prose figure, which is what makes
      // the pair above a decision rather than a global.
      expect(await styleOf(page, '.ProseMirror p', 'orphans')).toBe('2');
    }
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the widow and orphan reset survives a host that lowers it`, async ({
    page,
  }) => {
    // Two is the CSS initial value, so the rule changes nothing on its own and
    // reads as dead weight. It is not: these properties inherit, and section 6
    // deliberately leaves the host's ancestors in the tree rather than
    // removing them, so a host writing `orphans: 1` on the body reaches the
    // document through them and strands single lines on paper.
    await openDemo(page, target);
    await setContent(page, '<p>A paragraph long enough to have lines to strand.</p>');
    await page.addStyleTag({
      content: '@media print { body { orphans: 1; widows: 1; } }',
    });

    await page.emulateMedia({ media: 'print' });
    const hostOrphans = await styleOf(page, 'body', 'orphans');
    if (hostOrphans === '') {
      // Firefox implements neither property, so a host cannot lower them
      // there and there is nothing to defend. The editor reads back empty
      // too, which is what says the engine rather than the reset is the
      // reason this assertion is not the interesting one here.
      expect(await styleOf(page, '.ProseMirror p', 'orphans')).toBe('');
    } else {
      expect(hostOrphans).toBe('1');
      expect(await styleOf(page, '.ProseMirror p', 'orphans')).toBe('2');
      expect(await styleOf(page, '.ProseMirror p', 'widows')).toBe('2');
    }
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: the layout release strips a host's own floors and its chrome`, async ({
    page,
  }) => {
    // Four declarations of the release that nothing else in this file reaches.
    // Two of them change the page rather than decorating it. A `min-width` on
    // a shell holds the document at a width the sheet does not have, and the
    // engine scales the whole print down to fit it. A `min-height: 100vh`, the
    // commonest shell floor there is, is a whole page area of blank paper
    // under a document shorter than one.
    await openDemo(page, target);
    await setContent(page, '<p>A document inside a shell the host application owns.</p>');
    await page.evaluate(() => {
      const host = document.querySelector('.dm-editor')?.parentElement;
      if (!host) throw new Error('no host to decorate');
      host.classList.add('dm-test-host');
      host.style.minWidth = '2000px';
      host.style.minHeight = '100vh';
      host.style.boxShadow = '0 0 40px rgb(255, 0, 0)';
      host.style.outline = '4px solid rgb(255, 0, 0)';
    });

    // The control, and it is the half that matters: without the marks the host
    // keeps all four. The always-on layer does not touch a page it was not
    // invited to erase, so a release that leaked out of the command path would
    // fail here rather than passing everywhere.
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-test-host', 'min-width')).toBe('2000px');
    expect(await styleOf(page, '.dm-test-host', 'box-shadow')).toContain('rgb(255, 0, 0)');
    expect(await styleOf(page, '.dm-test-host', 'outline-style')).toBe('solid');
    await page.emulateMedia({ media: null });

    await markAsPrinting(page);
    await page.emulateMedia({ media: 'print' });
    expect(await styleOf(page, '.dm-test-host', 'min-width')).toBe('0px');
    expect(await styleOf(page, '.dm-test-host', 'min-height')).toBe('0px');
    expect(await styleOf(page, '.dm-test-host', 'box-shadow')).toBe('none');
    expect(await styleOf(page, '.dm-test-host', 'outline-style')).toBe('none');
    await page.emulateMedia({ media: null });
  });

  test(`${target.name}: a shell built on a viewport floor prints no blank paper`, async ({
    page,
    browserName,
  }) => {
    // What the `min-height` reset above is actually worth, in sheets. The
    // computed read proves the declaration lands; this proves the declaration
    // was worth writing. A one-paragraph document under a `min-height: 100vh`
    // shell prints one sheet of paper and one of nothing, and above 100vh a
    // multiple of that.
    test.skip(browserName !== 'chromium', 'page.pdf() exists for headless Chromium alone');
    await openDemo(page, target);
    await setContent(page, '<p>A short document under a full-height shell.</p>');
    await markAsPrinting(page);

    const plain = await printedPageCount(page);
    expect(plain).toBe(1);

    await page.evaluate(() => {
      const host = document.querySelector('.dm-editor')?.parentElement;
      if (!host) throw new Error('no host to floor');
      host.style.minHeight = '300vh';
    });

    expect(await printedPageCount(page)).toBe(plain);
  });

  test(`${target.name}: a host's own print zoom is deliberately left alone`, async ({ page }) => {
    // Every other transform-adjacent property on a marked ancestor is reset,
    // because each of them loses content: a containing block for fixed
    // descendants turns a repeating footer into one box, and a filter
    // rasterises the text away. `zoom` loses nothing. It scales the print, and
    // a host who wrote `@media print { body { zoom: 0.8 } }` meant it, so
    // completing the list would take their decision away: measured at five
    // sheets becoming seven. This pins the omission so it reads as a choice.
    await openDemo(page, target);
    await setContent(page, '<p>A document under a host print zoom.</p>');
    await page.evaluate(() => {
      const host = document.querySelector('.dm-editor')?.parentElement;
      if (!host) throw new Error('no host to zoom');
      host.style.zoom = '0.8';
      host.style.transform = 'translateY(4px)';
    });
    await markAsPrinting(page);

    await page.emulateMedia({ media: 'print' });
    const kept = await page.evaluate(() => {
      const host = document.querySelector('.dm-editor')?.parentElement;
      if (!host) throw new Error('no host to read');
      const style = getComputedStyle(host);
      return { zoom: style.zoom, transform: style.transform };
    });
    await page.emulateMedia({ media: null });

    expect(kept.zoom).toBe('0.8');
    // The control, so this cannot pass because the marks never landed.
    expect(kept.transform).toBe('none');
  });
}
