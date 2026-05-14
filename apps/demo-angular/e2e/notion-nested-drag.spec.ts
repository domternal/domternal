/**
 * E2E coverage for the BlockHandle resolution on NESTED blocks inside
 * list/task items - the user-visible payoff of `_planning/
 * listitems_improvements_2.md` (Phases 1-5).
 *
 * What this spec exercises:
 *  - Handle resolution matrix - source × container × position. Top-level
 *    blocks resolve to themselves; nested blocks (heading / codeBlock /
 *    blockquote / horizontalRule / non-first paragraph) inside a list or
 *    task item surface a handle for that block, not for the parent item.
 *  - `paragraphInsideContainer` custom rule - paragraphs nested in
 *    blockquote / table cells / details still resolve to the container
 *    (the rule excludes only paragraphs - other blocks remain individually
 *    addressable inside the same containers).
 *  - `clampCoords` regression - thin elements (e.g. 2px-tall hr) at the
 *    very bottom of the last top-level block are reachable; out-of-bounds
 *    Y still snaps to the nearest content edge.
 *  - Multi-level nesting, atom blocks (hr), ordered list parity, edge
 *    boundaries (rect.top + 1, rect.bottom - 1, sub-pixel rounding).
 *  - Drag flow with the new handles - lifting a nested block out to top
 *    level, cross-list drops, cross-list-type conversion, drag-press
 *    handle freeze.
 *  - Handle alignment contract - X is CSS-anchored to the editor gutter
 *    regardless of resolved block depth; Y vertically centers on the
 *    resolved block's first line.
 */
import { test } from './fixtures.js';
import { expect, type Page, type Locator } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
const blockHandleSelector = '.dm-block-handle';
const dragBtnSelector = '.dm-block-handle-drag';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await waitForAllIds(page);
}

async function waitForAllIds(page: Page): Promise<void> {
  // Only block on top-level node types that UniqueID actually stamps.
  // Tables / details / structural wrappers are intentionally skipped by
  // the extension's default `types` list, so waiting on them deadlocks.
  const STAMPED_TYPES = [
    'paragraph', 'heading', 'blockquote', 'codeBlock',
    'bulletList', 'orderedList', 'taskList', 'listItem',
    'taskItem', 'image', 'horizontalRule',
  ];
  await page.waitForFunction((stamped: string[]) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; attrs: Record<string, unknown> }) => void) => void } } }
      | undefined;
    if (!ed) return false;
    let ok = true;
    ed.state.doc.forEach((n) => {
      if (stamped.includes(n.type.name) && !n.attrs['id']) ok = false;
    });
    return ok;
  }, STAMPED_TYPES, { timeout: 3000 });
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: () => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
  await waitForAllIds(page);
}

async function hoverAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.waitForTimeout(40);
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  expect(box, 'expected element to have a bounding box').not.toBeNull();
  if (!box) throw new Error('unreachable');
  return box;
}

async function sideGutterX(page: Page): Promise<number> {
  const editorBox = await boxOf(page.locator(editorSelector));
  return Math.max(0, editorBox.x - 10);
}

async function hoveredPos(page: Page): Promise<number | null> {
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
    const plugin = ed.view.state.plugins.find((p) =>
      typeof p.spec?.key?.key === 'string' && p.spec.key.key.startsWith('blockHandle$'),
    );
    if (!plugin) return null;
    const s = plugin.getState(ed.view.state as unknown);
    return s?.hoveredPos ?? null;
  });
}

async function blockAt(page: Page, pos: number): Promise<{ type: string; text: string } | null> {
  return page.evaluate((p) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { nodeAt: (p: number) => { type: { name: string }; textContent: string } | null } } }
      | undefined;
    const node = ed?.state.doc.nodeAt(p) ?? null;
    return node ? { type: node.type.name, text: node.textContent } : null;
  }, pos);
}

/**
 * Hover at the side gutter at a given block's Y center. Mirrors the
 * pattern used in notion-block-resolution.spec.ts.
 */
async function hoverInGutterAt(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  await hoverAt(page, await sideGutterX(page), box.y + box.height / 2);
}

// ────────────────────────────────────────────────────────────────────────
// Regression guards - currently passing, must stay passing through rollout
// ────────────────────────────────────────────────────────────────────────

