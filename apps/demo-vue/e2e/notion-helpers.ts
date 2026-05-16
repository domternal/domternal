/**
 * Shared helpers for the React Notion-mode e2e suite.
 *
 * The Angular notion-*.spec.ts files reimplement these helpers inline in
 * every file (~50-80 LoC of duplication per spec). The React port factors
 * them into this single module so future selector tweaks live in one place
 * and individual specs stay focused on assertions.
 *
 * All helpers use `page.evaluate` for editor-state access, narrowing
 * `window.__DEMO_EDITOR__` to small structural shapes (rather than importing
 * `Editor` from `@domternal/core` and dragging the whole type graph into
 * the test runtime). The narrowing keeps tests isolated from refactors to
 * the public Editor surface.
 */
import { expect, type JSHandle, type Locator, type Page } from '@playwright/test';

// ----------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------

/** Platform-aware modifier key ('Meta' on macOS, 'Control' on Linux/Windows). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

export const NOTION_EDITOR_SELECTOR = '.app-notion-demo .ProseMirror';

/**
 * Node types that UniqueID stamps. Used by `waitForStampedIds` to scope the
 * stamp wait to only top-level blocks (some specs care about every node,
 * others only about the canonical block types).
 */
export const STAMPED_TYPES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList',
  'blockquote', 'codeBlock', 'horizontalRule',
] as const;

// ----------------------------------------------------------------------
// Page setup
// ----------------------------------------------------------------------

export async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  // Vue demo uses `data-testid` attributes on the mode-toggle buttons
  // (per `apps/demo-vue/src/App.vue`'s `.demo-mode-toggle`). The React
  // demo's class+text-matcher selector does not apply here.
  await page.waitForSelector('[data-testid="mode-notion"]');
  await page.click('[data-testid="mode-notion"]');
  await page.waitForSelector(NOTION_EDITOR_SELECTOR);
  await waitForAllIds(page);
}

// ----------------------------------------------------------------------
// Content management
// ----------------------------------------------------------------------

export async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await waitForAllIds(page);
}

/**
 * Replace content AND immediately wrap an `AllSelection` over the doc via
 * `commands.focus('all')`. The pre-click ensures `view.dom.isConnected` is
 * true and the editor has DOM focus, otherwise `focus('all')` returns false
 * and the AllSelection dispatch is silently skipped.
 *
 * Color-picker data-layer tests use this to apply marks across the whole
 * doc in one shot.
 */
export async function setContentAndSelectAll(page: Page, html: string): Promise<void> {
  await page.click(NOTION_EDITOR_SELECTOR);
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          setContent: (h: string, emit: boolean) => void;
          commands: { focus: (pos?: string) => boolean };
        }
      | undefined;
    ed?.setContent(h, false);
    // 'all' selects the entire document (AllSelection); setMark then writes
    // to the doc rather than to stored marks.
    ed?.commands.focus('all');
  }, html);
}

/**
 * Triple-click the first paragraph to install a real TextSelection. The
 * bubble-menu's default `shouldShow` rejects non-text selections (e.g.
 * AllSelection from `focus('all')`), so UI-flow tests need a genuine
 * selection range that ProseMirror sets via native browser events. Waits
 * for `.dm-bubble-menu[data-show]` before returning.
 */
export async function selectFirstParagraph(page: Page): Promise<void> {
  await page.locator(`${NOTION_EDITOR_SELECTOR} p`).first().click({ clickCount: 3 });
  await page.waitForSelector('.dm-bubble-menu[data-show]', { timeout: 5000 });
}

export async function runCommand(
  page: Page,
  name: string,
  ...args: unknown[]
): Promise<boolean> {
  return page.evaluate(
    ({ n, a }) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: Record<string, (...args: unknown[]) => boolean> }
        | undefined;
      const fn = ed?.commands[n];
      return fn ? Boolean(fn(...a)) : false;
    },
    { n: name, a: args },
  );
}

export async function getEditorHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { getHTML: () => string }
      | undefined;
    return ed?.getHTML() ?? '';
  });
}

// ----------------------------------------------------------------------
// UniqueID stamp waits
// ----------------------------------------------------------------------

export async function waitForAllIds(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => { if (!n.attrs['id']) ok = false; });
    return ok;
  }, { timeout: 3000 });
}

/**
 * Poll until every node whose type is in `STAMPED_TYPES` has `attrs.id`.
 * Looser than `waitForAllIds` for specs that intentionally insert nodes
 * UniqueID does not target.
 */
