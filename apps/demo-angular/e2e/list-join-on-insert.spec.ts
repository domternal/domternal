import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

// Creating a list item (markdown shortcut) on a paragraph that sits BETWEEN two
// same-type lists must merge all of them into one list. Previously the wrapping
// input rule joined only backward, so the trailing list was orphaned.

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
}

test.describe('list join when inserting a bullet between two lists', () => {
  test.beforeEach(async ({ page }) => { await goNotion(page); });

  test('typing "- " on a line between two bullet lists merges them into one', async ({ page }) => {
    await page.click(editorSelector);
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { setContent: (h: string, emit: boolean) => void;
            state: { doc: { descendants: (cb: (n: { type: { name: string }; content: { size: number } }, p: number) => boolean | undefined) => void }; tr: { setSelection: (s: unknown) => unknown }; selection: { constructor: { create: (d: unknown, a: number) => unknown } } };
            view: { dispatch: (t: unknown) => void; dom: HTMLElement; focus: () => void } }
        | undefined;
      if (!ed) return;
      ed.setContent('<ul><li><p>A</p><ul><li><p>B</p></li></ul></li></ul><p></p><ul><li><p>C</p></li></ul>', false);
      let pos = -1;
      ed.state.doc.descendants((n, p) => {
        if (pos !== -1) return false;
        if (n.type.name === 'paragraph' && n.content.size === 0) { pos = p + 1; return false; }
        return true;
      });
      const TS = ed.state.selection.constructor;
      ed.view.dispatch((ed.state.tr.setSelection as (s: unknown) => unknown)(TS.create(ed.state.doc as unknown, pos)));
      ed.view.dom.focus();
      ed.view.focus();
    });
    await page.waitForTimeout(120);
    await page.keyboard.type('- ');
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>).__DEMO_EDITOR__ as
        | { state: { doc: { forEach: (cb: (n: { type: { name: string }; textContent: string }) => void) => void } } }
        | undefined;
      let lists = 0; let hasC = false;
      ed?.state.doc.forEach((n) => { if (n.type.name === 'bulletList') { lists++; if (n.textContent.includes('C')) hasC = true; } });
      return { lists, hasC };
    });
    // One merged list; the trailing item C is no longer orphaned into a second list.
    expect(result.lists).toBe(1);
    expect(result.hasC).toBe(true);
  });
});