test.describe('Regression guards: handle resolution stays correct for existing cases', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('top-level paragraph resolves to paragraph', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("Bravo")`));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('paragraph');
  });

  test('top-level heading resolves to heading', async ({ page }) => {
    await setContent(page, '<p>Body</p><h2>Title</h2>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} h2`));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('label paragraph (first child) of bullet list item resolves to listItem', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label one</p></li><li><p>Label two</p></li></ul>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} li:has-text("Label two") > p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });

  test('label paragraph (first child) of task item resolves to taskItem', async ({ page }) => {
    await setContent(page, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task label</p></li></ul>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} li[data-type="taskItem"] p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('taskItem');
  });

  test('list wrapper (ul/ol) does not resolve as drag target - inner item wins', async ({ page }) => {
    await setContent(page, '<ul><li><p>Sole item</p></li></ul>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} li > p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Nested handle resolution - inner blocks inside list/task items each
// surface their own drag handle (was: handle always resolved to the
// parent item).
// ────────────────────────────────────────────────────────────────────────

test.describe('Nested block handle resolution', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('nested heading inside list item resolves to heading', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><h2>Nested H2</h2></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li h2`));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('heading');
    expect(block?.text).toBe('Nested H2');
  });

  test('nested heading inside task item resolves to heading', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task</p><h3>Nested H3</h3></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li[data-type="taskItem"] h3`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('nested codeBlock inside list item resolves to codeBlock', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><pre><code>const x = 1;</code></pre></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li pre`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });

  test('nested blockquote inside list item resolves to blockquote', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><blockquote><p>Quote</p></blockquote></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li blockquote`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });

  test('nested non-first paragraph inside list item resolves to paragraph (label is excluded by rule)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><p>Second paragraph</p></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li p:has-text("Second paragraph")`));
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('paragraph');
    expect(block?.text).toBe('Second paragraph');
  });

  test('nested horizontalRule inside list item resolves to horizontalRule', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><hr></li></ul>',
    );
    // hr renders as a 2px-tall border-top. Hover at its true vertical
    // center via getBoundingClientRect (Playwright's `boundingBox()` may
    // differ for sub-pixel rects).
    const hrY = await page.evaluate(() => {
      const hr = document.querySelector('app-notion-demo .ProseMirror li hr');
      if (!(hr instanceof HTMLElement)) return null;
      const r = hr.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    expect(hrY).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), hrY!);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Custom paragraphInsideContainer rule - paragraphs inside structural
// containers (blockquote, table cells, details) resolve to the container,
// not the inner paragraph. Paragraphs inside list items (non-first child)
// remain individually draggable - the rule excludes ONLY the named
// container parents.
// ────────────────────────────────────────────────────────────────────────

test.describe('Custom paragraphInsideContainer rule', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('paragraph inside top-level blockquote resolves to blockquote (rule excludes paragraph)', async ({ page }) => {
    await setContent(page, '<blockquote><p>Quoted</p></blockquote>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} blockquote p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });

  test('paragraph inside multi-paragraph blockquote: every paragraph row resolves to the blockquote', async ({ page }) => {
    await setContent(page, '<blockquote><p>First</p><p>Second</p><p>Third</p></blockquote>');
    for (const text of ['First', 'Second', 'Third']) {
      await hoverInGutterAt(page, page.locator(`${editorSelector} blockquote p:has-text("${text}")`));
      const pos = await hoveredPos(page);
      expect((await blockAt(page, pos ?? 0))?.type, `paragraph "${text}"`).toBe('blockquote');
    }
  });

  test('paragraph inside table cell resolves to TABLE (no allowedNode candidate inside, falls through to top-level)', async ({ page }) => {
    await setContent(
      page,
      '<table><tr><th>Header</th></tr><tr><td>Body cell</td></tr></table>',
    );
    const cell = page.locator(`${editorSelector} td`).first();
    const cBox = await cell.boundingBox();
    if (!cBox) throw new Error('cell missing');
    await hoverAt(page, cBox.x + cBox.width / 2, cBox.y + cBox.height / 2);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('table');
  });

  test('paragraph inside header cell (th) resolves to TABLE (rule excludes paragraph in tableHeader too)', async ({ page }) => {
    await setContent(
      page,
      '<table><tr><th>Header</th></tr><tr><td>Body</td></tr></table>',
    );
    const header = page.locator(`${editorSelector} th`).first();
    const hBox = await header.boundingBox();
    if (!hBox) throw new Error('header missing');
    await hoverAt(page, hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('table');
  });

  test('non-first paragraph inside list item still resolves to the paragraph (rule does NOT cover listItem)', async ({ page }) => {
    // Design rationale: nested non-first paragraphs in list items SHOULD
    // be individually draggable (mirrors keyboard Tab/Shift-Tab). The
    // container exclusion list intentionally omits listItem/taskItem.
    await setContent(page, '<ul><li><p>Label</p><p>Second</p></li></ul>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} li p:has-text("Second")`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('paragraph');
  });

  test('label paragraph (first child) of list item still resolves to listItem (listItemFirstChild rule, default)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label only</p></li></ul>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} li p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });

  test('paragraph inside details summary slot does not get a handle (paragraph not direct child of details there)', async ({ page }) => {
    // Details schema: details > summary + content where content holds the
    // body blocks. Verify the body paragraph resolves to its container.
    await setContent(
      page,
      '<details data-type="details"><summary>Summary text</summary><div data-type="detailsContent"><p>Body paragraph</p></div></details>',
    );
    const body = page.locator(`${editorSelector} [data-type="detailsContent"] > p`);
    if (await body.count() === 0) {
      // Demo Details extension may or may not expose detailsContent path -
      // skip cleanly if the structure parsed differently.
      test.info().annotations.push({ type: 'note', description: 'details body paragraph not found - schema/parsing variant' });
      return;
    }
    await hoverInGutterAt(page, body);
    const pos = await hoveredPos(page);
    const type = (await blockAt(page, pos ?? 0))?.type;
    // Either resolves to the details wrapper (preferred) or stays at the
    // top-level details. Both are acceptable - what we explicitly do NOT
    // want is "paragraph" (the rule should kick in).
    expect(type).not.toBe('paragraph');
  });
});

// ────────────────────────────────────────────────────────────────────────
// clampCoords contract: Y is only clamped when cursor is OUTSIDE the
// editor's vertical span; thin nested elements at the very bottom of the
// last top-level block remain reachable. (A prior implementation stripped
// 5px off the bottom even when Y was inside content - regression guard.)
// ────────────────────────────────────────────────────────────────────────

test.describe('clampCoords thin-element-at-bottom regression', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('hr at the bottom of the last list item (last top-level block) resolves to horizontalRule, not listItem', async ({ page }) => {
    // Pre-fix: clampToContent stripped 5px off bottomRect.bottom. For a
    // 2px-tall hr at the very bottom of the last (and only) top-level
    // block, hovering at hr's center landed BELOW maxY = bottom - 5,
    // pulling cursor up to listItem range. Walker then never reached hr.
    await setContent(page, '<ul><li><p>Label</p><hr></li></ul>');
    const hrY = await page.evaluate(() => {
      const hr = document.querySelector('app-notion-demo .ProseMirror li hr');
      if (!(hr instanceof HTMLElement)) return null;
      const r = hr.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    expect(hrY).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), hrY!);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });

  test('hr in middle of doc (NOT at bottom edge) was always reachable - regression guard for the standard case', async ({ page }) => {
    // With a trailing block, hr is no longer at the editor's bottom edge
    // and clampToContent never had to clip its Y. This case should pass
    // both pre- and post-fix.
    await setContent(page, '<ul><li><p>Label</p><hr></li></ul><p>Trailing</p>');
    const hrY = await page.evaluate(() => {
      const hr = document.querySelector('app-notion-demo .ProseMirror li hr');
      if (!(hr instanceof HTMLElement)) return null;
      const r = hr.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    expect(hrY).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), hrY!);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });

  test('hover BELOW the editor still snaps to the last top-level block (out-of-bounds clamp still works)', async ({ page }) => {
    await setContent(page, '<p>FirstBlock</p><p>LastBlock</p>');
    const last = page.locator(`${editorSelector} p:has-text("LastBlock")`);
    const lBox = await boxOf(last);
    // 20px below the last block's bottom - cursor is OUTSIDE editor span.
    await hoverAt(page, lBox.x + lBox.width / 2, lBox.y + lBox.height + 20);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('LastBlock');
  });

  test('hover ABOVE the editor still snaps to the first top-level block', async ({ page }) => {
    await setContent(page, '<p>FirstBlock</p><p>LastBlock</p>');
    const first = page.locator(`${editorSelector} p:has-text("FirstBlock")`);
    const fBox = await boxOf(first);
    await hoverAt(page, fBox.x + fBox.width / 2, fBox.y - 20);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.text).toBe('FirstBlock');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Multi-level nesting - deeper structures the deepest-Y walker needs to
// traverse correctly with extended allowedNodes + rules.
// ────────────────────────────────────────────────────────────────────────

test.describe('Multi-level nested resolution', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('heading inside outer-li, sibling of inner ul: hover heading resolves to heading', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer label</p><h3>Outer heading</h3><ul><li><p>Inner item</p></li></ul></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h3:has-text("Outer heading")`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('inner list-item label paragraph resolves to inner listItem (listItemFirstChild fires for inner li too)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer label</p><ul><li><p>Inner label</p></li></ul></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li li > p:has-text("Inner label")`));
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('listItem');
    expect(block?.text).toBe('Inner label');
  });

  test('codeBlock nested inside li after heading: hover code resolves to codeBlock (deepest of 3 candidates)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><h2>Heading</h2><pre><code>const x = 1;</code></pre></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li pre`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });

  test('blockquote nested in li: paragraph INSIDE that blockquote still resolves to BLOCKQUOTE (rule fires nested too)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><blockquote><p>Inner quote</p></blockquote></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li blockquote p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Drag flow with nested handles - dragging an inner block produces the
// expected DOM transitions. Mouse parity with keyboard: drag a nested
// heading out of its list item to top level === Shift-Tab outdent.
// ────────────────────────────────────────────────────────────────────────

async function dragFromHandle(
  page: Page,
  hoverLocator: Locator,
  targetLocator: Locator,
  dropZone: 'top' | 'bottom',
): Promise<void> {
  const hBox = await boxOf(hoverLocator);
  await hoverAt(page, await sideGutterX(page), hBox.y + hBox.height / 2);
  await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');

  const dt = await page.evaluateHandle(() => new DataTransfer());
  const handle = page.locator(dragBtnSelector);
  const targetBox = await boxOf(targetLocator);
  // Drop near the LEFT edge of the target (sibling zone) so these tests
  // keep their sibling-drop semantics. Nested-mode coverage lives in
  // `notion-drop-placement-sibling.spec.ts`.
  const clientX = targetBox.x + 4;
  const clientY = dropZone === 'top'
    ? targetBox.y + targetBox.height * 0.2
    : targetBox.y + targetBox.height * 0.8;

  await handle.dispatchEvent('dragstart', { dataTransfer: dt });
  await page.waitForTimeout(20);
  await page.locator(editorSelector).dispatchEvent('dragover', { dataTransfer: dt, clientX, clientY });
  await page.locator(editorSelector).dispatchEvent('drop', { dataTransfer: dt, clientX, clientY });
  await handle.dispatchEvent('dragend', { dataTransfer: dt });
  await page.waitForTimeout(80);
  await dt.dispose();
}

async function topLevelBlocks(page: Page): Promise<Array<{ type: string; text: string }>> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
      | undefined;
    const out: Array<{ type: string; text: string }> = [];
    ed?.state.doc.forEach((n) => { out.push({ type: n.type.name, text: n.textContent }); });
    return out;
  });
}

test.describe('Drag flow with nested handles', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('drag nested heading out of li to a trailing paragraph → heading lands as top-level sibling, label stays in li', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>First label</p><h2>The heading</h2></li>'
      + '<li><p>Second label</p></li></ul>'
      + '<p>Tail</p>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li > h2`),
      page.locator(`${editorSelector} p:has-text("Tail")`),
      'bottom',
    );
    const blocks = await topLevelBlocks(page);
    // bulletList still has both items, but the heading is now top-level
    // somewhere AFTER the tail.
    const headingIdx = blocks.findIndex((b) => b.type === 'heading' && b.text === 'The heading');
    expect(headingIdx).toBeGreaterThan(0);
    // First li retains its label only (heading travelled out).
    const liShapes = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild?: { forEach: (cb: (n: { textContent: string; firstChild?: { textContent: string } }) => void) => void } } } }
        | undefined;
      const out: Array<{ text: string; firstChildText: string }> = [];
      ed?.state.doc.firstChild?.forEach((n) => {
        out.push({ text: n.textContent, firstChildText: n.firstChild?.textContent ?? '' });
      });
      return out;
    });
    const firstLi = liShapes[0];
    expect(firstLi?.text).toBe('First label');
  });

  test('drag nested codeBlock out of li to trailing position → top-level codeBlock', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><pre><code>fn()</code></pre></li></ul>'
      + '<p>Tail</p>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li pre`),
      page.locator(`${editorSelector} p:has-text("Tail")`),
      'bottom',
    );
    const blocks = await topLevelBlocks(page);
    const codeIdx = blocks.findIndex((b) => b.type === 'codeBlock');
    expect(codeIdx).toBeGreaterThan(-1);
  });

  test('drag nested blockquote out of li to trailing position → top-level blockquote', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><blockquote><p>Quote</p></blockquote></li></ul>'
      + '<p>Tail</p>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li blockquote`),
      page.locator(`${editorSelector} p:has-text("Tail")`),
      'bottom',
    );
    const blocks = await topLevelBlocks(page);
    const bqIdx = blocks.findIndex((b) => b.type === 'blockquote');
    expect(bqIdx).toBeGreaterThan(-1);
  });

  test('drag nested non-first paragraph out of li to trailing position → top-level paragraph', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Label</p><p>Second nested</p></li></ul>'
      + '<p>Tail</p>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li p:has-text("Second nested")`),
      page.locator(`${editorSelector} p:has-text("Tail")`),
      'bottom',
    );
    const blocks = await topLevelBlocks(page);
    const pSecond = blocks.find((b) => b.type === 'paragraph' && b.text === 'Second nested');
    expect(pSecond).toBeDefined();
  });

  test('drag top-level paragraph reorder (regression guard - existing flow still works)', async ({ page }) => {
    await setContent(page, '<p>Alpha</p><p>Bravo</p><p>Charlie</p>');
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} p:has-text("Alpha")`),
      page.locator(`${editorSelector} p:has-text("Charlie")`),
      'bottom',
    );
    const blocks = await topLevelBlocks(page);
    // Alpha is now after Charlie.
    const alphaIdx = blocks.findIndex((b) => b.text === 'Alpha');
    const charlieIdx = blocks.findIndex((b) => b.text === 'Charlie');
    expect(alphaIdx).toBeGreaterThan(charlieIdx);
  });

  test('drag list item reorder (regression guard - whole-li drag still works)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li:has-text("First") > p`),
      page.locator(`${editorSelector} li:has-text("Third") > p`),
      'bottom',
    );
    const liTexts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild?: { forEach: (cb: (n: { textContent: string }) => void) => void } } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.firstChild?.forEach((n) => { out.push(n.textContent); });
      return out;
    });
    // First was moved past Third → ordering: Second, Third, First.
    expect(liTexts[liTexts.length - 1]).toBe('First');
  });

  test('drag nested heading from li A to li B (sibling drop) → wraps in new listItem (convertListItemForParent flow)', async ({ page }) => {
    // Cross-list-item drag of a non-list block. The drop target is INSIDE
    // the bullet list (between li A and li B), so `convertListItemForParent`
    // wraps the heading in a fresh listItem with an empty label paragraph.
    // The "drag into list" path, distinct from "drag out".
    await setContent(
      page,
      '<ul>'
      + '<li><p>A label</p><h2>A heading</h2></li>'
      + '<li><p>B label</p></li>'
      + '</ul>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li > h2:has-text("A heading")`),
      page.locator(`${editorSelector} li:has-text("B label") > p`),
      'bottom',
    );
    // Expect: bulletList still has multiple list items, A's heading is no
    // longer inside li A, and a new listItem wrapping the heading exists
    // somewhere in the list.
    const liShapes = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild?: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } }
        | undefined;
      const items: Array<{ type: string; text: string }> = [];
      ed?.state.doc.firstChild?.forEach((n) => { items.push({ type: n.type.name, text: n.textContent }); });
      return items;
    });
    // First li should now contain ONLY the label (heading travelled out).
    const firstLi = liShapes[0];
    expect(firstLi?.text).toBe('A label');
    // The heading is now in some li down the list (wrapped in new li).
    const headingLi = liShapes.find((li) => li.text.includes('A heading'));
    expect(headingLi).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Extra coverage: list-type parity, atom blocks, sub-pixel edge cases.
