/**
 * Native text-selection drags must fall through to ProseMirror's default move,
 * and the BlockHandle drop indicator must hide when the dragged block is deleted
 * mid-drag. Covers commit 3ae0023 across all four demos.
 *
 * The extension only owns a drag that STARTS on `.dm-block-handle-drag`: its
 * `dragstart` listener is bound to that button alone, and only that path
 * attaches the document-level `dragover` listener, adds `.dm-block-handle-dragging`,
 * and lights `.dm-block-drop-indicator`. A `dragstart` fired from the editor
 * content (a native text-selection move) never reaches that listener, so the
 * extension stays inert and PM's default drop keeps handling the move.
 *
 * Separately, once a real handle drag has committed its source position to
 * plugin state, deleting that block maps the position away (nulls it); the next
 * `updateDropIndicator` sees `resolveDraggedFrom() === null` and hides the line,
 * because a release would then be a guaranteed no-op.
 */
import { test } from './fixtures.js';
import { expect, type Locator, type Page, type JSHandle } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';

/** Minimal structural view of the exposed editor's ProseMirror view, enough to
 * delete a top-level block by transaction without pulling in PM's types. */
interface PMNodeLike {
  textContent: string;
  nodeSize: number;
}
interface PMTrLike {
  delete: (from: number, to: number) => PMTrLike;
}
interface PMStateLike {
  doc: { forEach: (fn: (node: PMNodeLike, offset: number) => void) => void };
  tr: PMTrLike;
}
interface PMViewLike {
  state: PMStateLike;
  dispatch: (tr: PMTrLike) => void;
}
interface DemoEditorViewHost {
  view: PMViewLike;
}

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

/** `.dm-editor`'s box plus each top-level paragraph's vertical rect. */
interface Geometry {
  editorLeft: number;
  editorRight: number;
  rows: { text: string; top: number; bottom: number }[];
}

async function geometry(page: Page, target: DemoTarget): Promise<Geometry> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const editor = pm?.closest('.dm-editor');
    if (!pm || !editor) throw new Error('notion editor not found');
    const er = editor.getBoundingClientRect();
    const rows = Array.from(pm.querySelectorAll(':scope > p')).map((p) => {
      const r = p.getBoundingClientRect();
      return { text: p.textContent, top: r.top, bottom: r.bottom };
    });
    return { editorLeft: er.left, editorRight: er.right, rows };
  }, target.editorSelector);
}

/** A drop-zone point centered horizontally in the editor, at the gap between two
 * stacked paragraphs. Dropping a block here lands it between the two rows. */
function gapBetween(geo: Geometry, upperText: string, lowerText: string): { x: number; y: number } {
  const upper = geo.rows.find((r) => r.text === upperText);
  const lower = geo.rows.find((r) => r.text === lowerText);
  if (!upper || !lower) throw new Error(`rows "${upperText}"/"${lowerText}" not found`);
  return { x: (geo.editorLeft + geo.editorRight) / 2, y: (upper.bottom + lower.top) / 2 };
}

async function editorHasDraggingClass(page: Page, target: DemoTarget): Promise<boolean> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    const editor = pm?.closest('.dm-editor');
    return Boolean(editor?.classList.contains('dm-block-handle-dragging'));
  }, target.editorSelector);
}

/** Hover a block, then fire a real handle drag from `.dm-block-handle-drag`. The
 * returned DataTransfer is reused for the follow-up dragover/dragend. */
async function dragStartFromHandle(
  page: Page,
  target: DemoTarget,
  sourceText: string,
): Promise<JSHandle<DataTransfer>> {
  await page.locator(`${target.editorSelector} > p`, { hasText: sourceText }).hover();
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page.locator(dragBtnSelector).dispatchEvent('dragstart', { dataTransfer: dt });
  // The extension commits `draggedFrom` to plugin state via a deferred dispatch
  // (setTimeout 0); wait so a later delete maps that committed position away.
  await page.waitForTimeout(20);
  return dt;
}

/** Fire a `dragover` at a page point; the document-level listener (when the
 * extension owns the drag) reads only the coordinates. */
async function dragoverAt(page: Page, dt: JSHandle<DataTransfer>, x: number, y: number): Promise<void> {
  await page.evaluate(({ dt: data, x: cx, y: cy }) => {
    const el = document.elementFromPoint(cx, cy) ?? document.body;
    const init: DragEventInit = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, dataTransfer: data };
    el.dispatchEvent(new DragEvent('dragover', init));
  }, { dt, x, y });
}

