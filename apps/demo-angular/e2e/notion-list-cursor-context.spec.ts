/**
 * E2E coverage for the `getListItemCursorContext` util as exposed via
 * `window.__DOMTERNAL_LIST_CTX__` on the Notion demo. The util is pure
 * read-only; full behaviour is covered by ~13 unit tests in
 * `packages/core/src/utils/listItemCursorContext.test.ts`. This spec
 * adds a thin integration check that the util resolves correctly
 * against the BUILT dist running in the angular wrapper, plus a few
 * key branches a user might hit live.
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
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DOMTERNAL_LIST_CTX__']));
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

interface CtxShape {
  itemDepth: number;
  itemPos: number;
  wrapperPos: number;
  isInChildrenZone: boolean;
  paragraphIsEmpty: boolean;
  isLastChild: boolean;
  childIndex: number;
}

/**
 * Place caret at end of the Kth child of the Nth list/task item, then
 * call `getListItemCursorContext($from)` and return the result.
 */
async function ctxAtItemChild(
  page: Page,
  itemIndex: number,
  childIndex: number,
): Promise<(CtxShape & { itemType: string; wrapperType: string }) | null> {
  return page.evaluate(({ ii, ci }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; childCount: number; child: (i: number) => { nodeSize: number } }, p: number) => boolean | void) => void; nodeAt: (p: number) => { type: { name: string } } | null; resolve: (p: number) => unknown };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown }; $from: unknown };
          };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    const getCtx = (window as unknown as Record<string, unknown>)['__DOMTERNAL_LIST_CTX__'] as
      | ((from: unknown) => CtxShape | null)
      | undefined;
    if (!ed || !getCtx) return null;

    let foundItemPos = -1;
    let foundItemNode: { childCount: number; child: (i: number) => { nodeSize: number } } | null = null;
    let counter = 0;
    ed.state.doc.descendants((node, p) => {
      if (foundItemPos !== -1) return false;
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        if (counter === ii) { foundItemPos = p; foundItemNode = node; return false; }
        counter++;
      }
      return true;
    });
    if (foundItemPos === -1 || !foundItemNode) return null;
    const item = foundItemNode as { childCount: number; child: (i: number) => { nodeSize: number } };
    let childStart = foundItemPos + 1;
    for (let i = 0; i < ci; i++) childStart += item.child(i).nodeSize;
    const child = item.child(ci);
    const targetPos = childStart + child.nodeSize - 1;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, targetPos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();

    const ctx = getCtx(ed.state.selection.$from);
    if (!ctx) return null;
    const itemNode = ed.state.doc.nodeAt(ctx.itemPos);
    const wrapperNode = ed.state.doc.nodeAt(ctx.wrapperPos);
    return {
      ...ctx,
      itemType: itemNode?.type.name ?? 'unknown',
      wrapperType: wrapperNode?.type.name ?? 'unknown',
    };
  }, { ii: itemIndex, ci: childIndex });
}

/** Place caret at end of the first node of `typeName` matching `text` and return the ctx. */
async function ctxAtNode(page: Page, typeName: string, text: string): Promise<CtxShape | null> {
  return page.evaluate(({ tn, txt }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: { doc: { descendants: (cb: (n: { type: { name: string }; nodeSize: number; textContent: string }, p: number) => boolean | void) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (doc: unknown, a: number) => unknown }; $from: unknown } };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    const getCtx = (window as unknown as Record<string, unknown>)['__DOMTERNAL_LIST_CTX__'] as
      | ((from: unknown) => CtxShape | null)
      | undefined;
    if (!ed || !getCtx) return null;

    let pos = -1;
    let size = 0;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn && node.textContent === txt) { pos = p; size = node.nodeSize; return false; }
      return true;
    });
    if (pos === -1) return null;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + size - 1));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    return getCtx(ed.state.selection.$from);
  }, { tn: typeName, txt: text });
}

// ────────────────────────────────────────────────────────────────────────

test.describe('getListItemCursorContext - integration via built dist', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('cursor in label paragraph of bullet li - isInChildrenZone false, childIndex 0, wrapper is bulletList', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p></li></ul>');
    const ctx = await ctxAtItemChild(page, 0, 0);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(false);
    expect(ctx?.childIndex).toBe(0);
    expect(ctx?.itemType).toBe('listItem');
    expect(ctx?.wrapperType).toBe('bulletList');
  });

  test('cursor in 2nd-child empty paragraph - isInChildrenZone true, paragraphIsEmpty true, isLastChild true', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    const ctx = await ctxAtItemChild(page, 0, 2);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
    expect(ctx?.isLastChild).toBe(true);
    expect(ctx?.childIndex).toBe(2);
  });

  test('cursor in heading parent (nested in li) - returns null (parent is not a paragraph)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul>');
    const ctx = await ctxAtNode(page, 'heading', 'Heading');
    expect(ctx).toBeNull();
  });

  test('cursor at top-level paragraph (no list ancestor) - returns null', async ({ page }) => {
    await setContent(page, '<p>just a paragraph</p>');
    const ctx = await ctxAtNode(page, 'paragraph', 'just a paragraph');
    expect(ctx).toBeNull();
  });

  test('cursor in INNER nested listItem (taskItem > bulletList > listItem) resolves to inner listItem, not outer taskItem', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>OuterLabel</p>'
      + '<ul><li><p>InnerLabel</p><p></p></li></ul>'
      + '</li></ul>',
    );
    // Inner listItem is itemIndex 1 (taskItem first in doc traversal).
    // Its 2nd child (childIndex 1) is the empty trailing paragraph.
    const ctx = await ctxAtItemChild(page, 1, 1);
    expect(ctx).not.toBeNull();
    expect(ctx?.itemType).toBe('listItem');
    expect(ctx?.wrapperType).toBe('bulletList');
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
  });

  test('cursor in label of taskItem - isInChildrenZone false, wrapper is taskList', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task label</p></li></ul>',
    );
    const ctx = await ctxAtItemChild(page, 0, 0);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(false);
    expect(ctx?.itemType).toBe('taskItem');
    expect(ctx?.wrapperType).toBe('taskList');
  });
});
