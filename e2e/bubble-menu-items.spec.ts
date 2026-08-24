/**
 * What the bubble menu puts on screen, and in what order, in all four
 * frameworks.
 *
 * Two things are pinned here that nothing else can pin. The Notion selection
 * menu's order is a product decision: act on the selection, change what the
 * block is, attach something, then style it. It is worth one loud failure if
 * it drifts. The separator cleanup only shows itself in rendered DOM: the
 * resolver's unit tests prove the list, but the bar with nothing on one side
 * of it is a thing you see, and it was the visible defect.
 *
 * The four wrappers share one resolver in `@domternal/core` now. That is
 * exactly why these run per framework: the shared implementation is worth
 * nothing if one renderer walks the list differently, and each of them still
 * renders the trailing "A" and "..." itself.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/**
 * The menu as a flat list of tokens, in DOM order:
 * `|` a separator, `▾name` a dropdown, `A` the color trigger, otherwise the
 * button's accessible name. Written against attributes every framework emits,
 * so one expectation serves all four.
 */
async function menuTokens(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const menu = [...document.querySelectorAll('.dm-bubble-menu')].find(
      (el) => el.children.length > 0,
    );
    if (!menu) return [];
    return [...menu.children].map((el) => {
      if (el.getAttribute('role') === 'separator') return '|';
      const wrapper = el.getAttribute('data-dropdown-wrapper');
      if (wrapper) return `▾${wrapper}`;
      if (el.classList.contains('dm-ncp-trigger')) return 'A';
      return el.getAttribute('aria-label') ?? el.tagName.toLowerCase();
    });
  });
}

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 },
  );
}

/** Replace the document with one paragraph and select part of it. */
async function selectInParagraph(page: Page, target: DemoTarget, text = 'selection probe'): Promise<void> {
  await page.evaluate(
    ({ selector, body }) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        setContent: (h: string, emit: boolean) => void;
      };
      ed.setContent(`<p>${body}</p>`, false);
      const paragraph = document.querySelector(`${selector} p`);
      if (!paragraph?.firstChild) throw new Error('no paragraph');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 9);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const editorEl = document.querySelector(selector);
      if (editorEl instanceof HTMLElement) editorEl.focus();
    },
    { selector: target.editorSelector, body: text },
  );
  await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
}

// ---------------------------------------------------------------------------
// The Notion selection menu
// ---------------------------------------------------------------------------

for (const target of demoTargets) {
  test(`${target.name}: the Notion selection menu keeps the product group order`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);

    /* The whole menu, once, so a reordering fails here and nowhere else.
       `ai` and `comment` form the leading action group, and both resolve to
       nothing in a free demo. Their separator collapses, so Turn into leads.
       The alignment dropdown at the end is the demo's own addition on top of
       the default, and the two trailing triggers are the menu's. */
    expect(await menuTokens(page)).toEqual([
      '▾heading',
      '|',
      'Link',
      '|',
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Code',
      'Inline equation',
      '|',
      '▾textAlign',
      '|',
      'A',
      '|',
      'More options',
    ]);
  });

  test(`${target.name}: no separator in the Notion menu has an empty side`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);
    const tokens = await menuTokens(page);

    expect(tokens.length).toBeGreaterThan(0);
    // The one that shipped: `ai` is Pro, so its separator led every free menu.
    expect(tokens[0]).not.toBe('|');
    expect(tokens[tokens.length - 1]).not.toBe('|');
    for (let i = 1; i < tokens.length; i += 1) {
      expect(`${String(tokens[i - 1])} ${String(tokens[i])}`).not.toBe('| |');
    }
  });

  test(`${target.name}: the block-type dropdown leads and offers Normal text plus the headings`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);

    const tokens = await menuTokens(page);
    expect(tokens[0]).toBe('▾heading');

    await page.locator('.dm-bubble-menu [data-dropdown="heading"]').click();
    const panel = page.locator('[data-dropdown-panel="heading"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('button[aria-label="Normal text"]')).toBeVisible();
    await expect(panel.locator('button[aria-label="Heading 1"]')).toBeVisible();
    await expect(panel.locator('button[aria-label="Heading 2"]')).toBeVisible();
  });

  test(`${target.name}: the block-type dropdown applies a heading`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);

    await page.locator('.dm-bubble-menu [data-dropdown="heading"]').click();
    await page.locator('[data-dropdown-panel="heading"] button[aria-label="Heading 2"]').click();
    await expect(page.locator(`${target.editorSelector} h2`)).toHaveCount(1);
  });

  test(`${target.name}: link comes before the formatting marks`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);
    const tokens = await menuTokens(page);
    // What the reordering was for: link changes what the text IS, bold only
    // changes how it looks.
    expect(tokens.indexOf('Link')).toBeLessThan(tokens.indexOf('Bold'));
  });

  test(`${target.name}: the color trigger and the block menu each carry one separator`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);
    const tokens = await menuTokens(page);

    const a = tokens.indexOf('A');
    const more = tokens.indexOf('More options');
    expect(a).toBeGreaterThan(0);
    expect(more).toBeGreaterThan(a);
    expect(tokens[a - 1]).toBe('|');
    expect(tokens[more - 1]).toBe('|');
    // Appended after the list is finished, so they are the only place a
    // double bar could still appear.
    expect(tokens[a - 2]).not.toBe('|');
    expect(tokens[more - 2]).not.toBe('|');
  });

  test(`${target.name}: the color trigger opens the picker and applies a token`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);

    await page.locator('.dm-bubble-menu .dm-ncp-trigger').click();
    const panel = page.locator('.dm-notion-color-picker');
    await expect(panel).toBeVisible();
    // Two sections, ten swatches each: default plus the nine named tokens.
    await expect(panel.locator('.dm-ncp-section')).toHaveCount(2);
    await expect(panel.locator('.dm-ncp-swatch--text')).toHaveCount(10);
    await expect(panel.locator('.dm-ncp-swatch--bg')).toHaveCount(10);

    await panel.locator('.dm-ncp-swatch--text[data-color="orange"]').click();
    await expect(
      page.locator(`${target.editorSelector} [data-text-color="orange"]`),
    ).toHaveCount(1);
  });

  test(`${target.name}: naming textAlign extends the default rather than replacing it`, async ({ page }) => {
    await goNotion(page, target);
    await selectInParagraph(page, target);
    const tokens = await menuTokens(page);

    // The demo appends `'|', 'textAlign'` to defaultBubbleContexts(editor).
    // Both halves have to be true: the default's items are all still there,
    // and the addition landed at the end of the resolved list.
    expect(tokens).toContain('▾textAlign');
    expect(tokens).toContain('Bold');
    expect(tokens.indexOf('▾textAlign')).toBeGreaterThan(tokens.indexOf('Code'));
    expect(tokens.indexOf('▾textAlign')).toBeLessThan(tokens.indexOf('A'));
  });
}