export async function waitForStampedIds(page: Page): Promise<void> {
  const stamped = [...STAMPED_TYPES];
  await page.waitForFunction((types) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => {
      if ((types as string[]).includes(n.type.name) && !n.attrs['id']) ok = false;
    });
    return ok;
  }, stamped, { timeout: 3000 });
}

// ----------------------------------------------------------------------
// Doc inspection
// ----------------------------------------------------------------------

export async function getBlocks(
  page: Page,
): Promise<Array<{ type: string; text: string; attrs: Record<string, unknown> }>> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    const out: Array<{ type: string; text: string; attrs: Record<string, unknown> }> = [];
    ed?.state.doc.forEach((n) => { out.push({ type: n.type.name, text: n.textContent, attrs: n.attrs }); });
    return out;
  });
}

export async function topLevelTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string } }) => void) => void } } }
      | undefined;
    const out: string[] = [];
    ed?.state.doc.forEach((n) => { out.push(n.type.name); });
    return out;
  });
}

export async function listItemTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: {
              descendants: (cb: (n: { type: { name: string }; textContent: string }) => boolean | undefined) => void;
            };
          };
        }
      | undefined;
    const out: string[] = [];
    ed?.state.doc.descendants((n) => {
      if (n.type.name === 'listItem' || n.type.name === 'taskItem') out.push(n.textContent);
      return true;
    });
    return out;
  });
}

export async function selectionAt(page: Page): Promise<{ from: number; parentText: string }> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { selection: { from: number; $from: { parent: { textContent: string } } } } }
      | undefined;
    if (!ed) return { from: -1, parentText: '' };
    return {
      from: ed.state.selection.from,
      parentText: ed.state.selection.$from.parent.textContent,
    };
  });
}

export async function topBlocks(page: Page): Promise<Array<{ type: string; text: string }>> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
      | undefined;
    const out: Array<{ type: string; text: string }> = [];
    ed?.state.doc.forEach((n) => { out.push({ type: n.type.name, text: n.textContent }); });
    return out;
  });
}

export async function listItemShapes(
  page: Page,
): Promise<Array<{
  type: string;
  childCount: number;
  text: string;
  children: Array<{ type: string; childCount: number; text: string }>;
}>> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: {
              descendants: (cb: (n: {
                type: { name: string };
                childCount: number;
                textContent: string;
                content: { content: Array<{ type: { name: string }; childCount: number; textContent: string }> };
              }) => boolean | void) => void;
            };
          };
        }
      | undefined;
    const out: Array<{
      type: string;
      childCount: number;
      text: string;
      children: Array<{ type: string; childCount: number; text: string }>;
    }> = [];
    ed?.state.doc.descendants((node) => {
      if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
        const children = (node.content.content ?? []).map((c) => ({
          type: c.type.name,
          childCount: c.childCount,
          text: c.textContent,
        }));
        out.push({
          type: node.type.name,
          childCount: node.childCount,
          text: node.textContent,
          children,
        });
      }
      return true;
    });
    return out;
  });
}

// ----------------------------------------------------------------------
// BlockHandle plugin introspection
// ----------------------------------------------------------------------

export async function hoveredPos(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          view: {
            state: {
              plugins: Array<{
                spec?: { key?: { key?: string } };
                getState: (s: unknown) => { hoveredPos?: number | null } | undefined;
              }>;
            };
          };
        }
      | undefined;
    if (!ed) return null;
    const plugin = ed.view.state.plugins.find(
      (p) => typeof p.spec?.key?.key === 'string' && p.spec.key.key.startsWith('blockHandle$'),
    );
    if (!plugin) return null;
    const s = plugin.getState(ed.view.state as unknown);
    return s?.hoveredPos ?? null;
  });
}

// ----------------------------------------------------------------------
// Selection / caret placement
// ----------------------------------------------------------------------

/**
 * Place caret at the END of the first text node whose `text === query`.
 * Uses `TextSelection.create` via the live selection's constructor so the
 * test runtime never imports PM directly.
 */
export async function caretInText(page: Page, query: string): Promise<void> {
  await page.evaluate((t) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { isText: boolean; text?: string }, p: number) => boolean | undefined) => void };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; dom: HTMLElement; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.isText && n.text === t) { pos = p + t.length; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, query);
}

export async function caretAtEmptyP(page: Page, occurrence: number = 0): Promise<void> {
  await page.evaluate((idx) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; content: { size: number } }, p: number) => boolean | undefined) => void };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; dom: HTMLElement; focus: () => void };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    let count = 0;
    ed.state.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.type.name === 'paragraph' && n.content.size === 0) {
        if (count === idx) { pos = p + 1; return false; }
        count++;
      }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, occurrence);
}