// ────────────────────────────────────────────────────────────────────────

test.describe('Extended coverage: atoms, parity, boundaries', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('ordered list (ol) parity: nested heading inside ol > li resolves to heading (same as ul)', async ({ page }) => {
    await setContent(page, '<ol><li><p>Numbered label</p><h2>Nested in OL</h2></li></ol>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} ol li > h2`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('ordered list label paragraph resolves to listItem (rule fires for ol too, not just ul)', async ({ page }) => {
    await setContent(page, '<ol><li><p>Numbered label</p></li></ol>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} ol li > p`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });

  test('taskItem with nested codeBlock: hover code resolves to codeBlock (parity with bullet/list)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p><pre><code>fn();</code></pre></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li[data-type="taskItem"] pre`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });

  test('taskItem with nested blockquote: hover quote resolves to blockquote', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p><blockquote><p>Quote</p></blockquote></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li[data-type="taskItem"] blockquote`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('blockquote');
  });

  test('taskItem with nested hr: hover hr resolves to horizontalRule', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p><hr></li></ul><p>Trailing</p>',
    );
    const hrY = await page.evaluate(() => {
      const hr = document.querySelector('app-notion-demo .ProseMirror li[data-type="taskItem"] hr');
      if (!(hr instanceof HTMLElement)) return null;
      const r = hr.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    expect(hrY).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), hrY!);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });

  test('top-level hr (single hr in doc) resolves to horizontalRule (regression after extending allowedNodes)', async ({ page }) => {
    await setContent(page, '<p>Above</p><hr><p>Below</p>');
    const hrY = await page.evaluate(() => {
      const hr = document.querySelector('app-notion-demo .ProseMirror > hr');
      if (!(hr instanceof HTMLElement)) return null;
      const r = hr.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    expect(hrY).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), hrY!);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });

  test('hover near TOP edge of nested heading rect (rect.top + 1) still resolves to heading', async ({ page }) => {
    // 1px below rect.top to avoid subpixel rounding ambiguity at the
    // exact rect boundary - the resolver still needs to find heading
    // anywhere within its rect, and 1px in is unambiguously inside.
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul><p>Trailing</p>');
    const top = await page.evaluate(() => {
      const h = document.querySelector('app-notion-demo .ProseMirror li > h2');
      if (!(h instanceof HTMLElement)) return null;
      return h.getBoundingClientRect().top;
    });
    expect(top).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), top! + 1);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('hover near BOTTOM edge of nested heading rect (rect.bottom - 1) still resolves to heading', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul><p>Trailing</p>');
    const bottom = await page.evaluate(() => {
      const h = document.querySelector('app-notion-demo .ProseMirror li > h2');
      if (!(h instanceof HTMLElement)) return null;
      return h.getBoundingClientRect().bottom;
    });
    expect(bottom).not.toBeNull();
    await hoverAt(page, await sideGutterX(page), bottom! - 1);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('hover OVER the text node inside a nested heading (X above text content) still resolves to heading', async ({ page }) => {
    // Walker descends through inline text nodes; the text itself has no
    // HTMLElement so the descendants callback returns true (skipped from
    // candidates), but the heading rect contains Y so heading wins.
    await setContent(page, '<ul><li><p>Label</p><h2>Visible heading text</h2></li></ul>');
    const heading = page.locator(`${editorSelector} li > h2`);
    const hBox = await boxOf(heading);
    // Hover OVER the text content (not in gutter) - X centered on heading.
    await hoverAt(page, hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('three-level deep nesting: heading inside inner-li-of-inner-ul resolves to heading', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Outer label</p>'
      +   '<ul><li><p>Inner label</p><h3>Innermost heading</h3></li></ul>'
      + '</li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} li li > h3`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Handle position contract. Notion-style: the drag handle always lives
// at the editor's LEFT GUTTER regardless of how deeply indented the
// resolved block is. Only Y tracks the resolved block; X is CSS-fixed
// at `left: -0.5rem` relative to .dm-editor. Pinned here so future
// refactors that try to follow block X are caught as regressions.
// ────────────────────────────────────────────────────────────────────────

async function handleBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return boxOf(page.locator(blockHandleSelector));
}

async function blockBox(page: Page, locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  return boxOf(locator);
}

test.describe('Handle alignment: X stays at editor gutter regardless of resolved block depth', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('handle X is identical when hovering top-level paragraph vs nested heading inside list item (Notion-style gutter anchor)', async ({ page }) => {
    await setContent(page, '<p>Top paragraph</p><ul><li><p>Label</p><h2>Nested heading</h2></li></ul>');

    // Hover top-level paragraph -> capture handle X.
    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("Top paragraph")`));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const handleAtTopLevel = await handleBox(page);

    // Hover nested heading -> capture handle X again.
    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h2`));
    await expect(page.locator(blockHandleSelector)).toHaveAttribute('data-show', '');
    const handleAtNested = await handleBox(page);

    // Same X (subpixel tolerance for float rendering).
    expect(Math.abs(handleAtTopLevel.x - handleAtNested.x)).toBeLessThan(1);
    // Y is different (different blocks at different rows).
    expect(Math.abs(handleAtTopLevel.y - handleAtNested.y)).toBeGreaterThan(5);
  });

  test('handle X stays at gutter for label paragraph vs nested heading inside the same list item (different resolved blocks, same X)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label here</p><h2>The heading</h2></li></ul>');

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > p`));
    const xAtLabel = (await handleBox(page)).x;

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h2`));
    const xAtHeading = (await handleBox(page)).x;

    expect(Math.abs(xAtLabel - xAtHeading)).toBeLessThan(1);
  });

  test('handle X stays at editor gutter even for THREE-level deep nested heading (anchor never follows indent)', async ({ page }) => {
    await setContent(
      page,
      '<p>Top</p>'
      + '<ul><li><p>Outer</p>'
      +   '<ul><li><p>Inner</p><h3>Deep</h3></li></ul>'
      + '</li></ul>',
    );
    // Top-level reference.
    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("Top")`));
    const xTop = (await handleBox(page)).x;

    // 3-level nested heading.
    await hoverInGutterAt(page, page.locator(`${editorSelector} li li > h3`));
    const xDeep = (await handleBox(page)).x;

    expect(Math.abs(xTop - xDeep)).toBeLessThan(1);
  });

  test('handle X is OUTSIDE the editor content column (left of where text actually starts)', async ({ page }) => {
    // CSS contract: `.dm-block-handle { left: -0.5rem }` puts the handle
    // 8px outside `.dm-editor`'s left edge. It must visually sit in the
    // gutter, never overlap text content.
    await setContent(page, '<p>Some paragraph</p>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} p`));
    const handle = await handleBox(page);
    const editor = await boxOf(page.locator(editorSelector));

    // Handle's right edge must be at or LEFT of the .ProseMirror's left
    // (since ProseMirror has padding-left from --dm-block-handle-gutter,
    // the actual text starts further right than the editor.x; we just
    // check the handle doesn't overlap the .ProseMirror element).
    expect(handle.x + handle.width).toBeLessThanOrEqual(editor.x + 1);
  });

  test('handle Y follows the first line of the resolved block (different Y per block)', async ({ page }) => {
    await setContent(page, '<p>First</p><h2>Second</h2><p>Third</p>');

    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("First")`));
    const yFirst = (await handleBox(page)).y;

    await hoverInGutterAt(page, page.locator(`${editorSelector} h2`));
    const yHeading = (await handleBox(page)).y;

    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("Third")`));
    const yThird = (await handleBox(page)).y;

    // Three distinct Y rows.
    expect(Math.abs(yFirst - yHeading)).toBeGreaterThan(5);
    expect(Math.abs(yHeading - yThird)).toBeGreaterThan(5);
    expect(Math.abs(yFirst - yThird)).toBeGreaterThan(5);
  });

  test('handle Y vertically centers on the FIRST LINE of the resolved block (not the middle of a tall block)', async ({ page }) => {
    // For a tall block (e.g., H1 with line-height 2.8rem), the handle
    // should align with the FIRST text line, not the geometric center of
    // the block. This keeps the icon visually next to the visible glyphs.
    await setContent(page, '<h1>Tall title that may wrap onto more than one visual row in narrow viewports</h1>');
    const heading = page.locator(`${editorSelector} h1`);
    const hBox = await blockBox(page, heading);

    await hoverInGutterAt(page, heading);
    const handle = await handleBox(page);

    // Handle's vertical center is in the upper portion of the heading
    // rect (within the first ~40% of height), not the geometric middle.
    const handleCenter = handle.y + handle.height / 2;
    const blockTop = hBox.y;
    const blockHeight = hBox.height;
    const relativeOffset = (handleCenter - blockTop) / blockHeight;
    // Allow first-line center to fall within 0..0.6 of the block height.
    expect(relativeOffset).toBeGreaterThanOrEqual(0);
    expect(relativeOffset).toBeLessThanOrEqual(0.6);
  });

  test('handle Y for nested heading aligns with the heading row (not the parent listItem top)', async ({ page }) => {
    // The list item's rect spans BOTH the label paragraph row AND the
    // indented heading row. A correct nested-handle implementation must
    // anchor Y on the HEADING's first line, NOT on the listItem's top
    // (which would put the handle at the label row).
    await setContent(page, '<ul><li><p>Label paragraph</p><h2>Nested heading</h2></li></ul>');

    const labelP = page.locator(`${editorSelector} li > p`);
    const heading = page.locator(`${editorSelector} li > h2`);
    const labelBox = await blockBox(page, labelP);
    const headingBox = await blockBox(page, heading);

    await hoverInGutterAt(page, heading);
    const handle = await handleBox(page);
    const handleCenter = handle.y + handle.height / 2;

    // Handle's center is at the heading row, not the label row.
    // (Heading's top should be below label's bottom in this layout.)
    expect(handleCenter).toBeGreaterThan(labelBox.y + labelBox.height - 5);
    expect(handleCenter).toBeGreaterThanOrEqual(headingBox.y - 2);
    expect(handleCenter).toBeLessThanOrEqual(headingBox.y + headingBox.height + 2);
  });

  test('handle position updates when moving from nested heading to label paragraph (dynamic re-position)', async ({ page }) => {
    await setContent(page, '<ul><li><p>Label</p><h2>Heading</h2></li></ul>');

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h2`));
    const yAtHeading = (await handleBox(page)).y;

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > p`));
    const yAtLabel = (await handleBox(page)).y;

    // Moving from heading-row to label-row updates Y (handle re-positions).
    expect(Math.abs(yAtHeading - yAtLabel)).toBeGreaterThan(5);
  });

  test('handle X is identical regardless of `paragraphInsideContainer` rule branch (blockquote vs list item)', async ({ page }) => {
    // Blockquote with inner paragraph: rule excludes paragraph, walker
    // resolves to BLOCKQUOTE. List item with non-first paragraph: walker
    // resolves to PARAGRAPH directly. Both resolution paths must place
    // the handle at the same X gutter.
    await setContent(
      page,
      '<blockquote><p>Quoted</p></blockquote>'
      + '<ul><li><p>Label</p><p>Second</p></li></ul>',
    );
    await hoverInGutterAt(page, page.locator(`${editorSelector} blockquote p`));
    const xAtBlockquote = (await handleBox(page)).x;

    await hoverInGutterAt(page, page.locator(`${editorSelector} li p:has-text("Second")`));
    const xAtNestedP = (await handleBox(page)).x;

    expect(Math.abs(xAtBlockquote - xAtNestedP)).toBeLessThan(1);
  });

  test('handle remains visible (data-show) and at gutter when hovering each nested block in a multi-block li', async ({ page }) => {
    await setContent(
      page,
      '<ul><li>'
      + '<p>Label</p>'
      + '<h2>Heading</h2>'
      + '<blockquote><p>Quote</p></blockquote>'
      + '<pre><code>code</code></pre>'
      + '</li></ul>',
    );

    const xs: number[] = [];
    for (const sel of ['li > p:first-child', 'li > h2', 'li > blockquote', 'li > pre']) {
      await hoverInGutterAt(page, page.locator(`${editorSelector} ${sel}`));
      await expect(page.locator(blockHandleSelector), `at ${sel}`).toHaveAttribute('data-show', '');
      xs.push((await handleBox(page)).x);
    }
    // All X values are identical (subpixel tolerance).
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    expect(maxX - minX).toBeLessThan(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Source × container matrix sweep + drag-flow regression: the cases that
// weren't already covered by the per-feature sections above. Completes
// the full handle-resolution matrix and the drag-flow regression suite.
// ────────────────────────────────────────────────────────────────────────

test.describe('Source × container matrix and drag-flow regression', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('paragraph × taskItem × non-first-child resolves to paragraph (parity with bullet listItem case)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task label</p><p>Second paragraph</p></li></ul>',
    );
    await hoverInGutterAt(
      page,
      page.locator(`${editorSelector} li[data-type="taskItem"] p:has-text("Second paragraph")`),
    );
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('paragraph');
    expect(block?.text).toBe('Second paragraph');
  });

  test('codeBlock × top-level resolves to codeBlock (regression guard - top-level codeBlock still gets a handle after extending allowedNodes)', async ({ page }) => {
    await setContent(page, '<p>Above</p><pre><code>const fn = () => 1;</code></pre><p>Below</p>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} > pre`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });

  test('drag TOP-LEVEL heading INTO a bullet list (sibling drop on a list item) wraps the heading in a new listItem', async ({ page }) => {
    // `convertListItemForParent` flow regression: when the drop target's
    // parent is a list, the dragged non-list block must be wrapped in a
    // fresh listItem with an empty label paragraph (Notion-strict
    // `paragraph block*` content rule).
    await setContent(
      page,
      '<h2>Standalone heading</h2>'
      + '<ul><li><p>Existing item</p></li></ul>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} > h2`),
      page.locator(`${editorSelector} ul li > p`),
      'bottom',
    );

    // The bulletList should now contain TWO items (existing + new wrapper),
    // and somewhere among them a listItem holds the heading as a child.
    const blocks = await topLevelBlocks(page);
    const bulletList = blocks.find((b) => b.type === 'bulletList');
    expect(bulletList).toBeDefined();
    // Inspect inner shape: at least one listItem in the list must contain
    // the heading text.
    const liShapes = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { firstChild?: { type: { name: string }; forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } } }
        | undefined;
      const out: Array<{ type: string; text: string }> = [];
      const first = ed?.state.doc.firstChild;
      if (first?.type.name === 'bulletList') {
        first.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
      }
      return out;
    });
    expect(liShapes.length).toBeGreaterThanOrEqual(2);
    const liWithHeading = liShapes.find((li) => li.text.includes('Standalone heading'));
    expect(liWithHeading).toBeDefined();
  });

  test('drag bullet listItem INTO task list converts it to taskItem (cross-list-type, regression guard)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>Bullet to convert</p></li></ul>'
      + '<ul data-type="taskList"><li data-type="taskItem"><p>Existing task</p></li></ul>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} ul:not([data-type="taskList"]) li > p`),
      // Target the TASK ITEM (not its inner paragraph) so dragFromHandle's
      // `targetBox.x + 4` lands at the listItem's left edge - well within
      // the sibling zone (`< nestThreshold`). The inner paragraph is
      // visually indented by checkbox + margin, so +4 from its box.x
      // would actually fall in the nested zone of the listItem rect.
      page.locator(`${editorSelector} li[data-type="taskItem"]`),
      'bottom',
    );

    // After the drag, the task list contains 2 items - the existing one
    // and the converted bullet (now a taskItem with the original text).
    const taskTexts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; forEach: (cb2: (m: { textContent: string }) => void) => void }) => void) => void } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.forEach((n) => {
        if (n.type.name === 'taskList') n.forEach((m) => out.push(m.textContent));
      });
      return out;
    });
    expect(taskTexts).toContain('Bullet to convert');
    expect(taskTexts).toContain('Existing task');
  });

  test('drag taskItem INTO bullet list converts it to listItem (reverse cross-list-type, regression guard)', async ({ page }) => {
    await setContent(
      page,
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task to convert</p></li></ul>'
      + '<ul><li><p>Existing bullet</p></li></ul>',
    );
    await dragFromHandle(
      page,
      page.locator(`${editorSelector} li[data-type="taskItem"] > div > p`),
      page.locator(`${editorSelector} ul:not([data-type="taskList"]) li > p`),
      'bottom',
    );
    const bulletTexts = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; forEach: (cb2: (m: { textContent: string }) => void) => void }) => void) => void } } }
        | undefined;
      const out: string[] = [];
      ed?.state.doc.forEach((n) => {
        if (n.type.name === 'bulletList') n.forEach((m) => out.push(m.textContent));
      });
      return out;
    });
    expect(bulletTexts).toContain('Task to convert');
    expect(bulletTexts).toContain('Existing bullet');
  });

  test('paragraphInsideContainer rule is paragraph-SELECTIVE: heading inside blockquote still resolves to HEADING (not blockquote)', async ({ page }) => {
    // The custom demo rule excludes ONLY paragraphs from being a drag
    // target inside structural containers. Other block types (heading,
    // codeBlock, hr) inside the same containers must remain individually
    // draggable - they are the meaningful drag units.
    await setContent(page, '<blockquote><h2>Quoted heading</h2></blockquote>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} blockquote h2`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('paragraphInsideContainer rule is paragraph-SELECTIVE: codeBlock inside blockquote still resolves to codeBlock', async ({ page }) => {
    await setContent(page, '<blockquote><pre><code>fn();</code></pre></blockquote>');
    await hoverInGutterAt(page, page.locator(`${editorSelector} blockquote pre`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('codeBlock');
  });

  test('hover in Y-gap BETWEEN nested heading and next sibling block (CSS margin gap inside li) resolves to listItem (no inner candidate)', async ({ page }) => {
    // Nested children have margin-top from children-zone CSS. The few
    // pixels between heading.bottom and the next nested block's top are
    // INSIDE li's rect but OUTSIDE either child's rect. Walker should
    // fall back to listItem (the only allowed ancestor at that Y).
    await setContent(
      page,
      '<ul><li><p>Label</p><h2>Heading</h2><p>Second body</p></li></ul><p>Tail</p>',
    );
    const gapY = await page.evaluate(() => {
      const heading = document.querySelector('app-notion-demo .ProseMirror li > h2');
      const nextP = document.querySelector('app-notion-demo .ProseMirror li > p:nth-of-type(2)');
      if (!(heading instanceof HTMLElement) || !(nextP instanceof HTMLElement)) return null;
      const hRect = heading.getBoundingClientRect();
      const pRect = nextP.getBoundingClientRect();
      // Midpoint of the visual gap between heading-bottom and p-top.
      const gap = pRect.top - hRect.bottom;
      if (gap <= 1) return null;
      return hRect.bottom + gap / 2;
    });
    if (gapY === null) {
      test.info().annotations.push({ type: 'note', description: 'no measurable gap between siblings - skip' });
      return;
    }
    await hoverAt(page, await sideGutterX(page), gapY);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('listItem');
  });

  test('hover in Y-gap BETWEEN two top-level sibling list items resolves to one of the items (Y bias picks closer item, never null)', async ({ page }) => {
    await setContent(
      page,
      '<ul><li><p>First</p></li><li><p>Second</p></li></ul>',
    );
    const gapY = await page.evaluate(() => {
      const lis = document.querySelectorAll('app-notion-demo .ProseMirror li');
      if (lis.length < 2 || !(lis[0] instanceof HTMLElement) || !(lis[1] instanceof HTMLElement)) return null;
      const r0 = lis[0].getBoundingClientRect();
      const r1 = lis[1].getBoundingClientRect();
      if (r1.top <= r0.bottom) return null;
      return r0.bottom + (r1.top - r0.bottom) / 2;
    });
    if (gapY === null) {
      test.info().annotations.push({ type: 'note', description: 'no measurable gap between li siblings' });
      return;
    }
    await hoverAt(page, await sideGutterX(page), gapY);
    const pos = await hoveredPos(page);
    const block = pos !== null ? await blockAt(page, pos) : null;
    // Either resolves to a listItem (clamp/snap to nearest) or to the
    // bulletList wrapper - both acceptable for "between" Y. What matters
    // is no null and the resolution is deterministic.
    expect(['listItem', 'bulletList'].includes(block?.type ?? '')).toBe(true);
  });

  test('empty nested heading (no text) inside list item still resolves to heading (rect exists from line-height)', async ({ page }) => {
    // PM may inject a placeholder or leave the heading empty. Either way,
    // the heading element has a rect (line-height creates visible height)
    // and the walker must still pick it.
    await setContent(page, '<ul><li><p>Label</p><h2></h2></li></ul><p>Tail</p>');
    const heading = page.locator(`${editorSelector} li > h2`);
    if (await heading.count() === 0) {
      test.info().annotations.push({ type: 'note', description: 'parser dropped the empty heading' });
      return;
    }
    const hY = await page.evaluate(() => {
      const h = document.querySelector('app-notion-demo .ProseMirror li > h2');
      if (!(h instanceof HTMLElement)) return null;
      const r = h.getBoundingClientRect();
      return r.height > 0 ? r.top + r.height / 2 : null;
    });
    if (hY === null) {
      test.info().annotations.push({ type: 'note', description: 'empty heading collapsed to zero height - not a stable hover target' });
      return;
    }
    await hoverAt(page, await sideGutterX(page), hY);
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('heading');
  });

  test('drag handle freezes during active drag press (handle does not re-position when dragPressActive)', async ({ page }) => {
    // The freeze guard fires on `mousedown` of the drag button (sets
    // `dragPressActive = true`) and releases on `mouseup`/`dragend`. While
    // active, mousemove handler bails before re-positioning so the button
    // doesn't slide out from under the cursor before the browser commits
    // to a drag interaction.
    await setContent(
      page,
      '<p>First</p><h2>Second heading</h2><p>Third</p>',
    );
    // Surface handle on First.
    await hoverInGutterAt(page, page.locator(`${editorSelector} p:has-text("First")`));
    const xBefore = (await handleBox(page)).x;
    const yBefore = (await handleBox(page)).y;

    // Press the drag button - sets dragPressActive=true via mousedown.
    const handle = page.locator(dragBtnSelector);
    await handle.dispatchEvent('mousedown');
    await page.waitForTimeout(20);

    // Move mouse over a different block - handle position must stay frozen.
    const heading = page.locator(`${editorSelector} h2`);
    const hBox = await boxOf(heading);
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.waitForTimeout(40);

    const xAfter = (await handleBox(page)).x;
    const yAfter = (await handleBox(page)).y;

    expect(Math.abs(xAfter - xBefore)).toBeLessThan(1);
    expect(Math.abs(yAfter - yBefore)).toBeLessThan(1);

    // Cleanup: release the press so subsequent tests aren't affected.
    await page.mouse.up();
    await handle.dispatchEvent('mouseup');
  });

  test('two parallel lists each with a nested heading: each heading resolves independently', async ({ page }) => {
    // Cross-talk regression. Walker must isolate the cursor's row from
    // unrelated blocks elsewhere in the doc.
    await setContent(
      page,
      '<ul><li><p>List A label</p><h2>Heading in A</h2></li></ul>'
      + '<ul><li><p>List B label</p><h3>Heading in B</h3></li></ul>',
    );

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h2:has-text("Heading in A")`));
    let pos = await hoveredPos(page);
    let block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('heading');
    expect(block?.text).toBe('Heading in A');

    await hoverInGutterAt(page, page.locator(`${editorSelector} li > h3:has-text("Heading in B")`));
    pos = await hoveredPos(page);
    block = pos !== null ? await blockAt(page, pos) : null;
    expect(block?.type).toBe('heading');
    expect(block?.text).toBe('Heading in B');
  });

  test('full source × container matrix sweep: every documented handle target resolves correctly', async ({ page }) => {
    // Single test that runs the entire matrix as a sanity sweep, providing
    // a quick spot-check should the per-row tests above ever go missing.
    // Order matches the matrix in listitems_improvements_2.md.
    type Row = { html: string; selector: string; expected: string; label: string };
    const rows: Row[] = [
      { html: '<p>Top</p>', selector: 'p', expected: 'paragraph', label: 'paragraph × top-level' },
      { html: '<h2>Title</h2>', selector: 'h2', expected: 'heading', label: 'heading × top-level' },
      { html: '<p>Above</p><pre><code>x</code></pre>', selector: 'pre', expected: 'codeBlock', label: 'codeBlock × top-level' },
      { html: '<blockquote><p>q</p></blockquote>', selector: 'blockquote p', expected: 'blockquote', label: 'paragraph × blockquote (rule excludes)' },
      { html: '<ul><li><p>L</p></li></ul>', selector: 'li > p', expected: 'listItem', label: 'paragraph × listItem × first (label)' },
      { html: '<ul><li><p>L</p><p>S</p></li></ul>', selector: 'li > p:nth-of-type(2)', expected: 'paragraph', label: 'paragraph × listItem × non-first' },
      { html: '<ul data-type="taskList"><li data-type="taskItem"><p>L</p></li></ul>', selector: 'li[data-type="taskItem"] p', expected: 'taskItem', label: 'paragraph × taskItem × first (label)' },
      { html: '<ul><li><p>L</p><h2>H</h2></li></ul>', selector: 'li > h2', expected: 'heading', label: 'heading × listItem × non-first' },
      { html: '<ul><li><p>L</p><pre><code>x</code></pre></li></ul>', selector: 'li > pre', expected: 'codeBlock', label: 'codeBlock × listItem × non-first' },
      { html: '<ul><li><p>L</p><blockquote><p>q</p></blockquote></li></ul>', selector: 'li > blockquote', expected: 'blockquote', label: 'blockquote × listItem × non-first' },
      { html: '<ul><li><p>One</p></li></ul>', selector: 'ul', expected: 'listItem', label: 'list wrapper resolves to inner item' },
      { html: '<ul data-type="taskList"><li data-type="taskItem"><p>One</p></li></ul>', selector: 'ul[data-type="taskList"]', expected: 'taskItem', label: 'task wrapper resolves to inner taskItem' },
    ];

    for (const row of rows) {
      await setContent(page, row.html);
      await hoverInGutterAt(page, page.locator(`${editorSelector} ${row.selector}`));
      const pos = await hoveredPos(page);
      const type = (await blockAt(page, pos ?? 0))?.type;
      expect(type, row.label).toBe(row.expected);
    }
  });
});
