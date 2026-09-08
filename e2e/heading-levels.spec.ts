/**
 * A heading level the configuration lacks, stored by a collaborator configured with more levels,
 * reads in every wrapper's toolbar and bubble menu as the level it renders at. The demos offer
 * levels 1 to 4, so a stored 5 renders as h4, marks Heading 4 active, and Heading 4 toggles it off.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';
import { openDemo, setContent } from './tutorial-menu-helpers.js';
import { selectTextPrefix } from './menu-selection.js';

const EDITOR = '.dm-editor .ProseMirror';

interface DemoEditor {
  state: { doc: { firstChild: { attrs: Record<string, unknown>; type: { name: string } } | null }; tr: StoreTransaction };
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
  });
}