// ---------------------------------------------------------------------------
// Separator cleanup, on lists crafted through the classic demo's fixture
// ---------------------------------------------------------------------------

/**
 * `?bubble-items=` pins an explicit list on the classic demo's bubble menu, so
 * these cases are exact rather than a side effect of which extensions happen
 * to be installed. `nosuchitem` stands in for `ai`: any name the editor does
 * not carry is skipped, and the bar beside it is what used to survive.
 */
for (const target of demoTargets) {
  /* The classic demo's editor. Angular's selector is an element, the other
     three a class, and the notion/classic pair differ only in that one word. */
  const classicEditor = target.editorSelector.replace('app-notion-demo', 'app-editor-demo');

  async function openWithItems(page: Page, items: string): Promise<void> {
    await page.goto(`${target.baseURL}/?bubble-items=${encodeURIComponent(items)}`);
    await page.waitForSelector(classicEditor);
    await page.waitForFunction(
      () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
      { timeout: 5000 },
    );
    await page.evaluate((selector) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        setContent: (h: string, emit: boolean) => void;
      };
      ed.setContent('<p>separator probe</p>', false);
      const paragraph = document.querySelector(`${selector} p`);
      if (!paragraph?.firstChild) throw new Error('no paragraph');
      const range = document.createRange();
      range.setStart(paragraph.firstChild, 0);
      range.setEnd(paragraph.firstChild, 9);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const editorEl = document.querySelector(selector);
      if (editorEl instanceof HTMLElement) editorEl.focus();
    }, classicEditor);
    await expect(page.locator('.dm-bubble-menu')).toHaveAttribute('data-show', '');
  }

  test(`${target.name}: a separator with nothing before it is dropped`, async ({ page }) => {
    await openWithItems(page, '|,bold,italic');
    expect(await menuTokens(page)).toEqual(['Bold', 'Italic']);
  });

  test(`${target.name}: a separator with nothing after it is dropped`, async ({ page }) => {
    await openWithItems(page, 'bold,italic,|');
    expect(await menuTokens(page)).toEqual(['Bold', 'Italic']);
  });

  test(`${target.name}: a run of separators collapses to one`, async ({ page }) => {
    await openWithItems(page, 'bold,|,|,|,italic');
    expect(await menuTokens(page)).toEqual(['Bold', '|', 'Italic']);
  });

  test(`${target.name}: a name the editor does not carry takes its separator with it`, async ({ page }) => {
    await openWithItems(page, 'nosuchitem,|,bold,|,alsomissing,|,italic');
    expect(await menuTokens(page)).toEqual(['Bold', '|', 'Italic']);
  });

  test(`${target.name}: a list of nothing but separators renders nothing`, async ({ page }) => {
    await openWithItems(page, '|,|,|');
    expect(await menuTokens(page)).toEqual([]);
  });

  test(`${target.name}: a separator between two real items survives`, async ({ page }) => {
    await openWithItems(page, 'bold,|,italic');
    expect(await menuTokens(page)).toEqual(['Bold', '|', 'Italic']);
  });
}
