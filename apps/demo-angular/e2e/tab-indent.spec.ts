/**
 * E2E for the "Tab + lists" demo: two StarterKit editors embedded between form
 * fields. Guards the issue #98 fix - `listIndent` is OFF by default, so Tab on
 * a paragraph that merely follows a list moves focus to the next field instead
 * of being swallowed. The opt-in editor (`listIndent: true`) still pulls the
 * paragraph into the list. In-list Tab=sink stays intact in BOTH (ListKeymap).
 *
 * window.__TAB_EDITORS__ = [defaultEditor, optInEditor]. Next-field inputs:
 * data-testid `tab-next-0` / `tab-next-1`.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const DEFAULT = 0; // StarterKit default (listIndent OFF)
const OPT_IN = 1; // StarterKit({ listIndent: true })

async function goTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('button[data-testid="mode-tab"]');
  await page.waitForFunction(() => ((window as any).__TAB_EDITORS__?.length ?? 0) >= 2, undefined, { timeout: 10000 });
  await page.waitForSelector('.app-tab-indent-demo .ProseMirror');
}

/** Caret at END of the first paragraph whose text === `text`, in editor i, focused. */
async function caretAtEndOf(page: Page, i: number, text: string): Promise<void> {
  await page.evaluate(({ idx, t }) => {
    const e = (window as any).__TAB_EDITORS__[idx];
    const TS = e.state.selection.constructor;
    let pos = -1, size = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (pos !== -1) return false;
      if (n.type.name === 'paragraph' && n.textContent === t) { pos = p; size = n.nodeSize; return false; }
      return true;
    });
    if (pos < 0) throw new Error(`paragraph "${t}" not found in editor ${String(idx)}`);
    e.view.focus();
    e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, pos + size - 1)));
  }, { idx: i, t: text });
}

/** Child block types of every listItem in the first bulletList of editor i. */
async function bulletItems(page: Page, i: number): Promise<string[][]> {
  return page.evaluate((idx) => {
    const e = (window as any).__TAB_EDITORS__[idx];
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

async function focusInEditor(page: Page, i: number): Promise<boolean> {
  return page.evaluate((idx) => {
    const e = (window as any).__TAB_EDITORS__[idx];
    return (e.view.dom as HTMLElement).contains(document.activeElement);
  }, i);
}

async function activeTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

async function textOf(page: Page, i: number): Promise<string> {
  return page.evaluate((idx) => (window as any).__TAB_EDITORS__[idx].state.doc.textContent, i);
}

test.describe('Tab + lists (issue #98 fix: listIndent off by default)', () => {
  test('DEFAULT: Tab on the paragraph after a list moves focus to the next field, doc unchanged', async ({ page }) => {
    await goTab(page);
    const before = await bulletItems(page, DEFAULT);
    const beforeText = await textOf(page, DEFAULT);

    await caretAtEndOf(page, DEFAULT, 'Para after list');
    expect(await focusInEditor(page, DEFAULT)).toBe(true);

    await page.keyboard.press('Tab');

    // Focus left the editor and landed on the next form field...
    expect(await focusInEditor(page, DEFAULT)).toBe(false);
    expect(await activeTestId(page)).toBe('tab-next-0');
    // ...and the document was not touched (paragraph stayed top-level).
    expect(await bulletItems(page, DEFAULT)).toEqual(before);
    expect(await textOf(page, DEFAULT)).toBe(beforeText);
  });

  test('DEFAULT: Tab on a plain paragraph (not after a list) also escapes to the next field', async ({ page }) => {
    await goTab(page);
    await caretAtEndOf(page, DEFAULT, 'Plain paragraph');

    await page.keyboard.press('Tab');

    expect(await focusInEditor(page, DEFAULT)).toBe(false);
    expect(await activeTestId(page)).toBe('tab-next-0');
  });

  test('DEFAULT: in-list Tab still sinks the item (ListKeymap intact, fix is surgical)', async ({ page }) => {
    await goTab(page);
    expect(await bulletItems(page, DEFAULT)).toEqual([['paragraph'], ['paragraph']]);

    await caretAtEndOf(page, DEFAULT, 'Bullet two');
    await page.keyboard.press('Tab');

    // "Bullet two" nested under "Bullet one" as a sublist; focus stays.
    expect(await bulletItems(page, DEFAULT)).toEqual([['paragraph', 'bulletList']]);
    expect(await focusInEditor(page, DEFAULT)).toBe(true);
  });

  test('OPT-IN: Tab on the paragraph after a list pulls it INTO the list, focus stays', async ({ page }) => {
    await goTab(page);
    expect(await bulletItems(page, OPT_IN)).toEqual([['paragraph'], ['paragraph']]);

    await caretAtEndOf(page, OPT_IN, 'Para after list');
    expect(await focusInEditor(page, OPT_IN)).toBe(true);

    await page.keyboard.press('Tab');

    // Paragraph is now a children-zone child of the LAST list item; focus stays.
    expect(await bulletItems(page, OPT_IN)).toEqual([['paragraph'], ['paragraph', 'paragraph']]);
    expect(await focusInEditor(page, OPT_IN)).toBe(true);
    expect(await activeTestId(page)).toBeNull();
  });

  test('OPT-IN: in-list Tab still sinks too (both editors share ListKeymap)', async ({ page }) => {
    await goTab(page);
    await caretAtEndOf(page, OPT_IN, 'Bullet two');
    await page.keyboard.press('Tab');

    expect(await bulletItems(page, OPT_IN)).toEqual([['paragraph', 'bulletList']]);
    expect(await focusInEditor(page, OPT_IN)).toBe(true);
  });

  test('isolation: the two editors behave independently for the same gesture', async ({ page }) => {
    await goTab(page);

    // Same gesture (Tab on "Para after list") on each editor, opposite outcomes.
    await caretAtEndOf(page, DEFAULT, 'Para after list');
    await page.keyboard.press('Tab');
    expect(await focusInEditor(page, DEFAULT)).toBe(false);
    expect(await bulletItems(page, DEFAULT)).toEqual([['paragraph'], ['paragraph']]);

    await caretAtEndOf(page, OPT_IN, 'Para after list');
    await page.keyboard.press('Tab');
    expect(await focusInEditor(page, OPT_IN)).toBe(true);
    expect(await bulletItems(page, OPT_IN)).toEqual([['paragraph'], ['paragraph', 'paragraph']]);
  });
});