/** Delete the top-level block whose text matches, by transaction on the exposed
 * view (mimics a block vanishing mid-drag, e.g. a remote peer's edit). */
async function deleteBlock(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditorViewHost
      | undefined;
    if (!ed) throw new Error('editor missing');
    const view = ed.view;
    const ranges: { from: number; to: number; text: string }[] = [];
    view.state.doc.forEach((node, offset) => {
      ranges.push({ from: offset, to: offset + node.nodeSize, text: node.textContent });
    });
    const targetRange = ranges.find((r) => r.text === t);
    if (!targetRange) throw new Error('block not found: ' + t);
    view.dispatch(view.state.tr.delete(targetRange.from, targetRange.to));
  }, text);
}

for (const target of demoTargets) {
  test.describe(`${target.name} - native drag passthrough`, () => {
    const paragraphs = (page: Page): Locator => page.locator(`${target.editorSelector} > p`);
    const containerSelector = target.editorSelector.replace(/\s*\.ProseMirror$/, '');
    const indicatorSelector = `${containerSelector} .dm-block-drop-indicator`;

    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<p>Aaa</p><p>Bbb</p><p>Ccc</p>');
      await expect(paragraphs(page)).toHaveText(['Aaa', 'Bbb', 'Ccc']);
      // The drop indicator element exists up front (appended at plugin init);
      // both tests assert its visibility, so confirm it is present and hidden.
      await expect(page.locator(indicatorSelector)).toHaveCount(1);
      await expect(page.locator(indicatorSelector)).not.toHaveAttribute('data-show', '');
    });

    test('native text-selection drag does not engage the block handle', async ({ page }) => {
      // Fire a dragstart from the editor CONTENT (not `.dm-block-handle-drag`),
      // then a dragover inside the drop zone. If the extension wrongly claimed
      // native drags, the indicator/class would light here; it must not.
      await page.evaluate((sel) => {
        const pm = document.querySelector(sel);
        if (!(pm instanceof HTMLElement)) throw new Error('editor not found');
        const firstP = pm.querySelector(':scope > p');
        if (!(firstP instanceof HTMLElement)) throw new Error('paragraph not found');
        pm.focus();
        const range = document.createRange();
        range.selectNodeContents(firstP);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        const dt = new DataTransfer();
        firstP.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));

        const editorRect = (pm.closest('.dm-editor') ?? pm).getBoundingClientRect();
        const firstRect = firstP.getBoundingClientRect();
        const x = (editorRect.left + editorRect.right) / 2;
        const y = firstRect.bottom + 2;
        const overTarget = document.elementFromPoint(x, y) ?? document.body;
        const init: DragEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt };
        overTarget.dispatchEvent(new DragEvent('dragover', init));
      }, target.editorSelector);

      // Give any (wrongly attached) deferred dispatch / rAF a chance to fire.
      await page.waitForTimeout(80);

      expect(await editorHasDraggingClass(page, target)).toBe(false);
      await expect(page.locator(indicatorSelector)).not.toHaveAttribute('data-show', '');
    });

    test('drop indicator hides when the dragged block is deleted mid-drag', async ({ page }) => {
      const dt = await dragStartFromHandle(page, target, 'Aaa');
      // The real handle drag marks the editor as dragging.
      await expect(async () => {
        expect(await editorHasDraggingClass(page, target)).toBe(true);
      }).toPass({ timeout: 2000 });

      // Hover the Bbb/Ccc gap: dropping Aaa here would move it, so the line shows.
      const before = gapBetween(await geometry(page, target), 'Bbb', 'Ccc');
      await dragoverAt(page, dt, before.x, before.y);
      await expect(page.locator(indicatorSelector)).toHaveAttribute('data-show', '', { timeout: 2000 });

      // Delete the dragged block mid-drag: its committed source position maps
      // away, so a release is now a guaranteed no-op.
      await deleteBlock(page, 'Aaa');
      await expect(paragraphs(page)).toHaveText(['Bbb', 'Ccc']);

      // Another dragover in the same (still in-zone) gap must now hide the line.
      const after = gapBetween(await geometry(page, target), 'Bbb', 'Ccc');
      await dragoverAt(page, dt, after.x, after.y);
      await expect(page.locator(indicatorSelector)).not.toHaveAttribute('data-show', '', { timeout: 2000 });

      await page.locator(dragBtnSelector).dispatchEvent('dragend', { dataTransfer: dt });
      await dt.dispose();
    });
  });
}
