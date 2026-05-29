import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

// The Table extension pulls in Gapcursor (Table.addExtensions), so a table at
// the END of the document is never a caret trap: ArrowDown from the last cell
// drops a gap cursor below the table and typing there creates a paragraph.
// Without Gapcursor the caret stays stuck inside the last cell.

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

test.describe('trailing table is escapable (Gapcursor via Table)', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('ArrowDown from the last cell lets you type a paragraph below the table', async ({ page }) => {
    await page.click(editorSelector);
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { setContent: (h: string, emit: boolean) => void; commands: { insertTable?: (a: { rows: number; cols: number; withHeaderRow: boolean }) => boolean; focus: (p?: string) => boolean } }
        | undefined;
      ed?.setContent('<p>Intro</p>', false);
      ed?.commands.insertTable?.({ rows: 1, cols: 2, withHeaderRow: false });
      ed?.commands.focus('end');
    });
    await page.waitForTimeout(150);
    await page.locator(`${editorSelector} td`).last().click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('after table');
    await page.waitForTimeout(80);
    const ok = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { doc: { lastChild: { type: { name: string }; textContent: string } | null } } }
        | undefined;
      const last = ed?.state.doc.lastChild;
      return !!last && last.type.name === 'paragraph' && last.textContent === 'after table';
    });
    expect(ok).toBe(true);
  });
});
