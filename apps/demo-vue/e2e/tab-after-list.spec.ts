/**
 * E2E reproduction for issue #98 ("Tabbing works inconsistently for paragraph
 * below list"). NOT a fix - confirms the real-browser consequence the reporter
 * sees: a real Tab key on a paragraph that sits right after a list is swallowed
 * (focus stays, the paragraph is pulled into the list), while a Tab on a plain
 * paragraph escapes the editor (focus moves to the next focusable element).
 *
 * Reuses the "Multiple editors" demo only as a host page with editors exposed
 * on window.__MULTI_EDITORS__; the bug itself is single-editor.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const gridPM = '.multi-editor-grid .ProseMirror';

async function goMulti(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('button[data-testid="mode-multi"]');
  await page.waitForFunction(() => ((window as any).__MULTI_EDITORS__?.length ?? 0) >= 1, undefined, { timeout: 10000 });
  await page.waitForSelector(gridPM);
}

async function setContent(page: Page, i: number, html: string): Promise<void> {
  await page.evaluate(({ idx, h }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    e.setContent(h, false);
  }, { idx: i, h: html });
}

/** Caret at END of the first paragraph whose text === `text`, with DOM focus. */
async function caretAtEndOf(page: Page, i: number, text: string): Promise<void> {
  await page.evaluate(({ idx, t }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    const TS = e.state.selection.constructor;
    let pos = -1, size = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (pos !== -1) return false;
      if (n.type.name === 'paragraph' && n.textContent === t) { pos = p; size = n.nodeSize; return false; }
      return true;
    });
    if (pos < 0) throw new Error(`paragraph "${t}" not found`);
    e.view.focus();
    e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, pos + size - 1)));
  }, { idx: i, t: text });
}

/** Child block types of every listItem in the first bulletList of editor i. */
async function bulletItems(page: Page, i: number): Promise<string[][]> {
  return page.evaluate((idx) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    const out: string[][] = [];
    e.state.doc.descendants((n: any) => {
      if (out.length) return false;
      if (n.type.name === 'bulletList') {
        n.forEach((item: any) => {
          const blocks: string[] = [];
          item.forEach((c: any) => blocks.push(c.type.name));
          out.push(blocks);
        });
        return false;
      }
      return true;
    });
    return out;
  }, i);
}

/** True when DOM focus sits inside editor i's ProseMirror element. */
async function focusInEditor(page: Page, i: number): Promise<boolean> {
  return page.evaluate((idx) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    return (e.view.dom as HTMLElement).contains(document.activeElement);
  }, i);
}

test.describe('Tab on a paragraph after a list (ListIndent capture)', () => {
  test('Tab on the paragraph after a list is SWALLOWED and pulls it into the list (focus stays)', async ({ page }) => {
    await goMulti(page);
    await setContent(page, 0, '<ul><li><p>Bullet</p></li></ul><p>Para</p>');
    await caretAtEndOf(page, 0, 'Para');
    expect(await focusInEditor(page, 0)).toBe(true);
    expect(await bulletItems(page, 0)).toEqual([['paragraph']]);

    await page.keyboard.press('Tab');

    // Captured: paragraph is now a children-zone child INSIDE the list item...
    expect(await bulletItems(page, 0)).toEqual([['paragraph', 'paragraph']]);
    // ...and focus never left the editor (so it never reached the next field).
    expect(await focusInEditor(page, 0)).toBe(true);
  });

  test('Tab on a plain paragraph (no preceding list) ESCAPES the editor (focus leaves)', async ({ page }) => {
    await goMulti(page);
    await setContent(page, 0, '<p>Alpha</p><p>Para</p>');
    await caretAtEndOf(page, 0, 'Para');
    expect(await focusInEditor(page, 0)).toBe(true);
    const before = await page.evaluate(() => (window as any).__MULTI_EDITORS__[0].getHTML());

    await page.keyboard.press('Tab');

    // Not captured: the doc is untouched and focus moved out of the editor.
    expect(await page.evaluate(() => (window as any).__MULTI_EDITORS__[0].getHTML())).toBe(before);
    expect(await focusInEditor(page, 0)).toBe(false);
  });
});
