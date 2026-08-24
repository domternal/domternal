import { test, expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const NOTION_WITH_AI = [
  'Ask AI',
  'Comment',
  '|',
  'Heading',
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
  'Text Alignment',
  '|',
  'Text and background color',
  '|',
  'More options',
];

const NOTION_WITHOUT_AI = NOTION_WITH_AI.slice(1);

async function selectText(page: Page, editorSelector: string): Promise<void> {
  await page.locator(editorSelector).click();
  const selected = await page.evaluate((selector) => {
    const editor = document.querySelector<HTMLElement>(selector);
    if (!editor) return false;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && (text.textContent?.trim().length ?? 0) < 4) text = walker.nextNode();
    if (!text?.textContent) return false;
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, Math.min(text.textContent.length, 7));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return true;
  }, editorSelector);
  expect(selected).toBe(true);
}

async function visibleMenuTokens(page: Page): Promise<string[]> {
  const menu = page.locator('.dm-bubble-menu:visible').first();
  await expect(menu).toBeVisible();
  return menu.locator('button, [role="separator"]').evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        if (element.getAttribute('role') === 'separator') return '|';
        return element.getAttribute('aria-label') ?? element.textContent.trim();
      })
      .filter(Boolean),
  );
}

async function openNotionFixture(page: Page, target: DemoTarget, fixture: 'both' | 'comment'): Promise<void> {
  await page.goto(`${target.baseURL}/?bubble-order=${fixture}`);
  await page.locator(target.notionToggle).click();
  await expect(page.locator(target.editorSelector)).toBeVisible();
  await selectText(page, target.editorSelector);
}

for (const target of demoTargets) {
  test(`${target.name}: Notion resolves AI before Comment with exact grouped order`, async ({ page }) => {
    await openNotionFixture(page, target, 'both');
    expect(await visibleMenuTokens(page)).toEqual(NOTION_WITH_AI);
  });

  test(`${target.name}: Notion starts with Comment and removes the orphaned AI separator`, async ({ page }) => {
    await openNotionFixture(page, target, 'comment');
    expect(await visibleMenuTokens(page)).toEqual(NOTION_WITHOUT_AI);
  });

  test(`${target.name}: the Notion-only fixture cannot change the Classic bubble`, async ({ page }) => {
    await page.goto(`${target.baseURL}/`);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await selectText(page, '.ProseMirror');
    const baseline = await visibleMenuTokens(page);

    await page.goto(`${target.baseURL}/?bubble-order=both`);
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await selectText(page, '.ProseMirror');
    const withFixtureQuery = await visibleMenuTokens(page);

    expect(withFixtureQuery).toEqual(baseline);
    expect(withFixtureQuery).not.toContain('Ask AI');
    expect(withFixtureQuery).not.toContain('Comment');
  });
}
