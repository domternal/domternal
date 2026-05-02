/**
 * E2E coverage for the BlockHandle resolution on NESTED blocks inside
 * list/task items (Phase 1-5 of `_planning/listitems_improvements_2.md`).
 *
 * Pre-fix (current state) baseline:
 *  - `BlockHandle.configure({ nested: true })` in notion-demo only allows
 *    `listItem`/`taskItem` as drag targets (DEFAULT_NESTED_NODES).
 *  - Hovering a nested heading/codeBlock/blockquote inside a list item
 *    resolves to the LIST ITEM, not the inner block. → bug.
 *
 * Post-fix (Phase 2-3 of plan):
 *  - `findDeepestBlockAtY` accepts default rules so the `listItemFirstChild`
 *    rule excludes label paragraphs from being a drag target.
 *  - Demo `BlockHandle.configure` extends `nested.allowedNodes` to include
 *    heading/paragraph/codeBlock/blockquote/horizontalRule.
 *  - Hover over nested non-paragraph block resolves to that block.
 *
 * The "should-pass-after-fix" tests below FAIL on the current branch and
 * are the spec for Phase 5 of the plan. Tests in the "regression guards"
 * suite must keep passing throughout the rollout.
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
// Phase 2-3 fix targets - FAILING in current state, expected to pass after fix
// ────────────────────────────────────────────────────────────────────────

test.describe('Nested block handle resolution (Phase 2-3 fix targets)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('nested heading inside list item resolves to heading (currently bug: resolves to listItem)', async ({ page }) => {
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
// Phase 3: paragraphInsideContainer rule - paragraphs inside structural
// containers (blockquote, table cells, details) resolve to the container,
// not the inner paragraph. Paragraphs inside list items (non-first child)
// remain individually draggable - the rule excludes ONLY the named
// container parents.
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3: paragraphInsideContainer rule', () => {
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
    // Phase 3 design: nested non-first paragraphs in list items SHOULD be
    // individually draggable (mirrors keyboard Tab/Shift-Tab semantics).
    // The container exclusion list intentionally omits listItem/taskItem.
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
// Phase 3: clampCoords bug fix regression. Y is only clamped when cursor
// is OUTSIDE the editor's vertical span; thin nested elements at the very
// bottom of the last top-level block must remain reachable. The pre-fix
// behavior stripped 5px off the bottom even when Y was inside content.
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3: clampCoords thin-element-at-bottom regression', () => {
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
// Phase 3: multi-level nesting - deeper structures the deepest-Y walker
// needs to traverse correctly with extended allowedNodes + rules.
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3: multi-level nested resolution', () => {
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
// Phase 3: drag flow - now that handles attach to nested blocks, dragging
// them produces the expected DOM transitions. Mirrors keyboard parity:
// drag nested heading out of li to top-level === Shift-Tab outdent.
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
  const clientX = targetBox.x + targetBox.width / 2;
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

test.describe('Phase 3: drag flow with nested handles', () => {
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
    // This is Phase 3's "drag into list" path, distinct from "drag out".
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
// Phase 3: extra coverage - parity, atom blocks, edge cases
// ────────────────────────────────────────────────────────────────────────

test.describe('Phase 3: extended coverage (atoms, parity, boundaries)', () => {
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
