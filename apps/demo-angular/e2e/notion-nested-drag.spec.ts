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

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await waitForAllIds(page);
}

async function waitForAllIds(page: Page): Promise<void> {
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
    await hoverInGutterAt(page, page.locator(`${editorSelector} li hr`));
    const pos = await hoveredPos(page);
    expect((await blockAt(page, pos ?? 0))?.type).toBe('horizontalRule');
  });
});