export async function caretAtStartOfNode(page: Page, typeName: string, text: string): Promise<void> {
  await page.evaluate(({ tn, txt }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; textContent: string }, p: number) => boolean | void) => void };
            tr: { setSelection: (s: unknown) => unknown };
          };
          view: {
            dispatch: (tr: unknown) => void;
            state: { selection: { constructor: { create: (doc: unknown, a: number) => unknown } } };
            focus: () => void;
            dom: HTMLElement;
          };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn && node.textContent === txt) { pos = p; return false; }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.view.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + 1));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { tn: typeName, txt: text });
}

export async function caretAtEndOfNode(page: Page, typeName: string, text: string): Promise<void> {
  await page.evaluate(({ tn, txt }) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | {
          state: {
            doc: { descendants: (cb: (n: { type: { name: string }; nodeSize: number; textContent: string }, p: number) => boolean | void) => void };
            tr: { setSelection: (s: unknown) => unknown };
            selection: { constructor: { create: (doc: unknown, a: number) => unknown } };
          };
          view: { dispatch: (tr: unknown) => void; focus: () => void; dom: HTMLElement };
        }
      | undefined;
    if (!ed) return;
    let pos = -1;
    let size = 0;
    ed.state.doc.descendants((node, p) => {
      if (pos !== -1) return false;
      if (node.type.name === tn && node.textContent === txt) {
        pos = p;
        size = node.nodeSize;
        return false;
      }
      return true;
    });
    if (pos === -1) return;
    const TS = ed.state.selection.constructor;
    const tr = (ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos + size - 1));
    ed.view.dispatch(tr);
    ed.view.dom.focus();
    ed.view.focus();
  }, { tn: typeName, txt: text });
}

// ----------------------------------------------------------------------
// Synthetic drag-and-drop
// ----------------------------------------------------------------------

/**
 * Dispatch a full drag cycle (dragstart -> dragover -> drop -> dragend)
 * from the source block's drag handle to a position inside the target block.
 *
 * `dropZone`: 'top' = 20% into target height, 'bottom' = 80% into target height.
 * `xZone`: 'left' / 'center' / 'right' picks an X offset within the target.
 *   'left' targets the sibling-mode zone; 'right' targets nested-mode zones
 *   on listItem targets.
 */
export async function dragBlock(
  page: Page,
  sourceBlock: Locator,
  targetBlock: Locator,
  dropZone: 'top' | 'bottom' = 'bottom',
  xZone: 'left' | 'center' | 'right' = 'left',
): Promise<void> {
  await sourceBlock.hover();
  await expect(page.locator('.dm-block-handle')).toHaveAttribute('data-show', '');
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator('.dm-block-handle-drag');
  const targetBox = await targetBlock.boundingBox();
  expect(targetBox).not.toBeNull();
  if (!targetBox) return;

  const clientX =
    xZone === 'left' ? targetBox.x + 4
      : xZone === 'right' ? targetBox.x + targetBox.width - 4
        : targetBox.x + targetBox.width / 2;
  const clientY = dropZone === 'top'
    ? targetBox.y + targetBox.height * 0.2
    : targetBox.y + targetBox.height * 0.8;

  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  await page.locator(NOTION_EDITOR_SELECTOR).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
  await page.locator(NOTION_EDITOR_SELECTOR).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(80);
  await dt.dispose();
}

/**
 * Dispatch dragstart + dragover without committing the drop.
 * Returns the handle locator + DataTransfer JSHandle so the caller can
 * inspect the indicator state and call `endDrag` (or dispatch its own drop).
 */
export async function startDragOver(
  page: Page,
  sourceBlock: Locator,
  targetBlock: Locator,
): Promise<{ handle: Locator; dt: JSHandle<DataTransfer> }> {
  await sourceBlock.hover();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator('.dm-block-handle-drag');
  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  const targetBox = await targetBlock.boundingBox();
  if (!targetBox) throw new Error('target has no bounding box');
  const clientX = targetBox.x + 4;
  const clientY = targetBox.y + targetBox.height * 0.8;
  await page.locator(NOTION_EDITOR_SELECTOR).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
  return { handle, dt };
}

export async function endDrag(handle: Locator, dt: JSHandle<DataTransfer>): Promise<void> {
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await dt.dispose();
}

// ----------------------------------------------------------------------
// Clipboard / paste
// ----------------------------------------------------------------------

export async function pasteHtml(page: Page, html: string): Promise<void> {
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
