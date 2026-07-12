/**
 * BlockHandle drops released in the RIGHT page margin, across all four demos.
 * The drop envelope extends 80px past `.dm-editor`'s right edge (was 16), so
 * a release out in the margin still moves the block. A real margin release
 * fires `drop` on the element under the pointer (page wrapper, body), never
 * on `.ProseMirror`, so PM's `handleDrop` cannot see it: only the extension's
 * document-level dragover/drop listeners process the release. These tests
 * dispatch on `document.elementFromPoint` to exercise exactly that path.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

interface MarginGeometry {
  /** `.dm-editor`'s right edge: the margin starts here, the zone ends 80px later. */
  editorRight: number;
  rows: Array<{ text: string; top: number; bottom: number }>;
}

/** Client rects of the top-level paragraphs plus the editor's right edge. */
async function marginGeometry(page: Page, target: DemoTarget): Promise<MarginGeometry> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const editor = pm?.closest('.dm-editor');
    if (!pm || !editor) throw new Error('notion editor not found');
    const rows = Array.from(pm.querySelectorAll(':scope > p')).map((p) => {
      const r = p.getBoundingClientRect();
      return { text: p.textContent ?? '', top: r.top, bottom: r.bottom };
    });
    return { editorRight: editor.getBoundingClientRect().right, rows };
  }, target.editorSelector);
}

function rowOf(geo: MarginGeometry, text: string): { text: string; top: number; bottom: number } {
  const row = geo.rows.find((r) => r.text === text);
  if (!row) throw new Error(`paragraph "${text}" not found`);
  return row;
}

/**
 * Drag a paragraph by its handle and release at a page-margin point. The
 * point may lie over a page wrapper or outside the viewport, so dragover and
 * drop go to `document.elementFromPoint` (body when null) with one shared
 * DataTransfer; the document-level listeners only read the coordinates.
 */
async function dragToMarginPoint(
  page: Page,
  target: DemoTarget,
  sourceText: string,
  x: number,
  y: number,
): Promise<void> {
  await page.locator(`${target.editorSelector} > p`, { hasText: sourceText }).hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);
  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  // The extension commits `draggedFrom` via a deferred dispatch; let it land.
  await page.waitForTimeout(20);
  await page.evaluate(({ dt: data, x: cx, y: cy }) => {
    const el = document.elementFromPoint(cx, cy) ?? document.body;
    const init: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      dataTransfer: data,
    };
    el.dispatchEvent(new DragEvent('dragover', init));
    el.dispatchEvent(new DragEvent('drop', init));
  }, { dt, x, y });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(80);
  await dt.dispose();
}

for (const target of demoTargets) {
  test.describe(`${target.name} - right page margin drops`, () => {
    const paragraphs = (page: Page) => page.locator(`${target.editorSelector} > p`);

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Aaa</p><p>Bbb</p><p>Ccc</p>');
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Bbb', 'Ccc']);
    });

    test('release in the right page margin drops between rows', async ({ page }) => {
      const geo = await marginGeometry(page, target);
      // 50px into the margin: beyond the old 16px envelope, inside the new 80px one.
      const x = geo.editorRight + 50;
      const y = (rowOf(geo, 'Aaa').bottom + rowOf(geo, 'Bbb').top) / 2;

      await dragToMarginPoint(page, target, 'Ccc', x, y);

      await expect(paragraphs(page)).toHaveText(['Aaa', 'Ccc', 'Bbb']);
    });

    test('release in the right page margin below the last block appends', async ({ page }) => {
      const geo = await marginGeometry(page, target);
      const x = geo.editorRight + 50;
      const y = rowOf(geo, 'Ccc').bottom + 30;

      await dragToMarginPoint(page, target, 'Aaa', x, y);

      await expect(paragraphs(page)).toHaveText(['Bbb', 'Ccc', 'Aaa']);
    });
  });
}
