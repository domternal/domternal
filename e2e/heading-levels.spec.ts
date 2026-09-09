/**
 * A heading level the configuration lacks, stored by a collaborator configured with more levels,
 * reads in every wrapper's toolbar, bubble menu, outline and Turn into menu as the level it renders
 * at. The demos offer levels 1 to 4, so a stored 5 renders as h4, marks Heading 4 active, and
 * Heading 4 toggles it off.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';
import { openDemo, setContent } from './tutorial-menu-helpers.js';
import { selectTextPrefix } from './menu-selection.js';

const EDITOR = '.dm-editor .ProseMirror';

interface DemoNode { attrs: Record<string, unknown>; type: { name: string }; textContent: string }
interface DemoEditor {
  state: {
    doc: { firstChild: DemoNode | null; descendants: (visit: (node: DemoNode, pos: number) => void) => void };
    tr: StoreTransaction;
  };
  view: { dispatch: (transaction: unknown) => void };
  commands: { setTextSelection: (position: number) => boolean; focus: () => boolean };
  getHTML: () => string;
}
interface StoreTransaction { setNodeAttribute: (pos: number, name: string, value: unknown) => StoreTransaction }

/** Stores level 5 on the first block without validation, as a collaborator's client writes it. */
async function storeLevelFive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 5));
  });
}

function firstBlock(page: Page): Promise<{ type: string | undefined; level: unknown; html: string }> {
  return page.evaluate(() => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    const first = editor.state.doc.firstChild;
    return { type: first?.type.name, level: first?.attrs['level'], html: editor.getHTML() };
  });
}

/** Stores a value on the heading whose text is `text`, without validation, as a collaborator's client writes it. */
async function storeLevel(page: Page, text: string, level: unknown): Promise<void> {
  await page.evaluate(({ text, level }) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && node.textContent === text) at = pos;
    });
    if (at < 0) throw new Error(`No heading "${text}"`);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(at, 'level', level));
  }, { text, level });
}

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await openDemo(page, target, true);
}

for (const target of demoTargets) {
  test.describe(`stored heading level the configuration lacks [${target.name}]`, () => {
    test('the toolbar marks and toggles the level the heading renders at', async ({ page }) => {
      await openDemo(page, target);
      await setContent(page, '<h1>Five</h1><p>After</p>');
      await storeLevelFive(page);
      await expect(page.locator(`${EDITOR} h4`)).toHaveText('Five');
      await page.locator(`${EDITOR} h4`).click();
      await page.locator('.dm-toolbar').getByRole('button', { name: 'Heading', exact: true }).click();
      const panel = page.locator('.dm-toolbar-dropdown-panel');
      await expect(panel).toBeVisible();
      await expect(panel.locator('button[aria-label="Heading 4"]')).toHaveClass(/dm-toolbar-dropdown-item--active/);
      for (const label of ['Normal text', 'Heading 1', 'Heading 2', 'Heading 3']) {
        await expect(panel.locator(`button[aria-label="${label}"]`)).not.toHaveClass(/dm-toolbar-dropdown-item--active/);
      }
      expect(await firstBlock(page)).toMatchObject({ type: 'heading', level: 5 });
      await panel.locator('button[aria-label="Heading 4"]').click();
      await expect.poll(() => firstBlock(page)).toMatchObject({ type: 'paragraph', html: '<p>Five</p><p>After</p>' });
    });

    test('the bubble menu marks the level the heading renders at', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<h1>Five heading</h1>');
      await storeLevelFive(page);
      await selectTextPrefix(page, target.editorSelector, 4);
      await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
      await page.locator('.dm-bubble-menu [data-dropdown="heading"]').click();
      const panel = page.locator('[data-dropdown-panel="heading"]');
      await expect(panel).toBeVisible();
      const offered = await panel.locator('button[aria-label]').evaluateAll(buttons => buttons.map(button => ({
        label: button.getAttribute('aria-label'), active: button.classList.contains('dm-toolbar-dropdown-item--active'),
      })));
      expect(offered.filter(item => item.active).map(item => item.label))
        .toEqual(offered.some(item => item.label === 'Heading 4') ? ['Heading 4'] : []);
      expect(offered.find(item => item.label === 'Heading 1')?.active).toBe(false);
    });

    test('the outline lists each heading at the level it renders at', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<h1>One</h1><h1>Two</h1><h2>Three</h2><h3>Four</h3>');
      // A decimal string renders at the level of its number; a stored 5 renders as h4, which the
      // outline's default levels 1 to 3 leave out, as they leave out a visible h4.
      await storeLevel(page, 'Two', '3');
      await storeLevel(page, 'Four', 5);
      await expect(page.locator(`${target.editorSelector} h3`)).toHaveText(['Two']);
      await expect(page.locator(`${target.editorSelector} h4`)).toHaveText(['Four']);
      const ticks = page.locator('.dm-toc-outline-tick');
      await expect.poll(() => ticks.evaluateAll(elements => elements.map(element => [element.getAttribute('data-level'), element.getAttribute('aria-label')])))
        .toEqual([['1', 'One (heading 1)'], ['3', 'Two (heading 3)'], ['2', 'Three (heading 2)']]);
      await expect(page.locator('.dm-toc-outline-row')).toHaveText(['One', 'Two', 'Three']);
    });

    test('Turn into hides the heading target a block renders as', async ({ page }) => {
      await goNotion(page, target);
      await setContent(page, '<h1>Two</h1><p>After</p>');
      // A decimal string "2" renders as h2, so Heading 2 is the block's own type.
      await storeLevel(page, 'Two', '2');
      const heading = page.locator(`${target.editorSelector} h2`);
      await expect(heading).toHaveText('Two');
      await heading.hover();
      await page.locator('.dm-block-handle-drag').click();
      const turnInto = page.locator('.dm-block-context-menu [role="group"][aria-label="Turn into"]');
      await expect(turnInto).toBeVisible();
      const labels = await turnInto.locator('.dm-block-context-menu-item').evaluateAll(items => items.map(item => item.getAttribute('aria-label')));
      expect(labels.filter(label => label?.startsWith('Heading'))).toEqual(['Heading 1', 'Heading 3']);
      await turnInto.getByRole('menuitem', { name: 'Heading 3', exact: true }).click();
      await expect(page.locator(`${target.editorSelector} h3`)).toHaveText('Two');
      expect(await firstBlock(page)).toMatchObject({ type: 'heading', level: 3 });
    });
  });
}
